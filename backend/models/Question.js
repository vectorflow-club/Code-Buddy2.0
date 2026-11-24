const mongoose = require('mongoose');
const { TOTAL_LEVELS } = require('../constants');

const exampleSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      trim: true,
      default: '',
    },
    title: {
      type: String,
      trim: true,
      default: '',
    },
    input: {
      type: String,
      required: [true, 'Sample input is required'],
    },
    output: {
      type: String,
      required: [true, 'Sample output is required'],
    },
    explanation: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const hiddenTestCaseSchema = new mongoose.Schema(
  {
    input: {
      type: String,
      required: [true, 'Test case input is required'],
    },
    expectedOutput: {
      type: String,
      required: [true, 'Expected output is required'],
    },
  },
  { _id: false }
);

const questionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Question title is required'],
      trim: true,
    },
    statement: {
      type: String,
      required: [true, 'Problem statement is required'],
      trim: true,
    },
    constraints: {
      type: [String],
      default: [],
    },
    examples: {
      type: [exampleSchema],
      default: [],
    },
    // Problem difficulty: EASY for 1st years, HARD for 2nd/3rd/4th years
    difficulty: {
      type: String,
      enum: {
        values: ['EASY', 'HARD'],
        message: '{VALUE} is not a valid difficulty',
      },
      required: [true, 'Difficulty is required'],
      index: true,
    },
    levelNumber: {
      type: Number,
      required: [true, 'Level number is required'],
      min: [1, 'Level number cannot be less than 1'],
      max: [TOTAL_LEVELS, `Level number cannot exceed ${TOTAL_LEVELS}`],
      index: true,
    },
    hiddenTestCases: {
      type: [hiddenTestCaseSchema],
      default: [],
    },
    // Bank number (e.g. "E1", "H3"): the human-facing question number from
    // the question bank. Unique within a level (enforced in the controller,
    // not by an index, so blank numbers never collide).
    bankNumber: {
      type: String,
      trim: true,
      default: '',
    },
    // Whether the bank number is shown to the student on the round page.
    // Volunteers and admins always see it.
    showBankNumber: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient random question selection by level and difficulty
questionSchema.index({ levelNumber: 1, difficulty: 1, isActive: 1 });

const Question = mongoose.model('Question', questionSchema);

module.exports = Question;

