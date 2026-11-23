const mongoose = require('mongoose');
const { TOTAL_LEVELS } = require('../constants');

const evaluationSchema = new mongoose.Schema(
  {
    roundId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Round',
      required: [true, 'Round ID is required'],
      unique: true,
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: [true, 'Student ID is required'],
      index: true,
    },
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question',
      required: [true, 'Question ID is required'],
    },
    levelNumber: {
      type: Number,
      required: [true, 'Level number is required'],
      min: [1, 'Level number cannot be less than 1'],
      max: [TOTAL_LEVELS, `Level number cannot exceed ${TOTAL_LEVELS}`],
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: ['PENDING', 'PASS', 'FAIL'],
        message: '{VALUE} is not a valid evaluation status',
      },
      default: 'PENDING',
      index: true,
    },
    evaluatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      default: null,
    },
    evaluatedAt: {
      type: Date,
      default: null,
    },
    programmingLanguage: {
      type: String,
      trim: true,
      default: '',
    },
    volunteerNotes: {
      type: String,
      trim: true,
      default: '',
    },
    isSettled: {
      type: Boolean,
      default: false,
      index: true,
    },
    settledAt: {
      type: Date,
      default: null,
    },
    settledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      default: null,
    },
    settlementTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
    },
    isProgressed: {
      type: Boolean,
      default: false,
    },
    progressedAt: {
      type: Date,
      default: null,
    },
    progressedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const Evaluation = mongoose.model('Evaluation', evaluationSchema);

module.exports = Evaluation;

