const { Student, Round, Evaluation } = require('../../models');
const { parsePaginationQuery, buildPaginationMeta } = require('../../utils');
const { deriveStudentRoundAvailability } = require('../roundController');

// Rounds awaiting an organizer verdict. Evaluation documents are created
// only at verdict time (lifecycle.js), so no PENDING Evaluation row ever
// exists to count - pending is derived from open rounds instead. 'ready'
// rounds are excluded: allocated but not started, nothing to judge yet.
const PENDING_ROUND_STATUSES = ['inProgress', 'timeExpired', 'submitted'];

/**
 * Organizer dashboard: spot-scoped stats + participant roster.
 * Endpoint: GET /api/volunteer/dashboard
 * Access: Protected (Volunteer only)
 *
 * Scope is the logged-in organizer's assignedLab: stats count only students
 * who registered at that spot, and the roster lists only those students.
 * Students with no location (registered before locations existed) appear in
 * no organizer's roster; they are still reachable via the open USN lookup.
 */
const getVolunteerDashboard = async (req, res) => {
  try {
    const assignedLab = req.volunteer.assignedLab || '';

    const paginationInput = parsePaginationQuery(req.query);
    if (paginationInput.error) {
      return res.status(paginationInput.error.status).json({
        success: false,
        code: paginationInput.error.code,
        message: paginationInput.error.message,
      });
    }
    const { page, limit, skip } = paginationInput;

    const locationFilter = { location: assignedLab };

    // One id list drives every count, so stats and roster can never disagree
    // about which students belong to this spot.
    const spotStudents = await Student.find(locationFilter, { _id: 1 }).lean();
    const spotStudentIds = spotStudents.map((student) => student._id);
    const totalParticipants = spotStudentIds.length;

    const [pendingEvaluations, completedEvaluations] = await Promise.all([
      Round.countDocuments({
        studentId: { $in: spotStudentIds },
        status: { $in: PENDING_ROUND_STATUSES },
      }),
      Evaluation.countDocuments({
        studentId: { $in: spotStudentIds },
        status: { $in: ['PASS', 'FAIL'] },
      }),
    ]);

    const rosterStudents = await Student.find(locationFilter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // One query for the page's active rounds (the round at each student's
    // current level), instead of one query per roster row.
    const rosterRounds = await Round.find({
      studentId: { $in: rosterStudents.map((student) => student._id) },
    }).lean();
    const roundByStudentLevel = new Map();
    for (const round of rosterRounds) {
      roundByStudentLevel.set(`${round.studentId.toString()}:${round.levelNumber}`, round);
    }

    const participants = rosterStudents.map((student) => {
      const round =
        roundByStudentLevel.get(`${student._id.toString()}:${student.currentLevel}`) || null;
      return {
        id: student._id.toString(),
        name: student.name,
        usn: student.usn || null,
        year: student.year || null,
        location: student.location || null,
        currentLevel: student.currentLevel,
        levelsCleared: student.levelsCleared ?? 0,
        competitionStatus: student.competitionStatus,
        roundAvailability: deriveStudentRoundAvailability(student, round),
        roundStatus: round ? round.status : 'none',
        walletBalance: student.walletBalance ?? 0,
        createdAt: student.createdAt,
      };
    });

    const decided = pendingEvaluations + completedEvaluations;
    const evaluationProgress =
      decided === 0 ? 0 : Math.round((completedEvaluations / decided) * 100);

    return res.status(200).json({
      success: true,
      message: 'Organizer dashboard loaded.',
      location: assignedLab,
      stats: {
        assignedParticipants: totalParticipants,
        pendingEvaluations,
        completedEvaluations,
        evaluationProgress,
      },
      participants,
      pagination: buildPaginationMeta(page, limit, totalParticipants),
    });
  } catch (error) {
    console.error('Error retrieving organizer dashboard:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not load the organizer dashboard.',
    });
  }
};

module.exports = {
  getVolunteerDashboard,
};
