const { volunteerLogin, getVolunteerMe } = require('./auth');
const { getStudentActiveRoundByUsn } = require('./lookup');
const { getVolunteerDashboard } = require('./dashboard');
const {
  startStudentRoundByUsn,
  extendStudentRoundByUsn,
  resetStudentRoundByUsn,
  pauseStudentRoundByUsn,
  resumeStudentRoundByUsn,
  evaluateStudentRoundByUsn,
} = require('./lifecycle');
const { settleStudentRoundByUsn, progressStudentRoundByUsn } = require('./settlement');

module.exports = {
  volunteerLogin,
  getVolunteerMe,
  getStudentActiveRoundByUsn,
  getVolunteerDashboard,
  startStudentRoundByUsn,
  extendStudentRoundByUsn,
  resetStudentRoundByUsn,
  pauseStudentRoundByUsn,
  resumeStudentRoundByUsn,
  evaluateStudentRoundByUsn,
  settleStudentRoundByUsn,
  progressStudentRoundByUsn,
};
