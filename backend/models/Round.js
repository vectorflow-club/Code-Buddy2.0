const mongoose = require('mongoose');
const { TOTAL_LEVELS } = require('../constants');

const timerExtensionSchema = new mongoose.Schema(
  {
    extendedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: [true, 'Staff reference is required for timer extension'],
    },
    secondsAdded: {
      type: Number,
      required: [true, 'Seconds added is required'],
      // 0 means no time was added: a pause/resume marker entry.
      min: [0, 'Seconds added cannot be less than 0'],
    },
    reason: {
      type: String,
      trim: true,
      default: '',
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const questionSnapshotSchema = new mongoose.Schema(
  {
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question',
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    statement: {
      type: String,
      required: true,
    },
    constraints: {
      type: [String],
      default: [],
    },
    examples: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    difficulty: {
      type: String,
      enum: ['EASY', 'HARD'],
      required: true,
    },
    levelNumber: {
      type: Number,
      required: true,
    },
    // Frozen at allocation: the question's bank number and its visibility
    // flag at the moment the round was created. The student response shows
    // the number only when showBankNumber is true; volunteers always see it.
    bankNumber: {
      type: String,
      default: '',
    },
    showBankNumber: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const roundSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: [true, 'Student ID is required'],
      index: true,
    },
    levelNumber: {
      type: Number,
      required: [true, 'Level number is required'],
      min: [1, 'Level number cannot be less than 1'],
      max: [TOTAL_LEVELS, `Level number cannot exceed ${TOTAL_LEVELS}`],
      index: true,
    },
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question',
      required: [true, 'Assigned question ID is required'],
    },
    questionSnapshot: {
      type: questionSnapshotSchema,
      required: [true, 'Question snapshot is required'],
    },
    status: {
      type: String,
      enum: {
        values: ['ready', 'inProgress', 'timeExpired', 'submitted', 'evaluated', 'abandoned'],
        message: '{VALUE} is not a valid round state',
      },
      default: 'ready',
      index: true,
    },
    durationSeconds: {
      type: Number,
      default: 180,
      min: [10, 'Duration must be at least 10 seconds'],
    },
    startedAt: {
      type: Date,
      default: null,
    },
    // Authoritative backend deadline timestamp (startedAt + duration + extensions)
    deadline: {
      type: Date,
      default: null,
      index: true,
    },
    // Timer pause: set while the organizer has the timer paused. The
    // deadline is left untouched and the frozen time is kept here, so a
    // paused round never expires and resume restarts from this many seconds.
    pausedAt: {
      type: Date,
      default: null,
    },
    pausedRemainingSeconds: {
      type: Number,
      default: null,
      min: [0, 'Paused time left cannot be less than 0'],
    },
    timerExtensions: {
      type: [timerExtensionSchema],
      default: [],
    },
    startedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound unique index: A student can only have ONE round attempt per level
roundSchema.index({ studentId: 1, levelNumber: 1 }, { unique: true });

const Round = mongoose.model('Round', roundSchema);

module.exports = Round;

