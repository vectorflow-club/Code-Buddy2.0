const { Student, Round } = require('../../models');
const { formatRoundStudentResponse } = require('../../utils');
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
        message: 'University Seat Number (USN) is required.',
      },
    };
  }

  const normalizedUsn = rawUsn.trim().toUpperCase();
  if (!USN_REGEX.test(normalizedUsn)) {
    return {
      error: {
        status: 400,
        code: 'INVALID_USN_FORMAT',
        message: 'Invalid USN format. USN must be 8–15 alphanumeric characters.',
      },
    };
  }

  const student = await Student.findOne({ usn: normalizedUsn });
  if (!student) {
    return {
      error: {
        status: 404,
        code: 'STUDENT_NOT_FOUND',
        message: `No registered student found with USN ${normalizedUsn}.`,
      },
    };
  }

  if (!student.registrationComplete) {
    return {
      error: {
        status: 400,
        code: 'REGISTRATION_INCOMPLETE',
        message: `Student with USN ${normalizedUsn} has not completed registration.`,
      },
    };
  }

  const currentLevel = student.currentLevel;
  if (!currentLevel || currentLevel < 1 || currentLevel > TOTAL_LEVELS) {
    return {
      error: {
        status: 400,
        code: 'INVALID_STUDENT_LEVEL',
        message: 'Student current level is invalid.',
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
        message: `Student ${normalizedUsn} does not have an allocated active round for Level ${currentLevel}.`,
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
      message: timerSync.isExpired
        ? 'Round timer has expired.'
        : 'Round details retrieved successfully.',
      student: formatStudentVolunteerResponse(student, syncedRound),
      round: formatRoundStudentResponse(syncedRound, {
        remainingSeconds: timerSync.remainingSeconds,
        isExpired: timerSync.isExpired,
      }),
    });
  } catch (error) {
    console.error('Error looking up student round by USN:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to retrieve student round details.',
    });
  }
};

module.exports = {
  formatStudentVolunteerResponse,
  resolveRegisteredStudent,
  getStudentActiveRoundByUsn,
};
