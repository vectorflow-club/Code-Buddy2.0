const mongoose = require('mongoose');
const { TOTAL_LEVELS, TRANSACTION_TYPES } = require('../constants');

const transactionSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      required: [true, 'Student ID is required'],
      index: true,
    },
    type: {
      type: String,
      enum: {
        values: Object.values(TRANSACTION_TYPES),
        message: '{VALUE} is not a valid type of money move',
      },
      required: [true, 'Transaction type is required'],
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: ['SUCCESS', 'PENDING', 'FAILED'],
        message: '{VALUE} is not a valid money move state',
      },
      default: 'SUCCESS',
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Transaction amount is required'],
      min: [0, 'Transaction amount cannot be negative'],
    },
    balanceAfter: {
      type: Number,
      required: [true, 'Resulting balance after transaction is required'],
      min: [0, 'Wallet balance after transaction cannot be negative'],
    },
    levelNumber: {
      type: Number,
      min: [1, 'Level number cannot be less than 1'],
      max: [TOTAL_LEVELS, `Level number cannot exceed ${TOTAL_LEVELS}`],
      default: null,
    },
    roundId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Round',
      default: null,
    },
    // Unique settlement identifier enforcing at most one settlement transaction per round
    settlementKey: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      default: undefined,
    },
    description: {
      type: String,
      required: [true, 'Transaction description is required'],
      trim: true,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      default: null,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  }
);

// Append-only constraint: prevent updates or modifications to existing ledger entries
transactionSchema.pre('updateOne', function () {
  throw new Error('Transactions are immutable and cannot be updated');
});
transactionSchema.pre('updateMany', function () {
  throw new Error('Transactions are immutable and cannot be updated');
});
transactionSchema.pre('findOneAndUpdate', function () {
  throw new Error('Transactions are immutable and cannot be updated');
});
transactionSchema.pre('deleteOne', function () {
  throw new Error('Transactions are immutable and cannot be deleted');
});
transactionSchema.pre('deleteMany', function () {
  throw new Error('Transactions are immutable and cannot be deleted');
});
transactionSchema.pre('findOneAndDelete', function () {
  throw new Error('Transactions are immutable and cannot be deleted');
});

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;

