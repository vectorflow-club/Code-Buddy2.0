const mongoose = require('mongoose');
const { Round, Question, Level, Evaluation, Student, Transaction } = require('../models');
const { TOTAL_LEVELS, FIRST_YEAR, ACADEMIC_YEARS, TRANSACTION_TYPES } = require('../constants');
const {
  formatStudentTransactionResponse,
  parseValidDeadlineMs,
  computeTimerFields,
  formatRoundStudentResponse,
  formatLevelResponse,
} = require('../utils');

/**
 * Evaluate a Round's timer state against server time and atomically persist 'timeExpired'
 * when an 'inProgress' round reaches or passes its stored deadline.
 * Never resets startedAt or deadline, and handles concurrent expiration safely.
 */
const syncRoundDeadlineState = async (round, now = new Date()) => {
  if (!round) {
    return {
      error: {
        status: 404,
        code: 'ROUND_NOT_ALLOCATED',
        message: 'Round record not found.',
      },
    };
  }

  if (round.status === 'ready') {
    return {
      round,
      remainingSeconds: null,
      isExpired: false,
      didExpireNow: false,
    };
  }

  if (round.status === 'timeExpired') {
    return {
      round,
      remainingSeconds: 0,
      isExpired: true,
      didExpireNow: false,
    };
  }

  if (['submitted', 'evaluated', 'abandoned'].includes(round.status)) {
    return {
      round,
      remainingSeconds: 0,
      isExpired: false,
      didExpireNow: false,
    };
  }

  if (round.status === 'inProgress') {
    const parsed = parseValidDeadlineMs(round.deadline);
    if (parsed.errorCode) {
      return {
        error: {
          status: 500,
          code: parsed.errorCode,
          message: parsed.message,
        },
      };
    }

    const diffMs = parsed.timestampMs - now.getTime();
    if (diffMs > 0) {
      return {
        round,
        remainingSeconds: Math.ceil(diffMs / 1000),
        isExpired: false,
        didExpireNow: false,
      };
    }

    const expiredRound = await Round.findOneAndUpdate(
      {
        _id: round._id,
        status: 'inProgress',
      },
      {
        $set: {
          status: 'timeExpired',
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (expiredRound) {
      return {
        round: expiredRound,
        remainingSeconds: 0,
        isExpired: true,
        didExpireNow: true,
      };
    }

    // Concurrency fallback: re-read if another request transitioned the round concurrently
    const latestRound = await Round.findById(round._id);
    if (!latestRound) {
      return {
        error: {
          status: 404,
          code: 'ROUND_NOT_ALLOCATED',
          message: 'Round record no longer exists.',
        },
      };
    }

    if (latestRound.status === 'timeExpired') {
      return {
        round: latestRound,
        remainingSeconds: 0,
        isExpired: true,
        didExpireNow: false,
      };
    }

    return {
      round: latestRound,
      remainingSeconds: 0,
      isExpired: false,
      didExpireNow: false,
    };
  }

  return {
    error: {
      status: 500,
      code: 'INVALID_ROUND_STATUS',
      message: `Round has unexpected status '${round.status}'.`,
    },
  };
};

/**
 * Check whether a Mongoose model query can execute safely in the current runtime
 * (either connected to MongoDB or explicitly mocked on the model).
 */
const canQueryModel = (Model, methodName = 'findOne') =>
  mongoose.connection.readyState === 1 ||
  Boolean(Model && typeof Model[methodName] === 'function' && Model[methodName] !== mongoose.Model[methodName]);

/**
 * Derive authoritative Student.roundAvailability from the active Round status
 * and Student.competitionStatus using valid Student schema enum values.
 */
const deriveStudentRoundAvailability = (student, round = null, evaluation = null) => {
  if (!student) {
    return 'unavailable';
  }

  if (student.competitionStatus === 'completed') {
    return 'completed';
  }
  if (student.competitionStatus === 'eliminated') {
    return 'eliminated';
  }

  if (round) {
    if (round.status === 'inProgress') {
      return computeTimerFields(round).isExpired ? 'evaluationPending' : 'inProgress';
    }

    if (round.status === 'evaluated') {
      const postEvalMap = {
        completed: 'completed',
        eliminated: 'eliminated',
        cleared: 'cleared',
      };
      if (postEvalMap[student.competitionStatus]) {
        return postEvalMap[student.competitionStatus];
      }
      if (evaluation) {
        if (evaluation.status === 'FAIL') {
          return 'eliminated';
        }
        if (evaluation.status === 'PASS') {
          if (evaluation.isProgressed) {
            return round.levelNumber >= TOTAL_LEVELS ? 'completed' : 'ready';
          }
          return 'cleared';
        }
      }
      return 'unavailable';
    }

    const roundToAvailabilityMap = {
      ready: 'ready',
      timeExpired: 'evaluationPending',
      submitted: 'evaluationPending',
      abandoned: 'unavailable',
    };

    if (roundToAvailabilityMap[round.status]) {
      return roundToAvailabilityMap[round.status];
    }
  }

  return student.roundAvailability || 'unavailable';
};

/**
 * Derive a read-only synchronized live snapshot of student competition state
 * (currentLevel, highestLevelReached, levelsCleared, competitionStatus, roundAvailability)
 * from Student, Round, Evaluation, and non-mutating timer checks.
 * Never performs database writes.
 */
const resolveStudentLiveState = async (student) => {
  if (!student) {
    return {
      currentLevel: 1,
      highestLevelReached: 1,
      levelsCleared: 0,
      competitionStatus: 'registered',
      roundAvailability: 'unavailable',
    };
  }

  let liveCurrentLevel =
    Number.isInteger(student.currentLevel) && student.currentLevel >= 1 && student.currentLevel <= TOTAL_LEVELS
      ? student.currentLevel
      : 1;
  let liveHighestLevelReached = Math.max(student.highestLevelReached ?? 1, liveCurrentLevel);
  let liveLevelsCleared = student.levelsCleared ?? 0;
  let liveCompetitionStatus = student.competitionStatus || 'registered';

  if (
    !student.registrationComplete &&
    liveCompetitionStatus !== 'completed' &&
    liveCompetitionStatus !== 'eliminated'
  ) {
    return {
      currentLevel: liveCurrentLevel,
      highestLevelReached: liveHighestLevelReached,
      levelsCleared: liveLevelsCleared,
      competitionStatus: liveCompetitionStatus,
      roundAvailability: deriveStudentRoundAvailability(student, null),
    };
  }

  let inspectedRound = null;
  let inspectedEvaluation = null;

  if (student.registrationComplete && canQueryModel(Round, 'findOne')) {
    for (let step = 0; step < TOTAL_LEVELS; step += 1) {
      const round = await Round.findOne({
        studentId: student._id,
        levelNumber: liveCurrentLevel,
      });

      if (!round) {
        inspectedRound = null;
        inspectedEvaluation = null;
        break;
      }

      inspectedRound = round;
      inspectedEvaluation = null;

      if (round.status === 'evaluated' && canQueryModel(Evaluation, 'findOne')) {
        const evaluation = await Evaluation.findOne({ roundId: round._id });
        inspectedEvaluation = evaluation || null;

        if (evaluation && evaluation.status === 'PASS' && evaluation.isProgressed) {
          liveLevelsCleared = Math.max(liveLevelsCleared, liveCurrentLevel);
          if (liveCurrentLevel < TOTAL_LEVELS) {
            liveCurrentLevel += 1;
            liveHighestLevelReached = Math.max(liveHighestLevelReached, liveCurrentLevel);
            if (liveCompetitionStatus === 'registered' || liveCompetitionStatus === 'cleared') {
              liveCompetitionStatus = 'inProgress';
            }
            continue;
          }

          liveCurrentLevel = 6;
          liveHighestLevelReached = 6;
          liveLevelsCleared = 6;
          liveCompetitionStatus = 'completed';
        } else if (evaluation && evaluation.status === 'PASS') {
          if (liveCompetitionStatus !== 'completed' && liveCompetitionStatus !== 'eliminated') {
            liveCompetitionStatus = 'cleared';
          }
        } else if (evaluation && evaluation.status === 'FAIL') {
          liveCompetitionStatus = 'eliminated';
        }
        break;
      }

      if (['inProgress', 'timeExpired', 'submitted'].includes(round.status)) {
        if (liveCompetitionStatus === 'registered' || liveCompetitionStatus === 'cleared') {
          liveCompetitionStatus = 'inProgress';
        }
        break;
      }

      if (round.status === 'ready') {
        if (liveCompetitionStatus === 'cleared') {
          liveCompetitionStatus = liveCurrentLevel > 1 || liveLevelsCleared > 0 ? 'inProgress' : 'registered';
        }
        break;
      }

      break;
    }
  }

  if (liveCompetitionStatus === 'completed') {
    liveCurrentLevel = 6;
    liveHighestLevelReached = 6;
    liveLevelsCleared = 6;
  } else if (!inspectedRound && liveCompetitionStatus !== 'eliminated') {
    if (liveCurrentLevel > 1 || liveLevelsCleared > 0) {
      if (liveCompetitionStatus === 'registered' || liveCompetitionStatus === 'cleared') {
        liveCompetitionStatus = 'inProgress';
      }
    } else if (liveCompetitionStatus === 'cleared') {
      liveCompetitionStatus = 'registered';
    }
  }

  let liveRoundAvailability = deriveStudentRoundAvailability(
    {
      competitionStatus: liveCompetitionStatus,
      roundAvailability: student.roundAvailability,
    },
    inspectedRound,
    inspectedEvaluation
  );

  // If no Round exists yet at liveCurrentLevel, do not carry forward stale mid-round statuses.
  if (
    !inspectedRound &&
    ['registered', 'inProgress'].includes(liveCompetitionStatus) &&
    ['inProgress', 'evaluationPending', 'cleared', 'completed', 'eliminated'].includes(liveRoundAvailability)
  ) {
    liveRoundAvailability = 'ready';
  }

  return {
    currentLevel: liveCurrentLevel,
    highestLevelReached: liveHighestLevelReached,
    levelsCleared: liveLevelsCleared,
    competitionStatus: liveCompetitionStatus,
    roundAvailability: liveRoundAvailability,
  };
};

/**
/**
 * Controller: getLevelInfo
 * Endpoint: GET /api/rounds/level-info
 * Access: Protected (Student only)
 *
 * Responsibilities:
 * 1. Identifies student from authenticated session (req.student).
 * 2. Enforces registration completion.
 * 3. Reads currentLevel and walletBalance from Student document.
 * 4. Loads financial and timer configurations from Level collection.
 * 5. Does NOT allocate a question.
 * 6. Does NOT alter wallet balance or competition progress.
 */
const getLevelInfo = async (req, res) => {
  try {
    const student = req.student;

    if (!student.registrationComplete) {
      return res.status(403).json({
        success: false,
        code: 'REGISTRATION_INCOMPLETE',
        message: 'Registration must be completed before viewing competition level details.',
      });
    }

    const currentLevel = student.currentLevel;
    if (!currentLevel || currentLevel < 1 || currentLevel > TOTAL_LEVELS) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_STUDENT_LEVEL',
        message: 'Student current level is invalid.',
      });
    }

    const levelConfig = await Level.findOne({ number: currentLevel, isActive: true });
    if (!levelConfig) {
      return res.status(404).json({
        success: false,
        code: 'LEVEL_NOT_FOUND',
        message: `Active level configuration for Level ${currentLevel} was not found.`,
      });
    }

    const entryFee =
      Number.isFinite(levelConfig.entryRiskAmount) && levelConfig.entryRiskAmount >= 0
        ? levelConfig.entryRiskAmount
        : 0;
    const currentBalance = student.walletBalance ?? 0;

    return res.status(200).json({
      success: true,
      currentLevel,
      walletBalance: currentBalance,
      hasSufficientBalance: currentBalance >= entryFee,
      level: formatLevelResponse(levelConfig),
    });
  } catch (error) {
    console.error('Error fetching level info:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to retrieve level information.',
    });
  }
};

/**
 * Build the 200 response returned whenever allocation finds an existing round
 * for the student's current level. Shared by the idempotent pre-check and all
 * race-recovery paths; the only differences between the five original copies
 * were the local variable names for the fresh student doc, the entry debit
 * transaction, and the round.
 */
const buildExistingRoundResponse = (student, freshStudent, debitTx, round) => ({
  success: true,
  message: 'Existing round retrieved successfully.',
  isExisting: true,
  walletBalance: freshStudent ? (freshStudent.walletBalance ?? 0) : (student.walletBalance ?? 0),
  entryFee: 0,
  transaction: debitTx ? formatStudentTransactionResponse(debitTx) : null,
  round: formatRoundStudentResponse(round),
});

/**
 * Build the 400 insufficient-balance response shared by the wallet pre-check,
 * the transaction path, and the standalone fallback path.
 */
const buildInsufficientBalanceResponse = (currentLevel, entryFee, currentBalance) => ({
  success: false,
  code: 'INSUFFICIENT_BALANCE',
  message: `Insufficient wallet balance to enter Level ${currentLevel}. Required: ${entryFee}, available: ${currentBalance}.`,
  walletBalance: currentBalance,
  requiredAmount: entryFee,
});

/**
 * Controller: allocateQuestion
 * Endpoint: POST /api/rounds/allocate
 * Access: Protected (Student only)
 *
 * Responsibilities:
 * 1. Identifies student from authenticated session (req.student).
 * 2. Enforces registration completion.
 * 3. Reads currentLevel and academic year from Student document.
 * 4. Maps academic year to difficulty: 1st Year -> EASY, 2nd..4th Year -> HARD.
 * 5. Checks for existing Round: returns existing question snapshot if already allocated.
 * 6. Validates active Level configuration.
 * 7. Selects an active matching question from Question collection.
 * 8. Creates Round with frozen questionSnapshot (excluding hiddenTestCases).
 * 9. Catches E11000 duplicate key error and recovers by returning existing Round.
 * 10. Does NOT deduct wallet balance or modify progression.
 */
const allocateQuestion = async (req, res) => {
  try {
    const bodyKeys = Object.keys(req.body || {});
    if (bodyKeys.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'UNSUPPORTED_FIELDS',
        message: `Question allocation requests do not accept request body fields: ${bodyKeys.join(', ')}.`,
      });
    }

    const student = req.student;

    if (!student.registrationComplete) {
      return res.status(403).json({
        success: false,
        code: 'REGISTRATION_INCOMPLETE',
        message: 'Registration must be completed before entering competition rounds.',
      });
    }

    if (student.competitionStatus === 'eliminated') {
      return res.status(409).json({
        success: false,
        code: 'STUDENT_ELIMINATED',
        message: 'You have been eliminated from the competition and cannot allocate another round.',
      });
    }

    if (student.competitionStatus === 'completed') {
      return res.status(409).json({
        success: false,
        code: 'COMPETITION_COMPLETED',
        message: 'You have already completed all competition levels.',
      });
    }

    const currentLevel = student.currentLevel;
    if (!currentLevel || currentLevel < 1 || currentLevel > TOTAL_LEVELS) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_STUDENT_LEVEL',
        message: 'Student current level is invalid.',
      });
    }

    const year = student.year;
    let difficulty;
    if (year === FIRST_YEAR) {
      difficulty = 'EASY';
    } else if (ACADEMIC_YEARS.includes(year)) {
      difficulty = 'HARD';
    } else {
      return res.status(400).json({
        success: false,
        code: 'INVALID_STUDENT_YEAR',
        message: 'Student academic year must be 1st Year, 2nd Year, 3rd Year, or 4th Year.',
      });
    }

    const levelConfig = await Level.findOne({ number: currentLevel, isActive: true });
    if (!levelConfig) {
      return res.status(404).json({
        success: false,
        code: 'LEVEL_NOT_FOUND',
        message: `Active level configuration for Level ${currentLevel} was not found.`,
      });
    }

    const entryFee =
      typeof levelConfig.entryRiskAmount === 'number' &&
      Number.isFinite(levelConfig.entryRiskAmount) &&
      levelConfig.entryRiskAmount > 0
        ? levelConfig.entryRiskAmount
        : 0;

    const existingRound = await Round.findOne({
      studentId: student._id,
      levelNumber: currentLevel,
    });

    if (existingRound) {
      const freshStudent = await Student.findById(student._id);
      const existingDebitTx = await Transaction.findOne({
        roundId: existingRound._id,
        type: TRANSACTION_TYPES.STAKE_DEBIT,
      });

      return res.status(200).json(buildExistingRoundResponse(student, freshStudent, existingDebitTx, existingRound));
    }

    const freshStudent = await Student.findById(student._id);
    const currentBalance = freshStudent ? (freshStudent.walletBalance ?? 0) : (student.walletBalance ?? 0);

    if (currentBalance < entryFee) {
      return res.status(400).json(buildInsufficientBalanceResponse(currentLevel, entryFee, currentBalance));
    }

    const eligibleQuestions = await Question.find({
      levelNumber: currentLevel,
      difficulty,
      isActive: true,
    });

    if (!eligibleQuestions || eligibleQuestions.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'NO_ELIGIBLE_QUESTIONS',
        message: `No active ${difficulty} questions are available for Level ${currentLevel}.`,
      });
    }

    const pastRounds = await Round.find({ studentId: student._id }).select('questionId');
    const pastQuestionIds = new Set(pastRounds.map((r) => r.questionId.toString()));

    const unassignedQuestions = eligibleQuestions.filter(
      (q) => !pastQuestionIds.has(q._id.toString())
    );

    const selectionPool = unassignedQuestions.length > 0 ? unassignedQuestions : eligibleQuestions;
    const randomIndex = Math.floor(Math.random() * selectionPool.length);
    const selectedQuestion = selectionPool[randomIndex];

    // 9. Construct immutable question snapshot (strictly omitting hiddenTestCases)
    const questionSnapshot = {
      questionId: selectedQuestion._id,
      title: selectedQuestion.title,
      statement: selectedQuestion.statement,
      constraints: selectedQuestion.constraints || [],
      examples: selectedQuestion.examples || [],
      difficulty: selectedQuestion.difficulty,
      levelNumber: selectedQuestion.levelNumber,
    };

    let savedRound = null;
    let savedDebitTx = null;
    let finalStudent = freshStudent;
    let session = null;
    let txCommitted = false;
    let isRaceExisting = false;
    let raceExistingDebitTx = null;

    try {
      session = await mongoose.startSession();
    } catch (_) {
      session = null;
    }

    if (session) {
      try {
        await session.withTransaction(async () => {
          // Re-check for concurrent existing round
          const raceExisting = await Round.findOne({
            studentId: student._id,
            levelNumber: currentLevel,
          }).session(session);

          if (raceExisting) {
            savedRound = raceExisting;
            isRaceExisting = true;
            raceExistingDebitTx = await Transaction.findOne({
              roundId: raceExisting._id,
              type: TRANSACTION_TYPES.STAKE_DEBIT,
            }).session(session);
            return;
          }

          let updatedStudent = freshStudent;
          if (entryFee > 0) {
            updatedStudent = await Student.findOneAndUpdate(
              {
                _id: student._id,
                walletBalance: { $gte: entryFee },
              },
              {
                $inc: {
                  walletBalance: -entryFee,
                  totalRisked: entryFee,
                },
              },
              {
                session,
                new: true,
                runValidators: true,
              }
            );

            if (!updatedStudent) {
              const insufficientErr = new Error(`Insufficient wallet balance to enter Level ${currentLevel}.`);
              insufficientErr.isInsufficientBalance = true;
              throw insufficientErr;
            }
          }

          const round = new Round({
            studentId: student._id,
            levelNumber: currentLevel,
            questionId: selectedQuestion._id,
            questionSnapshot,
            status: 'ready',
            durationSeconds: levelConfig.durationSeconds || 180,
          });
          savedRound = await round.save({ session });

          if (entryFee > 0) {
            const debitTx = new Transaction({
              studentId: student._id,
              type: TRANSACTION_TYPES.STAKE_DEBIT,
              status: 'SUCCESS',
              amount: entryFee,
              balanceAfter: updatedStudent.walletBalance,
              levelNumber: currentLevel,
              roundId: savedRound._id,
              settlementKey: `round_entry:${savedRound._id.toString()}`,
              description: `Level ${currentLevel} entry fee debit (${updatedStudent.walletBalance + entryFee} -> ${updatedStudent.walletBalance})`,
              timestamp: new Date(),
            });
            savedDebitTx = await debitTx.save({ session });
          }
          finalStudent = updatedStudent;
        });
        txCommitted = true;
      } catch (txErr) {
        if (txErr.isInsufficientBalance) {
          return res.status(400).json(buildInsufficientBalanceResponse(currentLevel, entryFee, currentBalance));
        }
        if (txErr.code === 11000 || (txErr.message && txErr.message.includes('E11000'))) {
          const raceExistingRound = await Round.findOne({
            studentId: student._id,
            levelNumber: currentLevel,
          });
          if (raceExistingRound) {
            const currentStudent = await Student.findById(student._id);
            const existingTx = await Transaction.findOne({
              roundId: raceExistingRound._id,
              type: TRANSACTION_TYPES.STAKE_DEBIT,
            });
            return res.status(200).json(buildExistingRoundResponse(student, currentStudent, existingTx, raceExistingRound));
          }
        }
        const isTxUnsupported =
          txErr.message &&
          (txErr.message.includes('Transaction numbers are only allowed') ||
            txErr.message.includes('replica set') ||
            txErr.message.includes('does not support retryable writes or transactions'));
        if (!isTxUnsupported) {
          throw txErr;
        }
      } finally {
        await session.endSession();
      }

      if (isRaceExisting && savedRound) {
        const currentStudent = await Student.findById(student._id);
        return res.status(200).json(buildExistingRoundResponse(student, currentStudent, raceExistingDebitTx, savedRound));
      }
    }

    // Standalone fallback (when session or withTransaction is unavailable or unsupported)
    if (!txCommitted) {
      // Re-check for concurrent existing round
      const raceExisting = await Round.findOne({
        studentId: student._id,
        levelNumber: currentLevel,
      });
      if (raceExisting) {
        const currentStudent = await Student.findById(student._id);
        const existingTx = await Transaction.findOne({
          roundId: raceExisting._id,
          type: TRANSACTION_TYPES.STAKE_DEBIT,
        });
        return res.status(200).json(buildExistingRoundResponse(student, currentStudent, existingTx, raceExisting));
      }

      let updatedStudent = freshStudent;
      let didDeduct = false;

      if (entryFee > 0) {
        updatedStudent = await Student.findOneAndUpdate(
          {
            _id: student._id,
            walletBalance: { $gte: entryFee },
          },
          {
            $inc: {
              walletBalance: -entryFee,
              totalRisked: entryFee,
            },
          },
          {
            new: true,
            runValidators: true,
          }
        );

        if (!updatedStudent) {
          return res.status(400).json(buildInsufficientBalanceResponse(currentLevel, entryFee, currentBalance));
        }
        didDeduct = true;
      }

      try {
        const round = new Round({
          studentId: student._id,
          levelNumber: currentLevel,
          questionId: selectedQuestion._id,
          questionSnapshot,
          status: 'ready',
          durationSeconds: levelConfig.durationSeconds || 180,
        });
        savedRound = await round.save();
      } catch (saveError) {
        if (didDeduct) {
          await Student.findByIdAndUpdate(student._id, {
            $inc: {
              walletBalance: entryFee,
              totalRisked: -entryFee,
            },
          });
        }
        if (saveError.code === 11000 || (saveError.message && saveError.message.includes('E11000'))) {
          const raceExistingRound = await Round.findOne({
            studentId: student._id,
            levelNumber: currentLevel,
          });
          if (raceExistingRound) {
            const currentStudent = await Student.findById(student._id);
            const existingTx = await Transaction.findOne({
              roundId: raceExistingRound._id,
              type: TRANSACTION_TYPES.STAKE_DEBIT,
            });
            return res.status(200).json(buildExistingRoundResponse(student, currentStudent, existingTx, raceExistingRound));
          }
        }
        throw saveError;
      }

      if (entryFee > 0) {
        try {
          const debitTx = new Transaction({
            studentId: student._id,
            type: TRANSACTION_TYPES.STAKE_DEBIT,
            status: 'SUCCESS',
            amount: entryFee,
            balanceAfter: updatedStudent.walletBalance,
            levelNumber: currentLevel,
            roundId: savedRound._id,
            settlementKey: `round_entry:${savedRound._id.toString()}`,
            description: `Level ${currentLevel} entry fee debit (${updatedStudent.walletBalance + entryFee} -> ${updatedStudent.walletBalance})`,
            timestamp: new Date(),
          });
          savedDebitTx = await debitTx.save();
        } catch (txSaveErr) {
          await Round.findByIdAndDelete(savedRound._id);
          await Student.findByIdAndUpdate(student._id, {
            $inc: {
              walletBalance: entryFee,
              totalRisked: -entryFee,
            },
          });
          throw txSaveErr;
        }
      }
      finalStudent = updatedStudent;
    }

    return res.status(201).json({
      success: true,
      message: 'Question allocated successfully.',
      isExisting: false,
      walletBalance: finalStudent ? (finalStudent.walletBalance ?? 0) : 0,
      entryFee,
      transaction: savedDebitTx ? formatStudentTransactionResponse(savedDebitTx) : null,
      round: formatRoundStudentResponse(savedRound),
    });
  } catch (error) {
    console.error('Error allocating question:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to allocate question.',
    });
  }
};

/**
 * Map active round status to clear student-facing status message.
 */
const getActiveRoundStatusMessage = (status, isExpired) => {
  if (isExpired || status === 'timeExpired') {
    return 'Round timer has expired.';
  }
  const statusMessages = {
    ready: 'Round is allocated and waiting to be started by a volunteer.',
    inProgress: 'Round is currently in progress.',
    submitted: 'Round has been submitted and is awaiting evaluation.',
    evaluated: 'Round has already been evaluated.',
  };
  return statusMessages[status] || 'Round details retrieved successfully.';
};

/**
 * Controller: getActiveRoundStatus
 * Endpoint: GET /api/rounds/active
 * Access: Protected (Student only)
 *
 * Responsibilities:
 * 1. Identifies student exclusively via req.student (never params/query/body studentId or USN).
 * 2. Enforces registrationComplete === true and valid currentLevel.
 * 3. Fetches the authenticated student's current-level Round (excluding abandoned rounds).
 * 4. Synchronizes deadline & expiration status via syncRoundDeadlineState().
 * 5. Derives consistent student.roundAvailability via deriveStudentRoundAvailability().
 * 6. Exposes only public student-safe question/timer fields (no hiddenTestCases, googleSubjectId, or staff info).
 * 7. Does NOT modify wallet balances or level progression.
 */
const getActiveRoundStatus = async (req, res) => {
  try {
    const student = req.student;

    if (!student.registrationComplete) {
      return res.status(403).json({
        success: false,
        code: 'REGISTRATION_INCOMPLETE',
        message: 'Registration must be completed before viewing your active round status.',
      });
    }

    const currentLevel = student.currentLevel;
    if (!currentLevel || currentLevel < 1 || currentLevel > TOTAL_LEVELS) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_STUDENT_LEVEL',
        message: 'Student current level is invalid.',
      });
    }

    const round = await Round.findOne({
      studentId: student._id,
      levelNumber: currentLevel,
      status: { $ne: 'abandoned' },
    });

    if (!round) {
      return res.status(404).json({
        success: false,
        code: 'ROUND_NOT_ALLOCATED',
        message: `No round has been allocated for Level ${currentLevel} yet.`,
        currentLevel,
        roundAvailability: deriveStudentRoundAvailability(student, null),
      });
    }

    const timerSync = await syncRoundDeadlineState(round);
    if (timerSync.error) {
      return res.status(timerSync.error.status).json({
        success: false,
        code: timerSync.error.code,
        message: timerSync.error.message,
      });
    }

    const syncedRound = timerSync.round;

    return res.status(200).json({
      success: true,
      message: getActiveRoundStatusMessage(syncedRound.status, timerSync.isExpired),
      currentLevel,
      roundAvailability: deriveStudentRoundAvailability(student, syncedRound),
      competitionStatus: student.competitionStatus,
      round: formatRoundStudentResponse(syncedRound, {
        remainingSeconds: timerSync.remainingSeconds,
        isExpired: timerSync.isExpired,
      }),
    });
  } catch (error) {
    console.error('Error retrieving active round status:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to retrieve active round status.',
    });
  }
};

module.exports = {
  getLevelInfo,
  allocateQuestion,
  getActiveRoundStatus,
  syncRoundDeadlineState,
  deriveStudentRoundAvailability,
  resolveStudentLiveState,
};
