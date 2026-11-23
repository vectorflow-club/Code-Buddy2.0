const mongoose = require('mongoose');
const { Student, Round, Level, Evaluation, Transaction } = require('../../models');
const { formatRoundStudentResponse, createHttpError } = require('../../utils');
const { resolveRegisteredStudent, formatStudentVolunteerResponse } = require('./lookup');
const { formatEvaluationResponse } = require('./lifecycle');
const { TOTAL_LEVELS, TRANSACTION_TYPES } = require('../../constants');

/**
 * Helper to create a structured HTTP error that cleanly aborts MongoDB transactions.
 */
const createSettlementHttpError = (status, code, message) =>
  createHttpError(status, code, message, 'isSettlementHttpError');

/**
 * Derive authoritative immutable Transaction type from evaluation status,
 * balance delta, and Level safe-zone flag (never inferred from entryRiskAmount).
 */
const resolveSettlementTransactionType = (evaluationStatus, deltaAmount, levelConfig) => {
  if (evaluationStatus === 'PASS') {
    return TRANSACTION_TYPES.REWARD_CREDIT;
  }
  if (deltaAmount < 0) {
    return TRANSACTION_TYPES.STAKE_DEBIT;
  }
  if (levelConfig.isSafeZone === true) {
    return TRANSACTION_TYPES.SAFE_ZONE_PAYOUT;
  }
  return TRANSACTION_TYPES.ROUND_SETTLEMENT;
};

/**
 * Format immutable Transaction document for API response.
 */
const formatTransactionResponse = (transaction) => ({
  id: (transaction._id || '').toString(),
  studentId: (transaction.studentId || '').toString(),
  type: transaction.type,
  status: transaction.status || 'SUCCESS',
  amount: transaction.amount,
  balanceAfter: transaction.balanceAfter,
  levelNumber: transaction.levelNumber,
  roundId: transaction.roundId ? transaction.roundId.toString() : null,
  settlementKey: transaction.settlementKey || null,
  description: transaction.description,
  performedBy: transaction.performedBy ? transaction.performedBy.toString() : null,
  timestamp: transaction.timestamp,
});

/**
 * Helper to fetch and cross-verify authoritative Student, current-level Round,
 * and active Level configuration inside a MongoDB transaction session.
 */
const loadTxStudentRoundAndLevel = async ({
  session,
  studentId,
  normalizedUsn,
  detectAlreadyProgressedOnAdvance = false,
  actionLabel = 'settle',
}) => {
  const sessionStudent = await Student.findById(studentId).session(session);
  if (!sessionStudent) {
    throw createSettlementHttpError(404, 'STUDENT_NOT_FOUND', `Student ${normalizedUsn} no longer exists.`);
  }

  const sessionCurrentLevel = sessionStudent.currentLevel;
  if (!sessionCurrentLevel || sessionCurrentLevel < 1 || sessionCurrentLevel > TOTAL_LEVELS) {
    throw createSettlementHttpError(400, 'INVALID_STUDENT_LEVEL', 'Student current level is invalid.');
  }

  const sessionRound = await Round.findOne({
    studentId: sessionStudent._id,
    levelNumber: sessionCurrentLevel,
  }).session(session);

  if (!sessionRound) {
    if (detectAlreadyProgressedOnAdvance && sessionCurrentLevel > 1) {
      const previousRound = await Round.findOne({
        studentId: sessionStudent._id,
        levelNumber: sessionCurrentLevel - 1,
      }).session(session);

      if (previousRound && previousRound.status === 'evaluated') {
        const previousEvaluation = await Evaluation.findOne({ roundId: previousRound._id }).session(session);
        if (previousEvaluation && previousEvaluation.isProgressed) {
          throw createSettlementHttpError(
            409,
            'ROUND_ALREADY_PROGRESSED',
            `Round for Level ${sessionCurrentLevel - 1} has already been progressed (student is now at Level ${sessionCurrentLevel}).`
          );
        }
      }
    }

    if (detectAlreadyProgressedOnAdvance && sessionStudent.competitionStatus === 'eliminated') {
      throw createSettlementHttpError(
        409,
        'STUDENT_ELIMINATED',
        'Student has already been eliminated and cannot progress further.'
      );
    }

    if (detectAlreadyProgressedOnAdvance && sessionStudent.competitionStatus === 'completed') {
      throw createSettlementHttpError(
        409,
        'COMPETITION_COMPLETED',
        'Student has already completed all competition levels.'
      );
    }

    throw createSettlementHttpError(
      404,
      'ROUND_NOT_ALLOCATED',
      `Round for Level ${sessionCurrentLevel} no longer exists.`
    );
  }

  if (!sessionRound.studentId || sessionRound.studentId.toString() !== sessionStudent._id.toString()) {
    throw createSettlementHttpError(
      409,
      'ROUND_STUDENT_MISMATCH',
      'Round ownership mismatch against authenticated student record.'
    );
  }

  if (sessionRound.levelNumber !== sessionCurrentLevel) {
    throw createSettlementHttpError(
      409,
      'ROUND_LEVEL_MISMATCH',
      `Round level (${sessionRound.levelNumber}) does not match student currentLevel (${sessionCurrentLevel}).`
    );
  }

  if (sessionRound.status !== 'evaluated') {
    throw createSettlementHttpError(
      409,
      'ROUND_NOT_EVALUATED',
      `Cannot ${actionLabel} round with status '${sessionRound.status}'.`
    );
  }

  const levelConfig = await Level.findOne({
    number: sessionCurrentLevel,
    isActive: true,
  }).session(session);

  if (!levelConfig || levelConfig.number !== sessionCurrentLevel) {
    throw createSettlementHttpError(
      404,
      'LEVEL_NOT_FOUND',
      `Active level configuration for Level ${sessionCurrentLevel} was not found.`
    );
  }

  return { sessionStudent, sessionCurrentLevel, sessionRound, levelConfig };
};

/**
 * Helper to verify Evaluation ownership, level, round link, and terminal grading status.
 */
const verifyEvaluationLinks = (claimedEvaluation, sessionRound, sessionStudent) => {
  if (!claimedEvaluation.roundId || claimedEvaluation.roundId.toString() !== sessionRound._id.toString()) {
    throw createSettlementHttpError(
      409,
      'EVALUATION_ROUND_MISMATCH',
      'Evaluation round reference does not match current round.'
    );
  }

  if (!claimedEvaluation.studentId || claimedEvaluation.studentId.toString() !== sessionStudent._id.toString()) {
    throw createSettlementHttpError(
      409,
      'EVALUATION_STUDENT_MISMATCH',
      'Evaluation student reference does not match current student.'
    );
  }

  if (claimedEvaluation.levelNumber !== sessionRound.levelNumber) {
    throw createSettlementHttpError(
      409,
      'EVALUATION_LEVEL_MISMATCH',
      `Evaluation level (${claimedEvaluation.levelNumber}) does not match round level (${sessionRound.levelNumber}).`
    );
  }

  if (!['PASS', 'FAIL'].includes(claimedEvaluation.status)) {
    throw createSettlementHttpError(
      409,
      'EVALUATION_PENDING',
      `Cannot settle evaluation with status '${claimedEvaluation.status}'.`
    );
  }
};

/**
 * Execute Task 7 wallet settlement, immutable Transaction insert, and Evaluation linkage
 * inside an active MongoDB transaction session.
 */
const applyRoundSettlementInTx = async ({
  session,
  volunteerId,
  settledAt,
  sessionStudent,
  sessionCurrentLevel,
  sessionRound,
  levelConfig,
  claimedEvaluation,
  updateStudentWallet = true,
}) => {
  const previousWalletBalance = sessionStudent.walletBalance ?? 0;
  const targetBalance =
    claimedEvaluation.status === 'PASS'
      ? levelConfig.winningPayout
      : levelConfig.losingPayout;

  if (typeof targetBalance !== 'number' || !Number.isFinite(targetBalance) || targetBalance < 0) {
    throw createSettlementHttpError(
      500,
      'INVALID_LEVEL_PAYOUT',
      `Authoritative payout configuration for Level ${sessionCurrentLevel} is invalid.`
    );
  }

  const deltaAmount = targetBalance - previousWalletBalance;
  const transactionAmount = Math.abs(deltaAmount);
  const transactionType = resolveSettlementTransactionType(
    claimedEvaluation.status,
    deltaAmount,
    levelConfig
  );
  const settlementKey = `round_settlement:${sessionRound._id.toString()}`;
  const description = `Level ${sessionCurrentLevel} ${claimedEvaluation.status} settlement (${previousWalletBalance} -> ${targetBalance})`;

  let updatedStudent = sessionStudent;
  if (updateStudentWallet) {
    updatedStudent = await Student.findByIdAndUpdate(
      sessionStudent._id,
      {
        $set: {
          walletBalance: targetBalance,
        },
      },
      {
        session,
        new: true,
        runValidators: true,
      }
    );

    if (!updatedStudent) {
      throw createSettlementHttpError(404, 'STUDENT_NOT_FOUND', 'Student update failed during settlement.');
    }
  }

  const transactionDoc = new Transaction({
    studentId: sessionStudent._id,
    type: transactionType,
    status: 'SUCCESS',
    amount: transactionAmount,
    balanceAfter: targetBalance,
    levelNumber: sessionCurrentLevel,
    roundId: sessionRound._id,
    settlementKey,
    description,
    performedBy: volunteerId,
    timestamp: settledAt,
  });

  const savedTransaction = await transactionDoc.save({ session });

  const finalizedEvaluation = await Evaluation.findByIdAndUpdate(
    claimedEvaluation._id,
    {
      $set: {
        settlementTransactionId: savedTransaction._id,
      },
    },
    {
      session,
      new: true,
      runValidators: true,
    }
  );

  return {
    previousWalletBalance,
    targetBalance,
    deltaAmount,
    updatedStudent,
    finalizedEvaluation: finalizedEvaluation || claimedEvaluation,
    savedTransaction,
  };
};

/**
 * Retrieve and verify an existing settlement Transaction when progression reuses prior settlement.
 */
const resolveExistingSettlementInTx = async ({
  session,
  claimedEvaluation,
  sessionStudent,
  sessionRound,
  sessionCurrentLevel,
  levelConfig,
}) => {
  const settlementKey = `round_settlement:${sessionRound._id.toString()}`;
  let existingTransaction = null;

  if (claimedEvaluation.settlementTransactionId) {
    existingTransaction = await Transaction.findById(claimedEvaluation.settlementTransactionId).session(session);
  }
  if (!existingTransaction) {
    existingTransaction = await Transaction.findOne({ settlementKey }).session(session);
  }

  if (!existingTransaction) {
    throw createSettlementHttpError(
      500,
      'INCONSISTENT_SETTLEMENT_STATE',
      'Evaluation is marked settled, but its immutable settlement transaction could not be found.'
    );
  }

  if (
    !existingTransaction.studentId ||
    existingTransaction.studentId.toString() !== sessionStudent._id.toString() ||
    !existingTransaction.roundId ||
    existingTransaction.roundId.toString() !== sessionRound._id.toString()
  ) {
    throw createSettlementHttpError(
      409,
      'INCONSISTENT_SETTLEMENT_STATE',
      'Settlement transaction ownership mismatch detected.'
    );
  }

  const targetBalance =
    claimedEvaluation.status === 'PASS'
      ? levelConfig.winningPayout
      : levelConfig.losingPayout;

  if (typeof targetBalance !== 'number' || !Number.isFinite(targetBalance) || targetBalance < 0) {
    throw createSettlementHttpError(
      500,
      'INVALID_LEVEL_PAYOUT',
      `Authoritative payout configuration for Level ${sessionCurrentLevel} is invalid.`
    );
  }

  if (
    existingTransaction.balanceAfter !== targetBalance ||
    (sessionStudent.walletBalance ?? 0) !== targetBalance
  ) {
    throw createSettlementHttpError(
      409,
      'INCONSISTENT_SETTLEMENT_STATE',
      'Existing settlement balance does not match authoritative level payout rules.'
    );
  }

  const previousWalletBalance =
    existingTransaction.type === TRANSACTION_TYPES.STAKE_DEBIT
      ? existingTransaction.balanceAfter + existingTransaction.amount
      : existingTransaction.balanceAfter - existingTransaction.amount;

  return {
    previousWalletBalance,
    targetBalance,
    deltaAmount: targetBalance - previousWalletBalance,
    existingTransaction,
  };
};

/**
 * Shared error responder for transactional settlement and progression controllers.
 */
const handleTxErrorResponse = (res, error, {
  logPrefix,
  duplicateKeyCode,
  duplicateKeyMessage,
  conflictCode,
  conflictMessage,
  fallbackMessage,
}) => {
  if (error && error.isSettlementHttpError) {
    return res.status(error.status).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }

  if (error && (error.code === 11000 || (error.message && error.message.includes('E11000')))) {
    return res.status(409).json({
      success: false,
      code: duplicateKeyCode,
      message: duplicateKeyMessage,
    });
  }

  if (
    error &&
    (error.code === 112 ||
      (typeof error.hasErrorLabel === 'function' && error.hasErrorLabel('TransientTransactionError')))
  ) {
    return res.status(409).json({
      success: false,
      code: conflictCode,
      message: conflictMessage,
    });
  }

  console.error(`${logPrefix}:`, error.message);
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_SERVER_ERROR',
    message: fallbackMessage,
  });
};

/**
 * Atomically settle a student's wallet balance based on their already-recorded PASS/FAIL evaluation
 * Endpoint: POST /api/volunteer/students/:usn/round/settle
 * Access: Protected (Volunteer only)
 *
 * Scope: Updates ONLY student.walletBalance and creates ONE immutable Transaction ledger entry
 * inside a MongoDB ACID transaction, preserving Evaluation status and leaving progression
 * fields (currentLevel, levelsCleared, competitionStatus, safeZoneAmount, totals) unchanged.
 */
const settleStudentRoundByUsn = async (req, res) => {
  // 1. Reject any client-supplied wallet amounts, evaluation results, or level overrides
  const bodyKeys = Object.keys(req.body || {});
  if (bodyKeys.length > 0) {
    return res.status(400).json({
      success: false,
      code: 'UNSUPPORTED_FIELDS',
      message: `Settlement requests do not accept request body fields: ${bodyKeys.join(', ')}.`,
    });
  }

  // 2. Validate USN, locate registered student, verify registrationComplete and currentLevel
  const resolved = await resolveRegisteredStudent(req.params.usn);
  if (resolved.error) {
    return res.status(resolved.error.status).json({
      success: false,
      code: resolved.error.code,
      message: resolved.error.message,
    });
  }

  const { student, normalizedUsn } = resolved;
  const currentLevel = student.currentLevel;

  // 3. Locate student's round for their current level
  const existingRound = await Round.findOne({
    studentId: student._id,
    levelNumber: currentLevel,
  });

  if (!existingRound) {
    return res.status(404).json({
      success: false,
      code: 'ROUND_NOT_ALLOCATED',
      message: `Student ${normalizedUsn} does not have an allocated round for Level ${currentLevel}.`,
    });
  }

  if (existingRound.status !== 'evaluated') {
    return res.status(409).json({
      success: false,
      code: 'ROUND_NOT_EVALUATED',
      message: `Cannot settle round with status '${existingRound.status}'. Round must be evaluated before settlement.`,
    });
  }

  // 4. Execute atomic MongoDB transaction covering Evaluation claim, Student wallet update, and Transaction insert
  const session = await mongoose.startSession();
  let settlementOutput = null;

  try {
    await session.withTransaction(async () => {
      const { sessionStudent, sessionCurrentLevel, sessionRound, levelConfig } =
        await loadTxStudentRoundAndLevel({
          session,
          studentId: student._id,
          normalizedUsn,
          detectAlreadyProgressedOnAdvance: false,
        });

      const settledAt = new Date();
      const claimedEvaluation = await Evaluation.findOneAndUpdate(
        {
          roundId: sessionRound._id,
          $or: [{ isSettled: false }, { isSettled: { $exists: false } }],
        },
        {
          $set: {
            isSettled: true,
            settledAt,
            settledBy: req.volunteer._id,
          },
        },
        {
          session,
          new: true,
          runValidators: true,
        }
      );

      if (!claimedEvaluation) {
        const existingEval = await Evaluation.findOne({ roundId: sessionRound._id }).session(session);
        if (!existingEval) {
          throw createSettlementHttpError(
            404,
            'EVALUATION_NOT_FOUND',
            `No evaluation record found for Level ${sessionCurrentLevel} round.`
          );
        }
        throw createSettlementHttpError(
          409,
          'ROUND_ALREADY_SETTLED',
          `Round for Level ${sessionCurrentLevel} has already been settled.`
        );
      }

      verifyEvaluationLinks(claimedEvaluation, sessionRound, sessionStudent);

      const settlementResult = await applyRoundSettlementInTx({
        session,
        volunteerId: req.volunteer._id,
        settledAt,
        sessionStudent,
        sessionCurrentLevel,
        sessionRound,
        levelConfig,
        claimedEvaluation,
        updateStudentWallet: true,
      });

      settlementOutput = {
        previousWalletBalance: settlementResult.previousWalletBalance,
        targetBalance: settlementResult.targetBalance,
        deltaAmount: settlementResult.deltaAmount,
        isSafeZone: Boolean(levelConfig.isSafeZone),
        student: settlementResult.updatedStudent,
        round: sessionRound,
        evaluation: settlementResult.finalizedEvaluation,
        transaction: settlementResult.savedTransaction,
      };
    });

    return res.status(200).json({
      success: true,
      message: `Round wallet settled successfully (${settlementOutput.evaluation.status}).`,
      settlement: {
        previousWalletBalance: settlementOutput.previousWalletBalance,
        targetBalance: settlementOutput.targetBalance,
        deltaAmount: settlementOutput.deltaAmount,
        evaluationResult: settlementOutput.evaluation.status,
        isSafeZone: settlementOutput.isSafeZone,
      },
      student: formatStudentVolunteerResponse(settlementOutput.student, settlementOutput.round),
      evaluation: formatEvaluationResponse(settlementOutput.evaluation),
      transaction: formatTransactionResponse(settlementOutput.transaction),
      round: {
        ...formatRoundStudentResponse(settlementOutput.round),
        startedBy: settlementOutput.round.startedBy ? settlementOutput.round.startedBy.toString() : null,
      },
      settledBy: {
        id: req.volunteer._id.toString(),
        name: req.volunteer.name,
        username: req.volunteer.username,
        assignedLab: req.volunteer.assignedLab || '',
      },
    });
  } catch (error) {
    return handleTxErrorResponse(res, error, {
      logPrefix: 'Error settling student round wallet',
      duplicateKeyCode: 'ROUND_ALREADY_SETTLED',
      duplicateKeyMessage: `Round for Level ${currentLevel} has already been settled.`,
      conflictCode: 'SETTLEMENT_CONFLICT',
      conflictMessage: 'Concurrent settlement conflict occurred. Please verify round status before retrying.',
      fallbackMessage: 'Failed to settle student round wallet.',
    });
  } finally {
    await session.endSession();
  }
};

/**
 * Atomically progress a student after round evaluation, automatically performing wallet
 * settlement first inside the same transaction if not yet settled (reusing existing settlement
 * without creating duplicate transactions when already settled).
 * Endpoint: POST /api/volunteer/students/:usn/round/progress
 * Access: Protected (Volunteer only)
 */
const progressStudentRoundByUsn = async (req, res) => {
  // 1. Reject any client-supplied progression, balance, level, or verdict parameters
  const bodyKeys = Object.keys(req.body || {});
  if (bodyKeys.length > 0) {
    return res.status(400).json({
      success: false,
      code: 'UNSUPPORTED_FIELDS',
      message: `Progression requests do not accept request body fields: ${bodyKeys.join(', ')}.`,
    });
  }

  // 2. Validate USN, locate registered student, verify registrationComplete and currentLevel
  const resolved = await resolveRegisteredStudent(req.params.usn);
  if (resolved.error) {
    return res.status(resolved.error.status).json({
      success: false,
      code: resolved.error.code,
      message: resolved.error.message,
    });
  }

  const { student, normalizedUsn } = resolved;
  const session = await mongoose.startSession();
  let progressionOutput = null;

  try {
    await session.withTransaction(async () => {
      // 3. Load Student, current-level Round (detecting already-progressed prior level), and active Level inside tx
      const { sessionStudent, sessionCurrentLevel, sessionRound, levelConfig } =
        await loadTxStudentRoundAndLevel({
          session,
          studentId: student._id,
          normalizedUsn,
          detectAlreadyProgressedOnAdvance: true,
          actionLabel: 'progress',
        });

      // 4. Atomically claim progression on Evaluation so each evaluated round progresses at most once
      const progressedAt = new Date();
      const claimedProgressionEval = await Evaluation.findOneAndUpdate(
        {
          roundId: sessionRound._id,
          $or: [{ isProgressed: false }, { isProgressed: { $exists: false } }],
        },
        {
          $set: {
            isProgressed: true,
            progressedAt,
            progressedBy: req.volunteer._id,
          },
        },
        {
          session,
          new: true,
          runValidators: true,
        }
      );

      if (!claimedProgressionEval) {
        const existingEval = await Evaluation.findOne({ roundId: sessionRound._id }).session(session);
        if (!existingEval) {
          throw createSettlementHttpError(
            404,
            'EVALUATION_NOT_FOUND',
            `No evaluation record found for Level ${sessionCurrentLevel} round.`
          );
        }
        throw createSettlementHttpError(
          409,
          'ROUND_ALREADY_PROGRESSED',
          `Round for Level ${sessionCurrentLevel} has already been progressed.`
        );
      }

      verifyEvaluationLinks(claimedProgressionEval, sessionRound, sessionStudent);

      if (sessionStudent.competitionStatus === 'eliminated') {
        throw createSettlementHttpError(
          409,
          'STUDENT_ELIMINATED',
          'Student has already been eliminated and cannot progress further.'
        );
      }

      if (sessionStudent.competitionStatus === 'completed') {
        throw createSettlementHttpError(
          409,
          'COMPETITION_COMPLETED',
          'Student has already completed all competition levels.'
        );
      }

      // 5. Ensure settlement exists once: reuse if already settled, else settle atomically in same tx
      let didSettleNow = false;
      let previousWalletBalance;
      let targetBalance;
      let deltaAmount;
      let finalizedEvaluation = claimedProgressionEval;
      let settlementTransaction;

      if (claimedProgressionEval.isSettled) {
        const existingSettlement = await resolveExistingSettlementInTx({
          session,
          claimedEvaluation: claimedProgressionEval,
          sessionStudent,
          sessionRound,
          sessionCurrentLevel,
          levelConfig,
        });
        previousWalletBalance = existingSettlement.previousWalletBalance;
        targetBalance = existingSettlement.targetBalance;
        deltaAmount = existingSettlement.deltaAmount;
        settlementTransaction = existingSettlement.existingTransaction;
      } else {
        const claimedSettlementEval = await Evaluation.findOneAndUpdate(
          {
            _id: claimedProgressionEval._id,
            $or: [{ isSettled: false }, { isSettled: { $exists: false } }],
          },
          {
            $set: {
              isSettled: true,
              settledAt: progressedAt,
              settledBy: req.volunteer._id,
            },
          },
          {
            session,
            new: true,
            runValidators: true,
          }
        );

        if (!claimedSettlementEval) {
          throw createSettlementHttpError(
            409,
            'SETTLEMENT_CONFLICT',
            'Concurrent settlement state change detected during progression. Please retry.'
          );
        }

        const settlementResult = await applyRoundSettlementInTx({
          session,
          volunteerId: req.volunteer._id,
          settledAt: progressedAt,
          sessionStudent,
          sessionCurrentLevel,
          sessionRound,
          levelConfig,
          claimedEvaluation: claimedSettlementEval,
          updateStudentWallet: false,
        });

        didSettleNow = true;
        previousWalletBalance = settlementResult.previousWalletBalance;
        targetBalance = settlementResult.targetBalance;
        deltaAmount = settlementResult.deltaAmount;
        finalizedEvaluation = settlementResult.finalizedEvaluation;
        settlementTransaction = settlementResult.savedTransaction;
      }

      // 6. Compute progression, safe-zone protection (strictly L1 & L4 on PASS), and cumulative statistics
      const isPass = finalizedEvaluation.status === 'PASS';
      const isFinalLevel = Boolean(levelConfig.isFinal) || sessionCurrentLevel === TOTAL_LEVELS;
      const isSafeZoneCheckpoint =
        isPass && Boolean(levelConfig.isSafeZone) && Number(levelConfig.safeZoneAmount) > 0;

      const prevLevelsCleared = sessionStudent.levelsCleared ?? 0;
      const prevHighestLevel = sessionStudent.highestLevelReached ?? 1;
      const prevSafeZoneAmount = sessionStudent.safeZoneAmount ?? 0;
      const prevTotalEarned = sessionStudent.totalEarned ?? 0;
      const prevTotalRisked = sessionStudent.totalRisked ?? 0;

      const entryRiskAmount =
        typeof levelConfig.entryRiskAmount === 'number' &&
        Number.isFinite(levelConfig.entryRiskAmount) &&
        levelConfig.entryRiskAmount >= 0
          ? levelConfig.entryRiskAmount
          : 0;

      // Positive incremental PASS reward only (L1 FAIL safe-zone payout never increments totalEarned)
      const earnedIncrement = isPass ? Math.max(0, deltaAmount) : 0;
      const hasEntryDebit = Boolean(
        await Transaction.exists({ roundId: sessionRound._id, type: TRANSACTION_TYPES.STAKE_DEBIT }).session(session)
      );
      const riskedIncrement = hasEntryDebit ? 0 : entryRiskAmount;
      const nextTotalEarned = prevTotalEarned + earnedIncrement;
      const nextTotalRisked = prevTotalRisked + riskedIncrement;

      let nextCurrentLevel = sessionCurrentLevel;
      let nextLevelsCleared = prevLevelsCleared;
      let nextHighestLevel = Math.max(prevHighestLevel, sessionCurrentLevel);
      let nextCompetitionStatus;
      let nextRoundAvailability;
      let nextSafeZoneAmount = prevSafeZoneAmount;

      if (isPass) {
        nextLevelsCleared = Math.max(prevLevelsCleared, sessionCurrentLevel);
        if (isSafeZoneCheckpoint) {
          nextSafeZoneAmount = Math.max(prevSafeZoneAmount, levelConfig.safeZoneAmount);
        }

        if (isFinalLevel) {
          nextCurrentLevel = 6;
          nextHighestLevel = 6;
          nextCompetitionStatus = 'completed';
          nextRoundAvailability = 'completed';
        } else {
          nextCurrentLevel = sessionCurrentLevel + 1;
          nextHighestLevel = Math.max(prevHighestLevel, nextCurrentLevel);
          nextCompetitionStatus = 'inProgress';
          nextRoundAvailability = 'ready';
        }
      } else {
        // FAIL at any level immediately eliminates the participant; L1 FAIL leaves safeZoneAmount unchanged (0)
        nextCompetitionStatus = 'eliminated';
        nextRoundAvailability = 'eliminated';
      }

      if (targetBalance < nextSafeZoneAmount) {
        throw createSettlementHttpError(
          500,
          'SAFE_ZONE_CONSISTENCY_ERROR',
          `Wallet balance (${targetBalance}) cannot fall below protected safe-zone amount (${nextSafeZoneAmount}).`
        );
      }

      const studentUpdateSet = {
        currentLevel: nextCurrentLevel,
        highestLevelReached: nextHighestLevel,
        levelsCleared: nextLevelsCleared,
        competitionStatus: nextCompetitionStatus,
        roundAvailability: nextRoundAvailability,
        safeZoneAmount: nextSafeZoneAmount,
        totalEarned: nextTotalEarned,
        totalRisked: nextTotalRisked,
      };
      if (didSettleNow) {
        studentUpdateSet.walletBalance = targetBalance;
      }

      const updatedStudent = await Student.findByIdAndUpdate(
        sessionStudent._id,
        { $set: studentUpdateSet },
        {
          session,
          new: true,
          runValidators: true,
        }
      );

      if (!updatedStudent) {
        throw createSettlementHttpError(404, 'STUDENT_NOT_FOUND', 'Student update failed during progression.');
      }

      progressionOutput = {
        didSettleNow,
        previousWalletBalance,
        targetBalance,
        deltaAmount,
        isLevelSafeZone: Boolean(levelConfig.isSafeZone),
        isSafeZoneCheckpoint,
        isPass,
        isFinalLevel,
        previousLevel: sessionCurrentLevel,
        newLevel: nextCurrentLevel,
        earnedIncrement,
        riskedIncrement,
        student: updatedStudent,
        round: sessionRound,
        evaluation: finalizedEvaluation,
        transaction: settlementTransaction,
      };
    });

    // For L1-L5 PASS, student advanced to nextCurrentLevel where no Round is allocated yet (availability: 'ready')
    const studentViewRound =
      progressionOutput.isPass && !progressionOutput.isFinalLevel ? null : progressionOutput.round;

    return res.status(200).json({
      success: true,
      message: progressionOutput.isPass
        ? progressionOutput.isFinalLevel
          ? 'Final level cleared. Competition completed successfully.'
          : `Level ${progressionOutput.previousLevel} cleared. Student advanced to Level ${progressionOutput.newLevel}.`
        : `Round failed at Level ${progressionOutput.previousLevel}. Student has been eliminated.`,
      settlement: {
        didSettleNow: progressionOutput.didSettleNow,
        previousWalletBalance: progressionOutput.previousWalletBalance,
        targetBalance: progressionOutput.targetBalance,
        deltaAmount: progressionOutput.deltaAmount,
        evaluationResult: progressionOutput.evaluation.status,
        isSafeZone: progressionOutput.isLevelSafeZone,
      },
      progression: {
        evaluatedLevel: progressionOutput.previousLevel,
        evaluationResult: progressionOutput.evaluation.status,
        advancedToLevel:
          progressionOutput.isPass && !progressionOutput.isFinalLevel
            ? progressionOutput.newLevel
            : null,
        isCompleted: progressionOutput.student.competitionStatus === 'completed',
        isEliminated: progressionOutput.student.competitionStatus === 'eliminated',
        isSafeZoneCleared: progressionOutput.isSafeZoneCheckpoint,
        previousLevel: progressionOutput.previousLevel,
        newLevel: progressionOutput.newLevel,
        levelsCleared: progressionOutput.student.levelsCleared,
        highestLevelReached: progressionOutput.student.highestLevelReached,
        competitionStatus: progressionOutput.student.competitionStatus,
        roundAvailability: progressionOutput.student.roundAvailability,
        safeZoneAmount: progressionOutput.student.safeZoneAmount,
        earnedIncrement: progressionOutput.earnedIncrement,
        totalEarned: progressionOutput.student.totalEarned,
        riskedIncrement: progressionOutput.riskedIncrement,
        totalRisked: progressionOutput.student.totalRisked,
      },
      student: formatStudentVolunteerResponse(progressionOutput.student, studentViewRound),
      evaluation: formatEvaluationResponse(progressionOutput.evaluation),
      transaction: formatTransactionResponse(progressionOutput.transaction),
      round: {
        ...formatRoundStudentResponse(progressionOutput.round),
        startedBy: progressionOutput.round.startedBy ? progressionOutput.round.startedBy.toString() : null,
      },
      progressedBy: {
        id: req.volunteer._id.toString(),
        name: req.volunteer.name,
        username: req.volunteer.username,
        assignedLab: req.volunteer.assignedLab || '',
      },
    });
  } catch (error) {
    return handleTxErrorResponse(res, error, {
      logPrefix: 'Error progressing student round',
      duplicateKeyCode: 'ROUND_ALREADY_SETTLED',
      duplicateKeyMessage: 'Round settlement already exists for this round.',
      conflictCode: 'PROGRESSION_CONFLICT',
      conflictMessage: 'Concurrent progression conflict occurred. Please verify round status before retrying.',
      fallbackMessage: 'Failed to progress student round.',
    });
  } finally {
    await session.endSession();
  }
};

module.exports = {
  settleStudentRoundByUsn,
  progressStudentRoundByUsn,
};
