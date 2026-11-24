const { Student, Transaction, Round, Evaluation, Level } = require('../models');
const {
  formatLevelResponse,
  formatRoundStudentResponse,
  formatStudentTransactionResponse,
  computeTimerFields,
  parsePaginationQuery,
  buildPaginationMeta,
} = require('../utils');

/**
 * Format an Evaluation summary safely for the owning student.
 * Strictly excludes internal staff IDs (evaluatedBy, settledBy, progressedBy).
 */
const formatStudentEvaluationSummary = (evaluation) => {
  if (!evaluation) {
    return null;
  }

  const isFinalized = ['PASS', 'FAIL'].includes(evaluation.status);
  return {
    status: evaluation.status,
    remarks: isFinalized ? evaluation.volunteerNotes || '' : '',
    programmingLanguage: isFinalized ? evaluation.programmingLanguage || '' : '',
    evaluatedAt: evaluation.evaluatedAt || null,
    isSettled: Boolean(evaluation.isSettled),
    settledAt: evaluation.settledAt || null,
    isProgressed: Boolean(evaluation.isProgressed),
    progressedAt: evaluation.progressedAt || null,
  };
};

/**
 * Controller: getStudentTransactions
 * Endpoint: GET /api/student/transactions
 * Access: Protected (Student only)
 */
const getStudentTransactions = async (req, res) => {
  try {
    const student = req.student;

    if (!student.registrationComplete) {
      return res.status(403).json({
        success: false,
        code: 'REGISTRATION_INCOMPLETE',
        message: 'Finish signing up before seeing your money history.',
      });
    }

    const paginationInput = parsePaginationQuery(req.query);
    if (paginationInput.error) {
      return res.status(paginationInput.error.status).json({
        success: false,
        code: paginationInput.error.code,
        message: paginationInput.error.message,
      });
    }

    const { page, limit, skip } = paginationInput;
    const filter = { studentId: student._id };

    const [transactions, totalItems] = await Promise.all([
      Transaction.find(filter)
        .sort({ timestamp: -1, _id: -1 })
        .skip(skip)
        .limit(limit),
      Transaction.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      message: 'Money history loaded.',
      walletBalance: student.walletBalance ?? 0,
      totalEarned: student.totalEarned ?? 0,
      totalRisked: student.totalRisked ?? 0,
      safeZoneAmount: student.safeZoneAmount ?? 0,
      count: transactions.length,
      pagination: buildPaginationMeta(page, limit, totalItems),
      transactions: transactions.map(formatStudentTransactionResponse),
    });
  } catch (error) {
    console.error('Error retrieving student transactions:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not load your money history.',
    });
  }
};

/**
 * Controller: getStudentRoundHistory
 * Endpoint: GET /api/student/rounds/history
 * Access: Protected (Student only)
 */
const getStudentRoundHistory = async (req, res) => {
  try {
    const student = req.student;

    if (!student.registrationComplete) {
      return res.status(403).json({
        success: false,
        code: 'REGISTRATION_INCOMPLETE',
        message: 'Finish signing up before seeing your past rounds.',
      });
    }

    const paginationInput = parsePaginationQuery(req.query);
    if (paginationInput.error) {
      return res.status(paginationInput.error.status).json({
        success: false,
        code: paginationInput.error.code,
        message: paginationInput.error.message,
      });
    }

    const { page, limit, skip } = paginationInput;
    const filter = {
      studentId: student._id,
      status: { $ne: 'abandoned' },
    };

    const [rounds, totalItems] = await Promise.all([
      Round.find(filter)
        .sort({ levelNumber: 1, createdAt: 1, _id: 1 })
        .skip(skip)
        .limit(limit),
      Round.countDocuments(filter),
    ]);

    let evalByRoundId = new Map();
    if (rounds.length > 0) {
      const roundIds = rounds.map((r) => r._id);
      const evaluations = await Evaluation.find({
        roundId: { $in: roundIds },
        studentId: student._id,
      });
      evalByRoundId = new Map(evaluations.map((ev) => [ev.roundId.toString(), ev]));
    }

    const formattedRounds = rounds.map((round) => {
      const publicRound = formatRoundStudentResponse(round, computeTimerFields(round));
      const evaluation = evalByRoundId.get(round._id.toString()) || null;
      return {
        ...publicRound,
        updatedAt: round.updatedAt || null,
        evaluation: formatStudentEvaluationSummary(evaluation),
      };
    });

    return res.status(200).json({
      success: true,
      message: 'Past rounds loaded.',
      currentLevel: student.currentLevel,
      competitionStatus: student.competitionStatus,
      count: formattedRounds.length,
      pagination: buildPaginationMeta(page, limit, totalItems),
      rounds: formattedRounds,
    });
  } catch (error) {
    console.error('Error retrieving student round history:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not load your past rounds.',
    });
  }
};

/**
 * Controller: getCompetitionConfig
 * Endpoint: GET /api/competition/config
 * Access: Protected (Student only)
 *
 * Returns authoritative six-level configuration without inventing undefined constants.
 */
const getCompetitionConfig = async (req, res) => {
  try {
    const levels = await Level.find({ isActive: true }).sort({ number: 1 });

    if (!levels || levels.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'LEVEL_CONFIGURATION_NOT_FOUND',
        message: 'Level settings were not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Competition settings loaded.',
      totalLevels: levels.length,
      levels: levels.map(formatLevelResponse),
    });
  } catch (error) {
    console.error('Error retrieving competition configuration:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not load the competition settings.',
    });
  }
};

/**
 * Controller: stopCompetition
 * Endpoint: POST /api/student/stop
 * Access: Protected (Student only)
 *
 * Voluntary cash-out: the student stops between levels and keeps the current
 * wallet balance. Terminal state is competitionStatus 'stopped' - not
 * 'eliminated' (a fail) and not 'completed' (clearing all six levels).
 *
 * Guards:
 * - Only between levels: any open round (ready, inProgress, timeExpired,
 *   submitted) refuses with 409. A running round ends via the organizer's
 *   evaluation, not from here.
 * - Idempotent: stopping twice returns the same 200, no error.
 * - A run already ended by elimination or completion refuses with 409.
 * The wallet is untouched: the balance kept is whatever settle left behind.
 */
const stopCompetition = async (req, res) => {
  try {
    const student = await Student.findById(req.student._id);

    if (!student) {
      return res.status(401).json({
        success: false,
        code: 'USER_NOT_FOUND',
        message: 'That student account is gone.',
      });
    }

    if (!student.registrationComplete) {
      return res.status(403).json({
        success: false,
        code: 'REGISTRATION_INCOMPLETE',
        message: 'Finish signing up before stopping.',
      });
    }

    if (student.competitionStatus === 'stopped') {
      return res.status(200).json({
        success: true,
        message: 'You already stopped.',
        student: {
          id: student._id.toString(),
          competitionStatus: student.competitionStatus,
          roundAvailability: student.roundAvailability,
          walletBalance: student.walletBalance ?? 0,
          currentLevel: student.currentLevel,
          levelsCleared: student.levelsCleared ?? 0,
        },
      });
    }

    if (student.competitionStatus === 'eliminated' || student.competitionStatus === 'completed') {
      return res.status(409).json({
        success: false,
        code: 'RUN_ALREADY_ENDED',
        message: 'Your run has already ended.',
      });
    }

    const openRound = await Round.findOne({
      studentId: student._id,
      status: { $in: ['ready', 'inProgress', 'timeExpired', 'submitted'] },
    });
    if (openRound) {
      return res.status(409).json({
        success: false,
        code: 'OPEN_ROUND_EXISTS',
        message:
          'You have a round waiting or in progress. Stop between levels, after your organizer records the result.',
      });
    }

    student.competitionStatus = 'stopped';
    student.roundAvailability = 'stopped';
    await student.save();

    return res.status(200).json({
      success: true,
      message: 'You stopped and kept your money.',
      student: {
        id: student._id.toString(),
        competitionStatus: student.competitionStatus,
        roundAvailability: student.roundAvailability,
        walletBalance: student.walletBalance ?? 0,
        currentLevel: student.currentLevel,
        levelsCleared: student.levelsCleared ?? 0,
      },
    });
  } catch (error) {
    console.error('Error stopping student competition:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not stop. Please try again.',
    });
  }
};

module.exports = {
  getStudentTransactions,
  getStudentRoundHistory,
  getCompetitionConfig,
  stopCompetition,
};

