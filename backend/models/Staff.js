const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const staffSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Staff name is required'],
      trim: true,
    },
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
      minlength: [3, 'Username must be at least 3 characters long'],
      match: [/^[a-z0-9_.-]+$/i, 'Username can only contain alphanumeric characters, underscores, dots, and hyphens'],
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
    },
    role: {
      type: String,
      enum: {
        values: ['ADMIN', 'VOLUNTEER'],
        message: '{VALUE} is not a valid role',
      },
      set: (val) => (typeof val === 'string' ? val.toUpperCase() : val),
      required: [true, 'Role is required'],
      default: 'VOLUNTEER',
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    assignedLab: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
    discriminatorKey: 'role',
  }
);

// Prevent password hash from being leaked in JSON and object transforms
staffSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.passwordHash;
    return ret;
  },
});

staffSchema.set('toObject', {
  transform: (doc, ret) => {
    delete ret.passwordHash;
    return ret;
  },
});

/**
 * Compare plain candidate password against the stored value.
 *
 * Dual-mode on purpose: organizer (VOLUNTEER-role) passwords are stored as
 * plain text by the event team's decision, while the admin account stays
 * bcrypt-hashed. bcrypt is tried first so pre-existing hashed rows keep
 * working with no migration; a non-hash stored value makes bcrypt throw,
 * and the plain-text comparison below then decides.
 */
staffSchema.methods.comparePassword = async function (candidatePassword) {
  if (!candidatePassword || !this.passwordHash) return false;
  try {
    if (await bcrypt.compare(candidatePassword, this.passwordHash)) return true;
  } catch (_) {
    // Stored value is not a bcrypt hash; fall through to plain comparison.
  }
  return candidatePassword === this.passwordHash;
};

/**
 * Static helper to hash a plain password using bcrypt (10 rounds)
 */
staffSchema.statics.hashPassword = async function (plainPassword) {
  const saltRounds = 10;
  return bcrypt.hash(plainPassword, saltRounds);
};

const Staff = mongoose.models.Staff || mongoose.model('Staff', staffSchema);

module.exports = Staff;