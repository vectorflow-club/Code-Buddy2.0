const { Question, Round } = require('../models');
const { TOTAL_LEVELS } = require('../constants');
const { isValidObjectId } = require('../utils');

/**
 * Helper to validate level number strictly between 1 and 6
 */
const isValidLevelNumber = (num) => {
  return Number.isInteger(num) && num >= 1 && num <= TOTAL_LEVELS;
};

/**
 * Helper to validate difficulty strictly EASY or HARD
 */
const isValidDifficulty = (diff) => {
  return typeof diff === 'string' && ['EASY', 'HARD'].includes(diff.trim().toUpperCase());
};

/**
 * Helper to validate a bank number: a string of at most 20 characters.
 * Empty is valid and means the question has no number.
 */
const isValidBankNumber = (value) => {
  return typeof value === 'string' && value.trim().length <= 20;
};

// Round statuses that still reference their question: a round in one of
// these states is live (waiting to start, running, or awaiting evaluation).
// 'evaluated' and 'abandoned' rounds are finished and keep their frozen
// question snapshot, so their questions may be deleted.
const ACTIVE_ROUND_STATUSES = ['ready', 'inProgress', 'timeExpired', 'submitted'];

/**
 * Find another question in the same level already using this bank number.
 * Empty numbers are never duplicates. Pass the question's own id when
 * updating so a question never clashes with itself.
 */
const findBankNumberClash = async (levelNumber, bankNumber, excludeId = null) => {
  if (!bankNumber) return null;
  const filter = { levelNumber, bankNumber };
  if (excludeId) filter._id = { $ne: excludeId };
  return Question.findOne(filter);
};

/**
 * Helper to format question response for admin inspection
 */
const formatQuestionAdminResponse = (q) => ({
  id: q._id.toString(),
  title: q.title,
  statement: q.statement,
  constraints: q.constraints || [],
  examples: q.examples || [],
  difficulty: q.difficulty,
  levelNumber: q.levelNumber,
  hiddenTestCases: q.hiddenTestCases || [],
  bankNumber: q.bankNumber || '',
  showBankNumber: q.showBankNumber !== false,
  isActive: q.isActive,
  createdBy: q.createdBy ? q.createdBy.toString() : null,
  createdAt: q.createdAt,
  updatedAt: q.updatedAt,
});

/**
 * Create Question
 * Endpoint: POST /api/admin/questions
 * Access: Protected (Admin only)
 */
const createQuestion = async (req, res) => {
  try {
    const {
      title,
      statement,
      constraints = [],
      examples = [],
      difficulty,
      levelNumber,
      hiddenTestCases = [],
      bankNumber = '',
      showBankNumber = true,
    } = req.body || {};

    if (!title || typeof title !== 'string' || title.trim().length < 3) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_TITLE',
        message: 'Question title is required and must be at least 3 characters long.',
      });
    }

    if (!statement || typeof statement !== 'string' || statement.trim().length < 10) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_STATEMENT',
        message: 'Problem statement is required and must be at least 10 characters long.',
      });
    }

    const parsedLevel = Number(levelNumber);
    if (!isValidLevelNumber(parsedLevel)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_LEVEL_NUMBER',
        message: 'Level number must be an integer between 1 and 6.',
      });
    }

    if (!isValidDifficulty(difficulty)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_DIFFICULTY',
        message: "Difficulty must be either 'EASY' or 'HARD'.",
      });
    }

    if (!Array.isArray(constraints) || constraints.some((c) => typeof c !== 'string')) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_CONSTRAINTS',
        message: 'Constraints must be an array of strings.',
      });
    }

    if (!Array.isArray(examples)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_EXAMPLES',
        message: 'Examples must be an array of sample test cases.',
      });
    }
    for (let i = 0; i < examples.length; i++) {
      const ex = examples[i];
      if (!ex || typeof ex.input !== 'string' || typeof ex.output !== 'string') {
        return res.status(400).json({
          success: false,
          code: 'INVALID_EXAMPLE_FORMAT',
          message: `Example at index ${i} must contain string 'input' and 'output'.`,
        });
      }
    }

    if (!Array.isArray(hiddenTestCases)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_HIDDEN_TEST_CASES',
        message: 'Hidden test cases must be an array of test cases.',
      });
    }
    for (let i = 0; i < hiddenTestCases.length; i++) {
      const tc = hiddenTestCases[i];
      if (!tc || typeof tc.input !== 'string' || typeof tc.expectedOutput !== 'string') {
        return res.status(400).json({
          success: false,
          code: 'INVALID_TEST_CASE_FORMAT',
          message: `Hidden test case at index ${i} must contain string 'input' and 'expectedOutput'.`,
        });
      }
    }

    if (!isValidBankNumber(bankNumber)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_BANK_NUMBER',
        message: 'Question number must be a string of at most 20 characters.',
      });
    }

    if (typeof showBankNumber !== 'boolean') {
      return res.status(400).json({
        success: false,
        code: 'INVALID_SHOW_BANK_NUMBER',
        message: 'showBankNumber must be a boolean.',
      });
    }

    const trimmedBankNumber = bankNumber.trim();
    const clash = await findBankNumberClash(parsedLevel, trimmedBankNumber);
    if (clash) {
      return res.status(400).json({
        success: false,
        code: 'DUPLICATE_BANK_NUMBER',
        message: `Another question in Level ${parsedLevel} already uses the number "${trimmedBankNumber}".`,
      });
    }

    const question = new Question({
      title: title.trim(),
      statement: statement.trim(),
      constraints: constraints.map((c) => c.trim()),
      examples: examples.map((ex) => ({
        id: ex.id ? String(ex.id).trim() : '',
        title: ex.title ? String(ex.title).trim() : '',
        input: ex.input,
        output: ex.output,
        explanation: ex.explanation ? String(ex.explanation).trim() : '',
      })),
      difficulty: difficulty.trim().toUpperCase(),
      levelNumber: parsedLevel,
      hiddenTestCases: hiddenTestCases.map((tc) => ({
        input: tc.input,
        expectedOutput: tc.expectedOutput,
      })),
      bankNumber: trimmedBankNumber,
      showBankNumber,
      isActive: true,
      createdBy: req.user?.id || null,
    });

    await question.save();

    return res.status(201).json({
      success: true,
      message: 'Question created successfully.',
      question: formatQuestionAdminResponse(question),
    });
  } catch (error) {
    console.error('createQuestion error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to create question.',
    });
  }
};

/**
 * List Questions
 * Endpoint: GET /api/admin/questions
 * Access: Protected (Admin only)
 */
const listQuestions = async (req, res) => {
  try {
    const filter = {};

    if (req.query.levelNumber !== undefined) {
      const level = Number(req.query.levelNumber);
      if (!isValidLevelNumber(level)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_FILTER_LEVEL',
          message: 'levelNumber query filter must be an integer between 1 and 6.',
        });
      }
      filter.levelNumber = level;
    }

    if (req.query.difficulty !== undefined) {
      if (!isValidDifficulty(req.query.difficulty)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_FILTER_DIFFICULTY',
          message: "difficulty query filter must be either 'EASY' or 'HARD'.",
        });
      }
      filter.difficulty = req.query.difficulty.trim().toUpperCase();
    }

    if (req.query.isActive !== undefined) {
      const activeStr = String(req.query.isActive).trim().toLowerCase();
      if (activeStr !== 'true' && activeStr !== 'false') {
        return res.status(400).json({
          success: false,
          code: 'INVALID_ACTIVE_FILTER',
          message: "isActive query filter must be either 'true' or 'false'.",
        });
      }
      filter.isActive = activeStr === 'true';
    }

    const questions = await Question.find(filter).sort({
      levelNumber: 1,
      difficulty: 1,
      createdAt: -1,
    });

    return res.status(200).json({
      success: true,
      count: questions.length,
      questions: questions.map(formatQuestionAdminResponse),
    });
  } catch (error) {
    console.error('listQuestions error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to retrieve questions list.',
    });
  }
};

/**
 * Get Question Details by ID
 * Endpoint: GET /api/admin/questions/:id
 * Access: Protected (Admin only)
 */
const getQuestionById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'Invalid question ID format.',
      });
    }

    const question = await Question.findById(id);
    if (!question) {
      return res.status(404).json({
        success: false,
        code: 'QUESTION_NOT_FOUND',
        message: 'Question not found.',
      });
    }

    const isAssigned = await Round.exists({ questionId: id });

    return res.status(200).json({
      success: true,
      question: formatQuestionAdminResponse(question),
      isAssigned: Boolean(isAssigned),
    });
  } catch (error) {
    console.error('getQuestionById error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to retrieve question details.',
    });
  }
};

/**
 * Update Question
 * Endpoint: PUT /api/admin/questions/:id
 * Access: Protected (Admin only)
 *
 * Rules:
 * 1. Historical round protection: if the question has already been assigned
 *    in any round, levelNumber and difficulty cannot be changed.
 * 2. Question snapshots in existing rounds remain immutable.
 */
const updateQuestion = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'Invalid question ID format.',
      });
    }

    const question = await Question.findById(id);
    if (!question) {
      return res.status(404).json({
        success: false,
        code: 'QUESTION_NOT_FOUND',
        message: 'Question not found.',
      });
    }

    const body = req.body || {};

    const isAssigned = await Round.exists({ questionId: id });

    if (body.levelNumber !== undefined) {
      const newLevel = Number(body.levelNumber);
      if (!isValidLevelNumber(newLevel)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_LEVEL_NUMBER',
          message: 'Level number must be an integer between 1 and 6.',
        });
      }
      if (isAssigned && newLevel !== question.levelNumber) {
        return res.status(400).json({
          success: false,
          code: 'QUESTION_ALREADY_ASSIGNED',
          message: 'Cannot modify levelNumber because this question is already assigned in competition rounds.',
        });
      }
      question.levelNumber = newLevel;
    }

    if (body.difficulty !== undefined) {
      if (!isValidDifficulty(body.difficulty)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_DIFFICULTY',
          message: "Difficulty must be either 'EASY' or 'HARD'.",
        });
      }
      const newDiff = body.difficulty.trim().toUpperCase();
      if (isAssigned && newDiff !== question.difficulty) {
        return res.status(400).json({
          success: false,
          code: 'QUESTION_ALREADY_ASSIGNED',
          message: 'Cannot modify difficulty because this question is already assigned in competition rounds.',
        });
      }
      question.difficulty = newDiff;
    }

    if (body.bankNumber !== undefined) {
      if (!isValidBankNumber(body.bankNumber)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_BANK_NUMBER',
          message: 'Question number must be a string of at most 20 characters.',
        });
      }
      const newBankNumber = body.bankNumber.trim();
      // Runs after the levelNumber block above, so the check uses the
      // (possibly new) level this question will belong to.
      const clash = await findBankNumberClash(question.levelNumber, newBankNumber, question._id);
      if (clash) {
        return res.status(400).json({
          success: false,
          code: 'DUPLICATE_BANK_NUMBER',
          message: `Another question in Level ${question.levelNumber} already uses the number "${newBankNumber}".`,
        });
      }
      question.bankNumber = newBankNumber;
    }

    if (body.showBankNumber !== undefined) {
      if (typeof body.showBankNumber !== 'boolean') {
        return res.status(400).json({
          success: false,
          code: 'INVALID_SHOW_BANK_NUMBER',
          message: 'showBankNumber must be a boolean.',
        });
      }
      question.showBankNumber = body.showBankNumber;
    }

    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || body.title.trim().length < 3) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_TITLE',
          message: 'Question title must be at least 3 characters long.',
        });
      }
      question.title = body.title.trim();
    }

    if (body.statement !== undefined) {
      if (typeof body.statement !== 'string' || body.statement.trim().length < 10) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_STATEMENT',
          message: 'Problem statement must be at least 10 characters long.',
        });
      }
      question.statement = body.statement.trim();
    }

    if (body.constraints !== undefined) {
      if (!Array.isArray(body.constraints) || body.constraints.some((c) => typeof c !== 'string')) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_CONSTRAINTS',
          message: 'Constraints must be an array of strings.',
        });
      }
      question.constraints = body.constraints.map((c) => c.trim());
    }

    if (body.examples !== undefined) {
      if (!Array.isArray(body.examples)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_EXAMPLES',
          message: 'Examples must be an array of sample test cases.',
        });
      }
      for (let i = 0; i < body.examples.length; i++) {
        const ex = body.examples[i];
        if (!ex || typeof ex.input !== 'string' || typeof ex.output !== 'string') {
          return res.status(400).json({
            success: false,
            code: 'INVALID_EXAMPLE_FORMAT',
            message: `Example at index ${i} must contain string 'input' and 'output'.`,
          });
        }
      }
      question.examples = body.examples.map((ex) => ({
        id: ex.id ? String(ex.id).trim() : '',
        title: ex.title ? String(ex.title).trim() : '',
        input: ex.input,
        output: ex.output,
        explanation: ex.explanation ? String(ex.explanation).trim() : '',
      }));
    }

    if (body.hiddenTestCases !== undefined) {
      if (!Array.isArray(body.hiddenTestCases)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_HIDDEN_TEST_CASES',
          message: 'Hidden test cases must be an array.',
        });
      }
      for (let i = 0; i < body.hiddenTestCases.length; i++) {
        const tc = body.hiddenTestCases[i];
        if (!tc || typeof tc.input !== 'string' || typeof tc.expectedOutput !== 'string') {
          return res.status(400).json({
            success: false,
            code: 'INVALID_TEST_CASE_FORMAT',
            message: `Hidden test case at index ${i} must contain string 'input' and 'expectedOutput'.`,
          });
        }
      }
      question.hiddenTestCases = body.hiddenTestCases.map((tc) => ({
        input: tc.input,
        expectedOutput: tc.expectedOutput,
      }));
    }

    if (body.isActive !== undefined && typeof body.isActive === 'boolean') {
      question.isActive = body.isActive;
    }

    await question.save();

    return res.status(200).json({
      success: true,
      message: 'Question updated successfully.',
      question: formatQuestionAdminResponse(question),
      isAssigned: Boolean(isAssigned),
    });
  } catch (error) {
    console.error('updateQuestion error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to update question.',
    });
  }
};

/**
 * Deactivate Question
 * Endpoint: PATCH /api/admin/questions/:id/deactivate
 * Access: Protected (Admin only)
 */
const deactivateQuestion = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'Invalid question ID format.',
      });
    }

    const question = await Question.findById(id);
    if (!question) {
      return res.status(404).json({
        success: false,
        code: 'QUESTION_NOT_FOUND',
        message: 'Question not found.',
      });
    }

    question.isActive = false;
    await question.save();

    return res.status(200).json({
      success: true,
      message: 'Question deactivated successfully.',
      question: formatQuestionAdminResponse(question),
    });
  } catch (error) {
    console.error('deactivateQuestion error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to deactivate question.',
    });
  }
};

/**
 * Reactivate Question
 * Endpoint: PATCH /api/admin/questions/:id/reactivate
 * Access: Protected (Admin only)
 */
const reactivateQuestion = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'Invalid question ID format.',
      });
    }

    const question = await Question.findById(id);
    if (!question) {
      return res.status(404).json({
        success: false,
        code: 'QUESTION_NOT_FOUND',
        message: 'Question not found.',
      });
    }

    question.isActive = true;
    await question.save();

    return res.status(200).json({
      success: true,
      message: 'Question reactivated successfully.',
      question: formatQuestionAdminResponse(question),
    });
  } catch (error) {
    console.error('reactivateQuestion error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to reactivate question.',
    });
  }
};

/**
 * Delete Question (permanent)
 * Endpoint: DELETE /api/admin/questions/:id
 * Access: Protected (Admin only)
 *
 * Guard: refused with 409 while the question is referenced by any active
 * (non-terminal) round. Rounds snapshot the question at allocation, so
 * deleting a question referenced only by finished rounds is safe.
 */
const deleteQuestion = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_ID',
        message: 'Invalid question ID format.',
      });
    }

    const question = await Question.findById(id);
    if (!question) {
      return res.status(404).json({
        success: false,
        code: 'QUESTION_NOT_FOUND',
        message: 'Question not found.',
      });
    }

    const activeRoundCount = await Round.countDocuments({
      questionId: id,
      status: { $in: ACTIVE_ROUND_STATUSES },
    });
    if (activeRoundCount > 0) {
      return res.status(409).json({
        success: false,
        code: 'QUESTION_HAS_ACTIVE_ROUNDS',
        message: `Cannot delete this question because it is assigned to ${activeRoundCount} active round${activeRoundCount === 1 ? '' : 's'}.`,
      });
    }

    await Question.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: 'Question deleted permanently.',
    });
  } catch (error) {
    console.error('deleteQuestion error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to delete question.',
    });
  }
};

module.exports = {
  createQuestion,
  listQuestions,
  getQuestionById,
  updateQuestion,
  deleteQuestion,
  deactivateQuestion,
  reactivateQuestion,
  formatQuestionAdminResponse,
};
