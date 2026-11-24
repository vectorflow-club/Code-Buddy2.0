const mongoose = require('mongoose');
const { TOTAL_LEVELS, ACADEMIC_YEARS, USN_REGEX, ORGANIZER_LOCATIONS } = require('../constants');

const studentSchema = new mongoose.Schema(
  {
    googleSubjectId: {
      type: String,
      required: [true, 'Google subject ID is required'],
      unique: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Student name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
      validate: {
        validator: function (value) {
          return /^[^\s@]+@vvce\.ac\.in$/i.test(value);
        },
        message: (props) => `${props.value} is not a valid VVCE college email address (@vvce.ac.in)`,
      },
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    role: {
      type: String,
      enum: {
        values: ['STUDENT'],
        message: '{VALUE} is not a valid student role',
      },
      default: 'STUDENT',
      required: [true, 'Role is required'],
    },
    usn: {
      type: String,
      unique: true,
      sparse: true,
      uppercase: true,
      trim: true,
      index: true,
      required: [
        function () {
          return this.registrationComplete === true;
        },
        'USN is required when registration is complete',
      ],
      validate: {
        validator: function (value) {
          if (!value) return true; // Handled by conditional required validator above
          return USN_REGEX.test(value);
        },
        message: (props) => `${props.value} is not a valid USN format (alphanumeric, 8-15 characters)`,
      },
    },
    year: {
      type: String,
      enum: {
        values: ACADEMIC_YEARS,
        message: '{VALUE} is not a valid academic year',
      },
      trim: true,
      default: null,
      required: [
        function () {
          return this.registrationComplete === true;
        },
        'Academic year is required when registration is complete',
      ],
    },
    registrationComplete: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Event spot the student registered at. Organizers only see students
    // whose location matches their own assignedLab. Null for accounts
    // registered before locations existed; the registration endpoint
    // requires it for new registrations, the schema does not.
    location: {
      type: String,
      enum: {
        values: ORGANIZER_LOCATIONS,
        message: '{VALUE} is not a valid event location',
      },
      trim: true,
      default: null,
      index: true,
    },
    currentLevel: {
      type: Number,
      default: 1,
      min: [1, 'Current level cannot be less than 1'],
      max: [TOTAL_LEVELS, `Current level cannot exceed ${TOTAL_LEVELS}`],
    },
    highestLevelReached: {
      type: Number,
      default: 1,
      min: [1, 'Highest level cannot be less than 1'],
      max: [TOTAL_LEVELS, `Highest level cannot exceed ${TOTAL_LEVELS}`],
    },
    levelsCleared: {
      type: Number,
      default: 0,
      min: [0, 'Levels cleared cannot be negative'],
      max: [TOTAL_LEVELS, `Levels cleared cannot exceed ${TOTAL_LEVELS}`],
    },
    competitionStatus: {
      type: String,
      enum: {
        // 'stopped' is the voluntary cash-out: the student chose to stop
        // between levels and keep the balance. It is terminal like
        // 'eliminated'/'completed' but is neither a fail nor a full clear.
        values: ['registered', 'inProgress', 'cleared', 'eliminated', 'completed', 'stopped'],
        message: '{VALUE} is not a valid competition status',
      },
      default: 'registered',
      index: true,
    },
    roundAvailability: {
      type: String,
      enum: {
        values: [
          'unavailable',
          'ready',
          'inProgress',
          'evaluationPending',
          'cleared',
          'eliminated',
          'completed',
          'stopped',
          'insufficientBalance',
        ],
        message: '{VALUE} is not a valid round availability state',
      },
      default: 'ready',
    },
    walletBalance: {
      type: Number,
      default: 0,
      min: [0, 'Wallet balance cannot be negative'],
    },
    totalEarned: {
      type: Number,
      default: 0,
      min: [0, 'Total earned cannot be negative'],
    },
    totalRisked: {
      type: Number,
      default: 0,
      min: [0, 'Total risked cannot be negative'],
    },
    safeZoneAmount: {
      type: Number,
      default: 0,
      min: [0, 'Safe-zone amount cannot be negative'],
    },
  },
  {
    timestamps: true,
  }
);

const Student = mongoose.model('Student', studentSchema);

module.exports = Student;