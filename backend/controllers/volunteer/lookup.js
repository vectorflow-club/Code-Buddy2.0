const { Student, Round, Evaluation } = require('../../models');
const { formatRoundVolunteerResponse, formatEvaluationResponse } = require('../../utils');
const { syncRoundDeadlineState, deriveStudentRoundAvailability } = require('../roundController');
const { TOTAL_LEVELS, USN_REGEX } = require('../../constants');

/**
 * Format student identity, registration, and competition status for Volunteer inspection.
 * Omits internal authentication details such as googleSubjectId.
 */
const formatStudentVolunteerResponse = (student, round = null) => ({
  id: student._id.toString(),
  name: student.name,
  email: student.email,
  usn: student.usn || null,
  year: student.year || null,
  location: student.location || null,
  registrationComplete: Boolean(student.registrationComplete),
  currentLevel: student.currentLevel,
  highestLevelReached: student.highestLevelReached ?? 1,
  levelsCleared: student.levelsCleared ?? 0,
  competitionStatus: student.competitionStatus,
  roundAvailability: deriveStudentRoundAvailability(student, round),
  walletBalance: student.walletBalance ?? 0,
  totalEarned: student.totalEarned ?? 0,
  totalRisked: student.totalRisked ?? 0,
  safeZoneAmount: student.safeZoneAmount ?? 0,
});

/**
 * Helper to validate/normalize USN and fetch the corresponding registered Student.
 */
const resolveRegisteredStudent = async (rawUsn) => {
  if (!rawUsn || typeof rawUsn !== 'string' || rawUsn.trim() === '') {
    return {
      error: {
        status: 400,
        code: 'MISSING_USN',
        message: 'USN is needed.',
      },
    };
  }

  const normalizedUsn = rawUsn.trim().toUpperCase();
  if (!USN_REGEX.test(normalizedUsn)) {
    return {
      error: {
        status: 400,
        code: 'INVALID_USN_FORMAT',
        message: 'That USN does not look right. Use 8–15 letters or numbers.',
      },
    };
  }

  const student = await Student.findOne({ usn: normalizedUsn });
  if (!student) {
    return {
      error: {
        status: 404,
        code: 'STUDENT_NOT_FOUND',
        message: `No student signed up with USN ${normalizedUsn}.`,
      },
    };
  }

  if (!student.registrationComplete) {
    return {
      error: {
        status: 400,
        code: 'REGISTRATION_INCOMPLETE',
        message: `Student with USN ${normalizedUsn} has not finished signing up.`,
      },
    };
  }

  const currentLevel = student.currentLevel;
  if (!currentLevel || currentLevel < 1 || currentLevel > TOTAL_LEVELS) {
    return {
      error: {
        status: 400,
        code: 'INVALID_STUDENT_LEVEL',
        message: 'The current level for this student is not right.',
      },
    };
  }

  return { student, normalizedUsn };
};

/**
 * Lookup a registered student by USN and retrieve their allocated active round
 * Endpoint: GET /api/volunteer/students/:usn/round
 * Access: Protected (Volunteer only)
 */
const getStudentActiveRoundByUsn = async (req, res) => {
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

    const round = await Round.findOne({
      studentId: student._id,
      levelNumber: currentLevel,
      status: { $ne: 'abandoned' },
    });

    if (!round) {
      return res.status(404).json({
        success: false,
        code: 'ROUND_NOT_ALLOCATED',
        message: `Student ${normalizedUsn} has no round for Level ${currentLevel} yet.`,
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

    // A round that already has a verdict carries its Evaluation, so a freshly
    // opened Evaluation Workspace can offer Settle/Progress instead of
    // showing a dead panel (the workspace gates both on hasEvaluation).
    // Rounds without a verdict keep today's shape: no evaluation key.
    const evaluation = await Evaluation.findOne({ roundId: syncedRound._id }).lean();

    return res.status(200).json({
      success: true,
      message: timerSync.isExpired
        ? 'Time is up for this round.'
        : 'Round details loaded.',
      student: formatStudentVolunteerResponse(student, syncedRound),
      round: formatRoundVolunteerResponse(syncedRound, {
        remainingSeconds: timerSync.remainingSeconds,
        isExpired: timerSync.isExpired,
      }),
      ...(evaluation ? { evaluation: formatEvaluationResponse(evaluation) } : {}),
    });
  } catch (error) {
    console.error('Error looking up student round by USN:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not load the student round details.',
    });
  }
};

module.exports = {
  formatStudentVolunteerResponse,
  resolveRegisteredStudent,
  getStudentActiveRoundByUsn,
};
