const express = require('express');
const router = express.Router();

const {
  getStudentTransactions,
  getStudentRoundHistory,
  stopCompetition,
} = require('../controllers/studentController');
const { protectStudent } = require('../middleware/authMiddleware');

/**
 * @route   GET /api/student/transactions
 * @desc    Retrieve paginated read-only wallet transactions for the authenticated student
 * @access  Protected (Student only)
 */
router.get('/transactions', protectStudent, getStudentTransactions);

/**
 * @route   GET /api/student/rounds/history
 * @desc    Retrieve paginated chronological round and evaluation history for the authenticated student
 * @access  Protected (Student only)
 */
router.get('/rounds/history', protectStudent, getStudentRoundHistory);

/**
 * @route   POST /api/student/stop
 * @desc    Voluntary cash-out: stop between levels and keep the wallet balance
 * @access  Protected (Student only)
 */
router.post('/stop', protectStudent, stopCompetition);

module.exports = router;

