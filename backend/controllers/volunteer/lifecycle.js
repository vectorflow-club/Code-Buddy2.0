const { Round, Level, Evaluation } = require('../../models');
const { formatRoundStudentResponse, computeTimerFields } = require('../../utils');
const { syncRoundDeadlineState } = require('../roundController');
const { resolveRegisteredStudent, formatStudentVolunteerResponse } = require('./lookup');

/**
 * Helper to format consistent round-start conflict responses for non-ready statuses.
 */
const buildRoundStartConflict = (status, currentLevel) => ({
  success: false,
  code: status === 'inProgress' ? 'ROUND_ALREADY_STARTED' : 'INVALID_ROUND_STATUS',
  message:
    status === 'inProgress'
      ? `Round for Level ${currentLevel} is already in progress and cannot be restarted.`
      : `Cannot start round with status '${status}'. Only 'ready' rounds can be started.`,
});

/**
 * Start a student's allocated round for their current level
 * Endpoint: POST /api/volunteer/students/:usn/round/start
 * Access: Protected (Volunteer only)
 */
const startStudentRoundByUsn = async (req, res) => {
  try {
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

    if (existingRound.status !== 'ready') {
      return res.status(409).json(buildRoundStartConflict(existingRound.status, currentLevel));
    }

    // 4. Resolve authoritative round duration from active Level configuration (never hardcoded)
    const levelConfig = await Level.findOne({ number: currentLevel, isActive: true });
    if (!levelConfig) {
      return res.status(404).json({
        success: false,
        code: 'LEVEL_NOT_FOUND',
        message: `Active level configuration for Level ${currentLevel} was not found.`,
      });
    }

    const durationSeconds = Number.isFinite(levelConfig.durationSeconds)
      ? levelConfig.durationSeconds
      : existingRound.durationSeconds;

    if (!Number.isFinite(durationSeconds) || durationSeconds < 10) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ROUND_DURATION',
        message: 'Authoritative level duration must be at least 10 seconds.',
      });
    }

    const startedAt = new Date();
    const deadline = new Date(startedAt.getTime() + durationSeconds * 1000);

    const startedRound = await Round.findOneAndUpdate(
      {
        _id: existingRound._id,
        status: 'ready',
      },
      {
        $set: {
          status: 'inProgress',
          durationSeconds,
          startedAt,
          deadline,
          startedBy: req.volunteer._id,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!startedRound) {
      const latestRound = await Round.findById(existingRound._id);
      if (!latestRound) {
        return res.status(404).json({
          success: false,
          code: 'ROUND_NOT_ALLOCATED',
          message: `Round for Level ${currentLevel} no longer exists.`,
        });
      }
      return res.status(409).json(buildRoundStartConflict(latestRound.status, currentLevel));
    }

    return res.status(200).json({
      success: true,
      message: 'Round started successfully.',
      student: formatStudentVolunteerResponse(student, startedRound),
      round: {
        ...formatRoundStudentResponse(startedRound),
        startedBy: startedRound.startedBy ? startedRound.startedBy.toString() : req.volunteer._id.toString(),
      },
      startedBy: {
        id: req.volunteer._id.toString(),
        name: req.volunteer.name,
        username: req.volunteer.username,
        assignedLab: req.volunteer.assignedLab || '',
      },
    });
  } catch (error) {
    console.error('Error starting student round:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to start student round.',
    });
  }
};

/**
 * Helper to validate extensionSeconds (strict positive safe integer) and optional reason.
 */
const parseExtensionPayload = (body) => {
  const { extensionSeconds, reason } = body || {};

  if (
    extensionSeconds === undefined ||
    extensionSeconds === null ||
    typeof extensionSeconds === 'boolean' ||
    (typeof extensionSeconds !== 'number' && typeof extensionSeconds !== 'string') ||
    (typeof extensionSeconds === 'string' && !/^-?\d+$/.test(extensionSeconds.trim()))
  ) {
    return {
      error: {
        status: 400,
        code: 'INVALID_EXTENSION_SECONDS',
        message: 'extensionSeconds is required and must be a positive integer.',
      },
    };
  }

  const parsedExtensionSeconds =
    typeof extensionSeconds === 'number' ? extensionSeconds : Number(extensionSeconds.trim());

  if (!Number.isSafeInteger(parsedExtensionSeconds) || parsedExtensionSeconds <= 0) {
    return {
      error: {
        status: 400,
        code: 'INVALID_EXTENSION_SECONDS',
        message: 'extensionSeconds must be a positive integer greater than 0.',
      },
    };
  }

  if (reason !== undefined && typeof reason !== 'string') {
    return {
      error: {
        status: 400,
        code: 'INVALID_EXTENSION_REASON',
        message: 'Extension reason must be a string.',
      },
    };
  }

  return {
    extensionSeconds: parsedExtensionSeconds,
    reason: typeof reason === 'string' ? reason.trim() : '',
  };
};

/**
 * Helper to format an ineligible round status rejection for extension requests.
 */
const buildExtensionIneligibleResponse = (status, currentLevel) => {
  if (status === 'timeExpired') {
    return {
      status: 409,
      code: 'ROUND_TIMER_EXPIRED',
      message: `Cannot extend round for Level ${currentLevel} because the timer has already expired.`,
    };
  }
  return {
    status: 409,
    code: 'INVALID_ROUND_STATUS',
    message: `Cannot extend round with status '${status}'. Only 'inProgress' rounds can be extended.`,
  };
};

/**
 * Extend an active student round's deadline
 * Endpoint: POST /api/volunteer/students/:usn/round/extend
 * Access: Protected (Volunteer only)
 */
const extendStudentRoundByUsn = async (req, res) => {
  try {
    const parsedPayload = parseExtensionPayload(req.body);
    if (parsedPayload.error) {
      return res.status(parsedPayload.error.status).json({
        success: false,
        code: parsedPayload.error.code,
        message: parsedPayload.error.message,
      });
    }

    const { extensionSeconds: parsedExtensionSeconds, reason: normalizedReason } = parsedPayload;

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

    const initialRound = await Round.findOne({
      studentId: student._id,
      levelNumber: currentLevel,
    });

    if (!initialRound) {
      return res.status(404).json({
        success: false,
        code: 'ROUND_NOT_ALLOCATED',
        message: `Student ${normalizedUsn} does not have an allocated round for Level ${currentLevel}.`,
      });
    }

    // 4. Optimistic Concurrency Control (CAS) loop on stored deadline to prevent lost updates
    const MAX_CAS_ATTEMPTS = 5;
    let candidateRound = initialRound;
    let extendedRound = null;

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      if (candidateRound.status !== 'inProgress') {
        const conflict = buildExtensionIneligibleResponse(candidateRound.status, currentLevel);
        return res.status(conflict.status).json({
          success: false,
          code: conflict.code,
          message: conflict.message,
        });
      }

      // Sync timer state so an un-synced expired round cannot be extended
      const timerSync = await syncRoundDeadlineState(candidateRound);
      if (timerSync.error) {
        return res.status(timerSync.error.status).json({
          success: false,
          code: timerSync.error.code,
          message: timerSync.error.message,
        });
      }

      if (timerSync.isExpired || timerSync.round.status === 'timeExpired') {
        const conflict = buildExtensionIneligibleResponse('timeExpired', currentLevel);
        return res.status(conflict.status).json({
          success: false,
          code: conflict.code,
          message: conflict.message,
        });
      }

      const activeRound = timerSync.round;
      const storedDeadlineDate = new Date(activeRound.deadline);
      const newDeadlineMs = storedDeadlineDate.getTime() + parsedExtensionSeconds * 1000;

      // Guard against JavaScript Date maximum timestamp overflow (8.64e15 ms)
      if (!Number.isFinite(newDeadlineMs) || newDeadlineMs > 8.64e15) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_EXTENSION_SECONDS',
          message: 'Requested extension produces an invalid deadline timestamp.',
        });
      }

      const extensionEntry = {
        extendedBy: req.volunteer._id,
        secondsAdded: parsedExtensionSeconds,
        reason: normalizedReason,
        timestamp: new Date(),
      };

      const updated = await Round.findOneAndUpdate(
        {
          _id: activeRound._id,
          status: 'inProgress',
          deadline: storedDeadlineDate,
        },
        {
          $set: {
            deadline: new Date(newDeadlineMs),
          },
          $push: {
            timerExtensions: extensionEntry,
          },
        },
        {
          new: true,
          runValidators: true,
        }
      );

      if (updated) {
        extendedRound = updated;
        break;
      }

      // Concurrent write altered deadline or status; re-fetch for retry or conflict report
      const refreshedRound = await Round.findById(activeRound._id);
      if (!refreshedRound) {
        return res.status(404).json({
          success: false,
          code: 'ROUND_NOT_ALLOCATED',
          message: `Round for Level ${currentLevel} no longer exists.`,
        });
      }
      candidateRound = refreshedRound;
    }

    if (!extendedRound) {
      return res.status(409).json({
        success: false,
        code: 'EXTENSION_CONFLICT',
        message: 'Could not apply timer extension due to concurrent modifications. Please retry.',
      });
    }

    const updatedTimer = computeTimerFields(extendedRound);

    return res.status(200).json({
      success: true,
      message: `Round deadline extended by ${parsedExtensionSeconds} seconds.`,
      extensionSeconds: parsedExtensionSeconds,
      student: formatStudentVolunteerResponse(student, extendedRound),
      round: {
        ...formatRoundStudentResponse(extendedRound, updatedTimer),
        startedBy: extendedRound.startedBy ? extendedRound.startedBy.toString() : null,
        timerExtensions: Array.isArray(extendedRound.timerExtensions)
          ? extendedRound.timerExtensions.map((ext) => ({
              extendedBy: ext.extendedBy ? ext.extendedBy.toString() : null,
              secondsAdded: ext.secondsAdded,
              reason: ext.reason || '',
              timestamp: ext.timestamp,
            }))
          : [],
      },
      extendedBy: {
        id: req.volunteer._id.toString(),
        name: req.volunteer.name,
        username: req.volunteer.username,
        assignedLab: req.volunteer.assignedLab || '',
      },
    });
  } catch (error) {
    console.error('Error extending student round timer:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to extend round timer.',
    });
  }
};

/**
 * Helper to strictly validate manual PASS/FAIL evaluation payload.
 * Rejects evaluator spoofing fields or unsupported properties.
 */
const parseEvaluationPayload = (body) => {
  const payload = body || {};
  const allowedFields = ['result', 'remarks', 'programmingLanguage'];
  const extraFields = Object.keys(payload).filter((key) => !allowedFields.includes(key));

  if (extraFields.length > 0) {
    return {
      error: {
        status: 400,
        code: 'UNSUPPORTED_FIELDS',
        message: `Request contains unsupported fields: ${extraFields.join(', ')}.`,
      },
    };
  }

  const { result, remarks, programmingLanguage } = payload;

  if (!result || typeof result !== 'string') {
    return {
      error: {
        status: 400,
        code: 'INVALID_EVALUATION_RESULT',
        message: "Evaluation result is required and must be 'PASS' or 'FAIL'.",
      },
    };
  }

  const normalizedResult = result.trim().toUpperCase();
  if (!['PASS', 'FAIL'].includes(normalizedResult)) {
    return {
      error: {
        status: 400,
        code: 'INVALID_EVALUATION_RESULT',
        message: "Evaluation result must be strictly 'PASS' or 'FAIL'.",
      },
    };
  }

  if (remarks !== undefined && remarks !== null && typeof remarks !== 'string') {
    return {
      error: {
        status: 400,
        code: 'INVALID_REMARKS',
        message: 'Remarks must be a string.',
      },
    };
  }

  const normalizedRemarks = typeof remarks === 'string' ? remarks.trim() : '';
  if (normalizedRemarks.length > 1000) {
    return {
      error: {
        status: 400,
        code: 'INVALID_REMARKS',
        message: 'Remarks cannot exceed 1000 characters.',
      },
    };
  }

  if (programmingLanguage !== undefined && programmingLanguage !== null && typeof programmingLanguage !== 'string') {
    return {
      error: {
        status: 400,
        code: 'INVALID_PROGRAMMING_LANGUAGE',
        message: 'Programming language must be a string.',
      },
    };
  }

  const normalizedLanguage = typeof programmingLanguage === 'string' ? programmingLanguage.trim() : '';
  if (normalizedLanguage.length > 50) {
    return {
      error: {
        status: 400,
        code: 'INVALID_PROGRAMMING_LANGUAGE',
        message: 'Programming language cannot exceed 50 characters.',
      },
    };
  }

  return {
    result: normalizedResult,
    remarks: normalizedRemarks,
    programmingLanguage: normalizedLanguage,
  };
};

/**
 * Format Evaluation document cleanly for API response.
 */
const formatEvaluationResponse = (evaluation) => ({
  id: (evaluation._id || '').toString(),
  roundId: (evaluation.roundId || '').toString(),
  studentId: (evaluation.studentId || '').toString(),
  questionId: (evaluation.questionId || '').toString(),
  levelNumber: evaluation.levelNumber,
  status: evaluation.status,
  volunteerNotes: evaluation.volunteerNotes || '',
  programmingLanguage: evaluation.programmingLanguage || '',
  evaluatedBy: evaluation.evaluatedBy ? evaluation.evaluatedBy.toString() : null,
  evaluatedAt: evaluation.evaluatedAt || null,
  isSettled: Boolean(evaluation.isSettled),
  settledAt: evaluation.settledAt || null,
  settledBy: evaluation.settledBy ? evaluation.settledBy.toString() : null,
  settlementTransactionId: evaluation.settlementTransactionId
    ? evaluation.settlementTransactionId.toString()
    : null,
  isProgressed: Boolean(evaluation.isProgressed),
  progressedAt: evaluation.progressedAt || null,
  progressedBy: evaluation.progressedBy ? evaluation.progressedBy.toString() : null,
});

/**
 * Manually evaluate a student's current-level round as PASS or FAIL
 * Endpoint: POST /api/volunteer/students/:usn/round/evaluate
 * Access: Protected (Volunteer only)
 *
 * Strictly handles manual evaluation persistence only; does NOT perform wallet
 * settlement, transaction creation, or level progression.
 */
const evaluateStudentRoundByUsn = async (req, res) => {
  try {
    const parsedPayload = parseEvaluationPayload(req.body);
    if (parsedPayload.error) {
      return res.status(parsedPayload.error.status).json({
        success: false,
        code: parsedPayload.error.code,
        message: parsedPayload.error.message,
      });
    }

    const { result: normalizedResult, remarks: normalizedRemarks, programmingLanguage: normalizedLanguage } = parsedPayload;

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

    if (existingRound.status === 'evaluated') {
      return res.status(409).json({
        success: false,
        code: 'ROUND_ALREADY_EVALUATED',
        message: `Round for Level ${currentLevel} has already been evaluated.`,
      });
    }

    // 4. Sync inProgress deadline state so expired rounds accurately record before evaluation
    let targetRound = existingRound;
    if (existingRound.status === 'inProgress') {
      const timerSync = await syncRoundDeadlineState(existingRound);
      if (timerSync.error) {
        return res.status(timerSync.error.status).json({
          success: false,
          code: timerSync.error.code,
          message: timerSync.error.message,
        });
      }
      targetRound = timerSync.round;
    }

    if (!['inProgress', 'timeExpired'].includes(targetRound.status)) {
      return res.status(409).json({
        success: false,
        code: targetRound.status === 'evaluated' ? 'ROUND_ALREADY_EVALUATED' : 'INVALID_ROUND_STATUS',
        message:
          targetRound.status === 'evaluated'
            ? `Round for Level ${currentLevel} has already been evaluated.`
            : `Cannot evaluate round with status '${targetRound.status}'. Only 'inProgress' or 'timeExpired' rounds may be evaluated.`,
      });
    }

    const existingEvaluation = await Evaluation.findOne({ roundId: targetRound._id });
    if (existingEvaluation) {
      return res.status(409).json({
        success: false,
        code: 'ROUND_ALREADY_EVALUATED',
        message: `Round for Level ${currentLevel} has already been evaluated.`,
      });
    }

    const evaluatedAt = new Date();
    const preEvaluationStatus = targetRound.status;

    const evaluatedRound = await Round.findOneAndUpdate(
      {
        _id: targetRound._id,
        status: { $in: ['inProgress', 'timeExpired'] },
      },
      {
        $set: {
          status: 'evaluated',
          completedAt: evaluatedAt,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!evaluatedRound) {
      const latestRound = await Round.findById(targetRound._id);
      const latestStatus = latestRound ? latestRound.status : 'unknown';
      return res.status(409).json({
        success: false,
        code: latestStatus === 'evaluated' ? 'ROUND_ALREADY_EVALUATED' : 'INVALID_ROUND_STATUS',
        message:
          latestStatus === 'evaluated'
            ? `Round for Level ${currentLevel} has already been evaluated.`
            : `Cannot evaluate round with current status '${latestStatus}'.`,
      });
    }

    // 8. Persist authoritative Evaluation document (unique index on roundId prevents duplicates)
    const evaluationDoc = new Evaluation({
      roundId: evaluatedRound._id,
      studentId: student._id,
      questionId: evaluatedRound.questionId,
      levelNumber: currentLevel,
      status: normalizedResult,
      evaluatedBy: req.volunteer._id,
      evaluatedAt,
      programmingLanguage: normalizedLanguage,
      volunteerNotes: normalizedRemarks,
    });

    let savedEvaluation;
    try {
      savedEvaluation = await evaluationDoc.save();
    } catch (saveError) {
      if (saveError.code === 11000 || (saveError.message && saveError.message.includes('E11000'))) {
        return res.status(409).json({
          success: false,
          code: 'ROUND_ALREADY_EVALUATED',
          message: `Round for Level ${currentLevel} has already been evaluated.`,
        });
      }

      await Round.findOneAndUpdate(
        { _id: evaluatedRound._id, status: 'evaluated' },
        { $set: { status: preEvaluationStatus, completedAt: null } }
      );
      throw saveError;
    }

    return res.status(200).json({
      success: true,
      message: `Round evaluated as ${normalizedResult}.`,
      evaluation: formatEvaluationResponse(savedEvaluation),
      student: formatStudentVolunteerResponse(student, evaluatedRound),
      round: {
        ...formatRoundStudentResponse(evaluatedRound),
        startedBy: evaluatedRound.startedBy ? evaluatedRound.startedBy.toString() : null,
      },
      evaluatedBy: {
        id: req.volunteer._id.toString(),
        name: req.volunteer.name,
        username: req.volunteer.username,
        assignedLab: req.volunteer.assignedLab || '',
      },
    });
  } catch (error) {
    console.error('Error evaluating student round:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to evaluate student round.',
    });
  }
};

module.exports = {
  formatEvaluationResponse,
  startStudentRoundByUsn,
  extendStudentRoundByUsn,
  evaluateStudentRoundByUsn,
};
