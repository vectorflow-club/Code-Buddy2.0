const mongoose = require('mongoose');
const { TOTAL_LEVELS } = require('../constants');

const levelSchema = new mongoose.Schema(
  {
    number: {
      type: Number,
      required: [true, 'Level number is required'],
      unique: true,
      min: [1, 'Level number cannot be less than 1'],
      max: [TOTAL_LEVELS, `Level number cannot exceed ${TOTAL_LEVELS}`],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Level name is required'],
      trim: true,
    },
    entryRiskAmount: {
      type: Number,
      min: [0, 'Entry risk amount cannot be negative'],
      default: null,
    },
    winningPayout: {
      type: Number,
      required: [true, 'Winning payout is required'],
      min: [0, 'Winning payout cannot be negative'],
    },
    losingPayout: {
      type: Number,
      min: [0, 'Losing payout cannot be negative'],
      default: 0,
    },
    safeZoneAmount: {
      type: Number,
      min: [0, 'Safe-zone amount cannot be negative'],
      default: 0,
    },
    isSafeZone: {
      type: Boolean,
      default: false,
      index: true,
    },
    isFinal: {
      type: Boolean,
      default: false,
    },
    durationSeconds: {
      type: Number,
      default: 180,
      min: [10, 'Timer duration must be at least 10 seconds'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const Level = mongoose.model('Level', levelSchema);

module.exports = Level;

