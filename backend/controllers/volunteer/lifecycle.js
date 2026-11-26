const { Round, Level, Evaluation } = require('../../models');
const {
  formatRoundVolunteerResponse,
  formatEvaluationResponse,
  computeTimerFields,
} = require('../../utils');
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
        message: `Student ${normalizedUsn} has no round for Level ${currentLevel} yet.`,
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
        message: `Level ${currentLevel} settings were not found.`,
      });
    }

    const durationSeconds = Number.isFinite(levelConfig.durationSeconds)
      ? levelConfig.durationSeconds
      : existingRound.durationSeconds;

    if (!Number.isFinite(durationSeconds) || durationSeconds < 10) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ROUND_DURATION',
        message: 'Level time must be at least 10 seconds.',
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
          message: `Round for Level ${currentLevel} is gone.`,
        });
      }
      return res.status(409).json(buildRoundStartConflict(latestRound.status, currentLevel));
    }

    return res.status(200).json({
      success: true,
      message: 'Round started.',
      student: formatStudentVolunteerResponse(student, startedRound),
      round: {
        ...formatRoundVolunteerResponse(startedRound),
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
      message: 'Could not start the round.',
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
        message: 'Extra seconds are needed, as a whole number above 0.',
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
        message: 'Extra seconds must be a whole number above 0.',
      },
    };
  }

  if (reason !== undefined && typeof reason !== 'string') {
    return {
      error: {
        status: 400,
        code: 'INVALID_EXTENSION_REASON',
        message: 'Reason must be text.',
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
      message: `Cannot add time to Level ${currentLevel}: time is already up.`,
    };
  }
  return {
    status: 409,
    code: 'INVALID_ROUND_STATUS',
    message: `Cannot add time to a round that is '${status}'. Only rounds in progress can get more time.`,
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
        message: `Student ${normalizedUsn} has no round for Level ${currentLevel} yet.`,
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

      // A paused round keeps its frozen time: add time only after resume.
      if (activeRound.pausedAt) {
        return res.status(409).json({
          success: false,
          code: 'ROUND_PAUSED',
          message: 'Cannot add time to a paused round: resume it first.',
        });
      }

      const storedDeadlineDate = new Date(activeRound.deadline);
      const newDeadlineMs = storedDeadlineDate.getTime() + parsedExtensionSeconds * 1000;

      // Guard against JavaScript Date maximum timestamp overflow (8.64e15 ms)
      if (!Number.isFinite(newDeadlineMs) || newDeadlineMs > 8.64e15) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_EXTENSION_SECONDS',
          message: 'That extra time gives a wrong end time.',
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
          pausedAt: null,
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
          message: `Round for Level ${currentLevel} is gone.`,
        });
      }
      candidateRound = refreshedRound;
    }

    if (!extendedRound) {
      return res.status(409).json({
        success: false,
        code: 'EXTENSION_CONFLICT',
        message: 'Someone else changed the round at the same time. Please try again.',
      });
    }

    const updatedTimer = computeTimerFields(extendedRound);

    return res.status(200).json({
      success: true,
      message: `Round end time moved ${parsedExtensionSeconds} seconds later.`,
      extensionSeconds: parsedExtensionSeconds,
      student: formatStudentVolunteerResponse(student, extendedRound),
      round: {
        ...formatRoundVolunteerResponse(extendedRound, updatedTimer),
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
      message: 'Could not add more time.',
    });
  }
};

/**
 * Helper to format consistent round-reset conflict responses for non-inProgress statuses.
 */
const buildResetIneligibleResponse = (status, currentLevel) => {
  if (status === 'timeExpired') {
    return {
      status: 409,
      code: 'ROUND_TIMER_EXPIRED',
      message: `Cannot reset Level ${currentLevel}: time is already up.`,
    };
  }
  return {
    status: 409,
    code: 'INVALID_ROUND_STATUS',
    message: `Cannot reset a round that is '${status}'. Only rounds in progress can be reset.`,
  };
};

/**
 * Reset a running student round's timer to the full level duration from now
 * Endpoint: POST /api/volunteer/students/:usn/round/reset
 * Access: Protected (Volunteer only)
 */
const resetStudentRoundByUsn = async (req, res) => {
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

    const initialRound = await Round.findOne({
      studentId: student._id,
      levelNumber: currentLevel,
    });

    if (!initialRound) {
      return res.status(404).json({
        success: false,
        code: 'ROUND_NOT_ALLOCATED',
        message: `Student ${normalizedUsn} has no round for Level ${currentLevel} yet.`,
      });
    }

    // Resolve authoritative round duration from active Level configuration (never hardcoded)
    const levelConfig = await Level.findOne({ number: currentLevel, isActive: true });
    if (!levelConfig) {
      return res.status(404).json({
        success: false,
        code: 'LEVEL_NOT_FOUND',
        message: `Level ${currentLevel} settings were not found.`,
      });
    }

    const durationSeconds = Number.isFinite(levelConfig.durationSeconds)
      ? levelConfig.durationSeconds
      : initialRound.durationSeconds;

    if (!Number.isFinite(durationSeconds) || durationSeconds < 10) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ROUND_DURATION',
        message: 'Level time must be at least 10 seconds.',
      });
    }

    // 4. Optimistic Concurrency Control (CAS) loop on stored deadline to prevent lost updates
    const MAX_CAS_ATTEMPTS = 5;
    let candidateRound = initialRound;
    let resetRound = null;

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      if (candidateRound.status !== 'inProgress') {
        const conflict = buildResetIneligibleResponse(candidateRound.status, currentLevel);
        return res.status(conflict.status).json({
          success: false,
          code: conflict.code,
          message: conflict.message,
        });
      }

      // Sync timer state so an un-synced expired round cannot be reset
      const timerSync = await syncRoundDeadlineState(candidateRound);
      if (timerSync.error) {
        return res.status(timerSync.error.status).json({
          success: false,
          code: timerSync.error.code,
          message: timerSync.error.message,
        });
      }

      if (timerSync.isExpired || timerSync.round.status === 'timeExpired') {
        const conflict = buildResetIneligibleResponse('timeExpired', currentLevel);
        return res.status(conflict.status).json({
          success: false,
          code: conflict.code,
          message: conflict.message,
        });
      }

      const activeRound = timerSync.round;

      // A paused round keeps its frozen time: reset only after resume.
      if (activeRound.pausedAt) {
        return res.status(409).json({
          success: false,
          code: 'ROUND_PAUSED',
          message: 'Cannot reset a paused round: resume it first.',
        });
      }

      const storedDeadlineDate = new Date(activeRound.deadline);
      const resetStart = new Date();
      const newDeadlineMs = resetStart.getTime() + durationSeconds * 1000;

      // Guard against JavaScript Date maximum timestamp overflow (8.64e15 ms)
      if (!Number.isFinite(newDeadlineMs) || newDeadlineMs > 8.64e15) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_ROUND_DURATION',
          message: 'That level time gives a wrong end time.',
        });
      }

      const extensionEntry = {
        extendedBy: req.volunteer._id,
        secondsAdded: durationSeconds,
        reason: 'Timer reset to full level time',
        timestamp: resetStart,
      };

      const updated = await Round.findOneAndUpdate(
        {
          _id: activeRound._id,
          status: 'inProgress',
          deadline: storedDeadlineDate,
          pausedAt: null,
        },
        {
          $set: {
            durationSeconds,
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
        resetRound = updated;
        break;
      }

      // Concurrent write altered deadline or status; re-fetch for retry or conflict report
      const refreshedRound = await Round.findById(activeRound._id);
      if (!refreshedRound) {
        return res.status(404).json({
          success: false,
          code: 'ROUND_NOT_ALLOCATED',
          message: `Round for Level ${currentLevel} is gone.`,
        });
      }
      candidateRound = refreshedRound;
    }

    if (!resetRound) {
      return res.status(409).json({
        success: false,
        code: 'RESET_CONFLICT',
        message: 'Someone else changed the round at the same time. Please try again.',
      });
    }

    const updatedTimer = computeTimerFields(resetRound);

    return res.status(200).json({
      success: true,
      message: `Timer reset to the full Level ${currentLevel} time.`,
      extensionSeconds: durationSeconds,
      student: formatStudentVolunteerResponse(student, resetRound),
      round: {
        ...formatRoundVolunteerResponse(resetRound, updatedTimer),
        startedBy: resetRound.startedBy ? resetRound.startedBy.toString() : null,
        timerExtensions: Array.isArray(resetRound.timerExtensions)
          ? resetRound.timerExtensions.map((ext) => ({
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
    console.error('Error resetting student round timer:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not reset the timer.',
    });
  }
};

/**
 * Helper to format consistent round-pause conflict responses for non-inProgress statuses.
 */
const buildPauseIneligibleResponse = (status, currentLevel) => {
  if (status === 'timeExpired') {
    return {
      status: 409,
      code: 'ROUND_TIMER_EXPIRED',
      message: `Cannot pause Level ${currentLevel}: time is already up.`,
    };
  }
  return {
    status: 409,
    code: 'INVALID_ROUND_STATUS',
    message: `Cannot pause a round that is '${status}'. Only rounds in progress can be paused.`,
  };
};

/**
 * Pause a running student round's timer, freezing the time left
 * Endpoint: POST /api/volunteer/students/:usn/round/pause
 * Access: Protected (Volunteer only)
 *
 * The deadline is left untouched and the frozen time is stored on the round,
 * so the round cannot expire while it sits paused — not even when the old
 * deadline passes. Resume restarts the countdown from the frozen time.
 */
const pauseStudentRoundByUsn = async (req, res) => {
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

    const initialRound = await Round.findOne({
      studentId: student._id,
      levelNumber: currentLevel,
    });

    if (!initialRound) {
      return res.status(404).json({
        success: false,
        code: 'ROUND_NOT_ALLOCATED',
        message: `Student ${normalizedUsn} has no round for Level ${currentLevel} yet.`,
      });
    }

    // 4. Optimistic Concurrency Control (CAS) loop on stored deadline to prevent lost updates
    const MAX_CAS_ATTEMPTS = 5;
    let candidateRound = initialRound;
    let pausedRound = null;
    let frozenRemainingSeconds = null;

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      if (candidateRound.status !== 'inProgress') {
        const conflict = buildPauseIneligibleResponse(candidateRound.status, currentLevel);
        return res.status(conflict.status).json({
          success: false,
          code: conflict.code,
          message: conflict.message,
        });
      }

      if (candidateRound.pausedAt) {
        return res.status(409).json({
          success: false,
          code: 'ROUND_ALREADY_PAUSED',
          message: `The timer for Level ${currentLevel} is already paused.`,
        });
      }

      // Sync timer state so an un-synced expired round cannot be paused
      const timerSync = await syncRoundDeadlineState(candidateRound);
      if (timerSync.error) {
        return res.status(timerSync.error.status).json({
          success: false,
          code: timerSync.error.code,
          message: timerSync.error.message,
        });
      }

      if (timerSync.isExpired || timerSync.round.status === 'timeExpired') {
        const conflict = buildPauseIneligibleResponse('timeExpired', currentLevel);
        return res.status(conflict.status).json({
          success: false,
          code: conflict.code,
          message: conflict.message,
        });
      }

      const activeRound = timerSync.round;
      const storedDeadlineDate = new Date(activeRound.deadline);
      const frozenSeconds = timerSync.remainingSeconds;

      if (!Number.isFinite(frozenSeconds) || frozenSeconds < 0) {
        return res.status(500).json({
          success: false,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Could not pause the timer.',
        });
      }

      const pausedAt = new Date();
      const extensionEntry = {
        extendedBy: req.volunteer._id,
        secondsAdded: 0,
        reason: 'Timer paused',
        timestamp: pausedAt,
      };

      const updated = await Round.findOneAndUpdate(
        {
          _id: activeRound._id,
          status: 'inProgress',
          deadline: storedDeadlineDate,
          pausedAt: null,
        },
        {
          $set: {
            pausedAt,
            pausedRemainingSeconds: frozenSeconds,
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
        pausedRound = updated;
        frozenRemainingSeconds = frozenSeconds;
        break;
      }

      // Concurrent write altered deadline, status, or pause state; re-fetch for retry or conflict report
      const refreshedRound = await Round.findById(activeRound._id);
      if (!refreshedRound) {
        return res.status(404).json({
          success: false,
          code: 'ROUND_NOT_ALLOCATED',
          message: `Round for Level ${currentLevel} is gone.`,
        });
      }
      candidateRound = refreshedRound;
    }

    if (!pausedRound) {
      return res.status(409).json({
        success: false,
        code: 'PAUSE_CONFLICT',
        message: 'Someone else changed the round at the same time. Please try again.',
      });
    }

    const updatedTimer = computeTimerFields(pausedRound);

    return res.status(200).json({
      success: true,
      message: 'Timer paused.',
      pausedRemainingSeconds: frozenRemainingSeconds,
      student: formatStudentVolunteerResponse(student, pausedRound),
      round: {
        ...formatRoundVolunteerResponse(pausedRound, updatedTimer),
        startedBy: pausedRound.startedBy ? pausedRound.startedBy.toString() : null,
        timerExtensions: Array.isArray(pausedRound.timerExtensions)
          ? pausedRound.timerExtensions.map((ext) => ({
              extendedBy: ext.extendedBy ? ext.extendedBy.toString() : null,
              secondsAdded: ext.secondsAdded,
              reason: ext.reason || '',
              timestamp: ext.timestamp,
            }))
          : [],
      },
      pausedBy: {
        id: req.volunteer._id.toString(),
        name: req.volunteer.name,
        username: req.volunteer.username,
        assignedLab: req.volunteer.assignedLab || '',
      },
    });
  } catch (error) {
    console.error('Error pausing student round timer:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not pause the timer.',
    });
  }
};

/**
 * Helper to format consistent round-resume conflict responses for non-inProgress statuses.
 */
const buildResumeIneligibleResponse = (status, currentLevel) => {
  if (status === 'timeExpired') {
    return {
      status: 409,
      code: 'ROUND_TIMER_EXPIRED',
      message: `Cannot resume Level ${currentLevel}: time is already up.`,
    };
  }
  return {
    status: 409,
    code: 'INVALID_ROUND_STATUS',
    message: `Cannot resume a round that is '${status}'. Only rounds in progress can be resumed.`,
  };
};

/**
 * Resume a paused student round's timer from the frozen time left
 * Endpoint: POST /api/volunteer/students/:usn/round/resume
 * Access: Protected (Volunteer only)
 *
 * The new deadline is now + the frozen remaining seconds, so resume works
 * even after the old deadline has passed — a paused round never expires.
 */
const resumeStudentRoundByUsn = async (req, res) => {
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

    const initialRound = await Round.findOne({
      studentId: student._id,
      levelNumber: currentLevel,
    });

    if (!initialRound) {
      return res.status(404).json({
        success: false,
        code: 'ROUND_NOT_ALLOCATED',
        message: `Student ${normalizedUsn} has no round for Level ${currentLevel} yet.`,
      });
    }

    // 4. Optimistic Concurrency Control (CAS) loop on pause state to prevent lost updates
    const MAX_CAS_ATTEMPTS = 5;
    let candidateRound = initialRound;
    let resumedRound = null;

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      if (candidateRound.status !== 'inProgress') {
        const conflict = buildResumeIneligibleResponse(candidateRound.status, currentLevel);
        return res.status(conflict.status).json({
          success: false,
          code: conflict.code,
          message: conflict.message,
        });
      }

      if (!candidateRound.pausedAt) {
        return res.status(409).json({
          success: false,
          code: 'ROUND_NOT_PAUSED',
          message: `The timer for Level ${currentLevel} is not paused.`,
        });
      }

      // The frozen time is the authority: a paused round never expires, so
      // no deadline sync is needed here — resume restarts from this value.
      const frozenSeconds = candidateRound.pausedRemainingSeconds;

      if (!Number.isFinite(frozenSeconds) || frozenSeconds < 0) {
        return res.status(500).json({
          success: false,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Could not resume the timer.',
        });
      }

      const resumeStart = new Date();
      const newDeadlineMs = resumeStart.getTime() + frozenSeconds * 1000;

      // Guard against JavaScript Date maximum timestamp overflow (8.64e15 ms)
      if (!Number.isFinite(newDeadlineMs) || newDeadlineMs > 8.64e15) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_ROUND_DURATION',
          message: 'That paused time gives a wrong end time.',
        });
      }

      const extensionEntry = {
        extendedBy: req.volunteer._id,
        secondsAdded: 0,
        reason: 'Timer resumed',
        timestamp: resumeStart,
      };

      const updated = await Round.findOneAndUpdate(
        {
          _id: candidateRound._id,
          status: 'inProgress',
          pausedAt: { $ne: null },
        },
        {
          $set: {
            deadline: new Date(newDeadlineMs),
            pausedAt: null,
            pausedRemainingSeconds: null,
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
        resumedRound = updated;
        break;
      }

      // Concurrent write changed pause state or status; re-fetch for retry or conflict report
      const refreshedRound = await Round.findById(candidateRound._id);
      if (!refreshedRound) {
        return res.status(404).json({
          success: false,
          code: 'ROUND_NOT_ALLOCATED',
          message: `Round for Level ${currentLevel} is gone.`,
        });
      }
      candidateRound = refreshedRound;
    }

    if (!resumedRound) {
      return res.status(409).json({
        success: false,
        code: 'RESUME_CONFLICT',
        message: 'Someone else changed the round at the same time. Please try again.',
      });
    }

    const updatedTimer = computeTimerFields(resumedRound);

    return res.status(200).json({
      success: true,
      message: 'Timer resumed.',
      student: formatStudentVolunteerResponse(student, resumedRound),
      round: {
        ...formatRoundVolunteerResponse(resumedRound, updatedTimer),
        startedBy: resumedRound.startedBy ? resumedRound.startedBy.toString() : null,
        timerExtensions: Array.isArray(resumedRound.timerExtensions)
          ? resumedRound.timerExtensions.map((ext) => ({
              extendedBy: ext.extendedBy ? ext.extendedBy.toString() : null,
              secondsAdded: ext.secondsAdded,
              reason: ext.reason || '',
              timestamp: ext.timestamp,
            }))
          : [],
      },
      resumedBy: {
        id: req.volunteer._id.toString(),
        name: req.volunteer.name,
        username: req.volunteer.username,
        assignedLab: req.volunteer.assignedLab || '',
      },
    });
  } catch (error) {
    console.error('Error resuming student round timer:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not resume the timer.',
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
        message: `This request has fields we do not use: ${extraFields.join(', ')}.`,
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
        message: 'Note must be text.',
      },
    };
  }

  const normalizedRemarks = typeof remarks === 'string' ? remarks.trim() : '';
  if (normalizedRemarks.length > 1000) {
    return {
      error: {
        status: 400,
        code: 'INVALID_REMARKS',
        message: 'Note must be 1000 letters or less.',
      },
    };
  }

  if (programmingLanguage !== undefined && programmingLanguage !== null && typeof programmingLanguage !== 'string') {
    return {
      error: {
        status: 400,
        code: 'INVALID_PROGRAMMING_LANGUAGE',
        message: 'Programming language must be text.',
      },
    };
  }

  const normalizedLanguage = typeof programmingLanguage === 'string' ? programmingLanguage.trim() : '';
  if (normalizedLanguage.length > 50) {
    return {
      error: {
        status: 400,
        code: 'INVALID_PROGRAMMING_LANGUAGE',
        message: 'Programming language must be 50 letters or less.',
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
        message: `Student ${normalizedUsn} has no round for Level ${currentLevel} yet.`,
      });
    }

    if (existingRound.status === 'evaluated') {
      return res.status(409).json({
        success: false,
        code: 'ROUND_ALREADY_EVALUATED',
        message: `Round for Level ${currentLevel} already has a result.`,
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
            ? `Round for Level ${currentLevel} already has a result.`
            : `Cannot evaluate round with status '${targetRound.status}'. Only 'inProgress' or 'timeExpired' rounds may be evaluated.`,
      });
    }

    const existingEvaluation = await Evaluation.findOne({ roundId: targetRound._id });
    if (existingEvaluation) {
      return res.status(409).json({
        success: false,
        code: 'ROUND_ALREADY_EVALUATED',
        message: `Round for Level ${currentLevel} already has a result.`,
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
            ? `Round for Level ${currentLevel} already has a result.`
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
          message: `Round for Level ${currentLevel} already has a result.`,
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
      message: `Round marked ${normalizedResult === 'PASS' ? 'correct' : 'not correct'}.`,
      evaluation: formatEvaluationResponse(savedEvaluation),
      student: formatStudentVolunteerResponse(student, evaluatedRound),
      round: {
        ...formatRoundVolunteerResponse(evaluatedRound),
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
      message: 'Could not give a result for the round.',
    });
  }
};

module.exports = {
  formatEvaluationResponse,
  startStudentRoundByUsn,
  extendStudentRoundByUsn,
  resetStudentRoundByUsn,
  pauseStudentRoundByUsn,
  resumeStudentRoundByUsn,
  evaluateStudentRoundByUsn,
};
