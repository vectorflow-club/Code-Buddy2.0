const { OAuth2Client } = require('google-auth-library');
const { Student } = require('../models');
const { signStudentToken } = require('../middleware/authMiddleware');
const { resolveStudentLiveState } = require('./roundController');
const { USN_REGEX, ACADEMIC_YEARS, ORGANIZER_LOCATIONS } = require('../constants');

// Lazily initialize OAuth2Client to ensure process.env.GOOGLE_CLIENT_ID is read at runtime
let googleClient = null;
const getGoogleClient = () => {
  if (!googleClient) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error('GOOGLE_CLIENT_ID must be configured in environment variables.');
    }
    googleClient = new OAuth2Client(clientId);
  }
  return googleClient;
};

/**
 * Helper to normalize and format student profile data for client responses
 */
const formatStudentResponse = (student, liveState = null) => ({
  id: student._id.toString(),
  name: student.name,
  email: student.email,
  role: student.role,
  registrationComplete: student.registrationComplete,
  usn: student.usn || null,
  year: student.year || null,
  location: student.location || null,
  currentLevel: liveState?.currentLevel ?? student.currentLevel,
  highestLevelReached: liveState?.highestLevelReached ?? (student.highestLevelReached ?? 1),
  levelsCleared: liveState?.levelsCleared ?? (student.levelsCleared ?? 0),
  competitionStatus: liveState?.competitionStatus ?? student.competitionStatus,
  roundAvailability: liveState?.roundAvailability ?? student.roundAvailability,
  walletBalance: student.walletBalance ?? 0,
  totalEarned: student.totalEarned ?? 0,
  totalRisked: student.totalRisked ?? 0,
  safeZoneAmount: student.safeZoneAmount ?? 0,
});

/**
 * Controller: verifyGoogleAuth
 * Endpoint: POST /api/auth/google
 *
 * Responsibilities:
 * 1. Receives and validates the Google ID token.
 * 2. Cryptographically verifies the token with Google using OAuth2Client.
 * 3. Enforces token audience (GOOGLE_CLIENT_ID) and issuer (accounts.google.com).
 * 4. Enforces email_verified === true.
 * 5. Strictly enforces the @vvce.ac.in email domain.
 * 6. Finds an existing student or provisions a new Student document.
 * 7. Generates an HS256 JWT session token with student._id as subject.
 * 8. Returns structured authentication response with registration status.
 */
const verifyGoogleAuth = async (req, res) => {
  try {
    // 1. Extract and validate Google ID token presence (never trust identity in body/query)
    const idToken = req.body?.idToken || req.body?.credential;

    if (!idToken || typeof idToken !== 'string' || idToken.trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_GOOGLE_TOKEN',
        message: 'Google sign-in information is missing. Please try again.',
      });
    }

    let client;
    try {
      client = getGoogleClient();
    } catch (configErr) {
      console.error('Google Auth configuration error:', configErr.message);
      return res.status(500).json({
        success: false,
        code: 'CONFIGURATION_ERROR',
        message: 'Google sign-in is not working right now. Please try again later.',
      });
    }

    let ticket;
    try {
      ticket = await client.verifyIdToken({
        idToken: idToken.trim(),
        audience: process.env.GOOGLE_CLIENT_ID,
      });
    } catch (verifyErr) {
      console.error('Google token verification failed:', verifyErr.message);
      const isExpired = verifyErr.message && verifyErr.message.toLowerCase().includes('expired');
      return res.status(401).json({
        success: false,
        code: isExpired ? 'EXPIRED_GOOGLE_TOKEN' : 'INVALID_GOOGLE_TOKEN',
        message: isExpired
          ? 'Google ID token has expired. Please sign in again.'
          : 'Google ID token is invalid or verification failed.',
      });
    }

    const payload = ticket.getPayload();
    if (!payload) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_GOOGLE_TOKEN',
        message: 'Google sign-in information could not be read. Please try again.',
      });
    }

    const {
      sub: googleSubjectId,
      email,
      email_verified: emailVerified,
      name,
      iss,
    } = payload;

    const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
    if (!iss || !validIssuers.includes(iss)) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_ISSUER',
        message: 'Google sign-in could not be checked. Please try again.',
      });
    }

    if (emailVerified !== true) {
      return res.status(403).json({
        success: false,
        code: 'UNVERIFIED_EMAIL',
        message: 'Your Google email must be checked before you sign in.',
      });
    }

    const vvceDomainRegex = /^[^\s@]+@vvce\.ac\.in$/i;
    if (!email || typeof email !== 'string' || !vvceDomainRegex.test(email)) {
      return res.status(403).json({
        success: false,
        code: 'INVALID_DOMAIN',
        message: 'Only checked Google accounts ending in @vvce.ac.in can sign in.',
      });
    }

    if (!googleSubjectId || !name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'INCOMPLETE_GOOGLE_PROFILE',
        message: 'Your Google profile is missing some details.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    let student;
    try {
      student = await Student.findOne({ googleSubjectId });

      if (student) {
        student.emailVerified = true;
        if (!student.name && name) {
          student.name = name.trim();
        }
        await student.save();
      } else {
        const emailConflict = await Student.findOne({ email: normalizedEmail });
        if (emailConflict) {
          return res.status(409).json({
            success: false,
            code: 'ACCOUNT_CONFLICT',
            message: 'An account with this email already exists.',
          });
        }

        student = new Student({
          googleSubjectId,
          name: name.trim(),
          email: normalizedEmail,
          emailVerified: true,
          role: 'STUDENT',
          registrationComplete: false,
          currentLevel: 1,
          competitionStatus: 'registered',
          roundAvailability: 'ready',
        });
        await student.save();
      }
    } catch (dbErr) {
      console.error('Database error in verifyGoogleAuth:', dbErr.message);
      if (dbErr.code === 11000) {
        return res.status(409).json({
          success: false,
          code: 'ACCOUNT_CONFLICT',
          message: 'An account with this email already exists.',
        });
      }
      return res.status(500).json({
        success: false,
        code: 'DATABASE_ERROR',
        message: 'Something went wrong while signing you in. Please try again.',
      });
    }

    let token;
    try {
      token = signStudentToken(student._id);
    } catch (jwtErr) {
      console.error('JWT generation error:', jwtErr.message);
      return res.status(500).json({
        success: false,
        code: 'TOKEN_GENERATION_FAILED',
        message: 'Something went wrong while signing you in. Please try again.',
      });
    }

    const liveState = await resolveStudentLiveState(student);
    return res.status(200).json({
      success: true,
      token,
      registrationComplete: student.registrationComplete,
      student: formatStudentResponse(student, liveState),
    });
  } catch (error) {
    console.error('Unhandled verifyGoogleAuth error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong on our side. Please try again.',
    });
  }
};

/**
 * Controller: completeRegistration
 * Endpoint: POST /api/auth/register
 * Access: Protected (Student only, via protectStudent)
 *
 * Responsibilities:
 * 1. Uses req.student._id as the sole, authoritative source of student identity.
 * 2. Strict payload validation: Rejects any unsupported fields (e.g., name, role, email, walletBalance).
 * 3. Validates USN format (/^[A-Z0-9]{8,15}$/i) and normalizes via trim() and toUpperCase().
 * 4. Validates Academic Year against schema enum ('1st Year', '2nd Year', '3rd Year', '4th Year').
 * 5. Validates event location against ORGANIZER_LOCATIONS (same three spots as
 *    organizer assignedLab), canonicalizing case after trim.
 * 6. Pre-checks for USN collision across other student accounts.
 * 7. Executes an atomic conditional update:
 *    - Updates only usn, year, location, and registrationComplete.
 *    - Only matches if registrationComplete is false.
 *    - Never resets or modifies competition fields or student name.
 * 8. If conditional update does not match, inspects latest student record:
 *    - If registration is already complete with identical USN, Year, and Location:
 *      returns idempotent 200 OK.
 *    - Otherwise rejects modification attempts with 400 REGISTRATION_ALREADY_COMPLETED.
 * 9. Catches MongoDB E11000 duplicate key errors on the unique USN index.
 */
const completeRegistration = async (req, res) => {
  try {
    const studentId = req.student._id;
    const body = req.body || {};

    const allowedFields = ['usn', 'year', 'location'];
    const extraFields = Object.keys(body).filter((key) => !allowedFields.includes(key));
    if (extraFields.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'UNSUPPORTED_FIELDS',
        message: `Sign-up has fields we do not use: ${extraFields.join(', ')}. Only 'usn', 'year', and 'location' are allowed.`,
      });
    }

    const { usn, year, location } = body;

    if (!usn || typeof usn !== 'string' || usn.trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_USN',
        message: 'USN is needed.',
      });
    }

    if (!year || typeof year !== 'string' || year.trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_YEAR',
        message: 'Year of study is needed.',
      });
    }

    if (!location || typeof location !== 'string' || location.trim() === '') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_LOCATION',
        message: 'Spot is needed.',
      });
    }

    const normalizedUsn = usn.trim().toUpperCase();
    const normalizedYear = year.trim();
    // Canonicalize case after trim, mirroring the organizer assignedLab
    // validation: 'ccd' stores as 'CCD'.
    const normalizedLocation = ORGANIZER_LOCATIONS.find(
      (spot) => spot.toLowerCase() === location.trim().toLowerCase()
    );

    if (!USN_REGEX.test(normalizedUsn)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_USN_FORMAT',
        message: 'Enter a valid USN (8–15 letters or numbers).',
      });
    }

    if (!ACADEMIC_YEARS.includes(normalizedYear)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_YEAR',
        message: 'Choose your year of study (1st Year, 2nd Year, 3rd Year, or 4th Year).',
      });
    }

    if (!normalizedLocation) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_LOCATION',
        message: `Choose your spot (${ORGANIZER_LOCATIONS.join(', ')}).`,
      });
    }

    const existingWithUsn = await Student.findOne({
      usn: normalizedUsn,
      _id: { $ne: studentId },
    });

    if (existingWithUsn) {
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_USN',
        message: 'That USN is already signed up. Check the number or ask the event team.',
      });
    }

    let updatedStudent;
    try {
      updatedStudent = await Student.findOneAndUpdate(
        {
          _id: studentId,
          registrationComplete: false,
        },
        {
          $set: {
            usn: normalizedUsn,
            year: normalizedYear,
            location: normalizedLocation,
            registrationComplete: true,
          },
        },
        {
          new: true,
          runValidators: true,
        }
      );
    } catch (dbErr) {
      console.error('Error during atomic student registration:', dbErr.message);
      if (dbErr.code === 11000) {
        return res.status(409).json({
          success: false,
          code: 'DUPLICATE_USN',
          message: 'That USN is already signed up. Check the number or ask the event team.',
        });
      }
      return res.status(500).json({
        success: false,
        code: 'DATABASE_ERROR',
        message: 'Something went wrong while finishing your sign-up. Please try again.',
      });
    }

    if (!updatedStudent) {
      const latestStudent = await Student.findById(studentId);
      if (!latestStudent) {
        return res.status(401).json({
          success: false,
          code: 'USER_NOT_FOUND',
          message: 'That student account is gone.',
        });
      }

      if (
        latestStudent.registrationComplete &&
        latestStudent.usn === normalizedUsn &&
        latestStudent.year === normalizedYear &&
        latestStudent.location === normalizedLocation
      ) {
        const liveState = await resolveStudentLiveState(latestStudent);
        return res.status(200).json({
          success: true,
          message: 'Sign-up is already done.',
          student: formatStudentResponse(latestStudent, liveState),
        });
      }

      return res.status(400).json({
        success: false,
        code: 'REGISTRATION_ALREADY_COMPLETED',
        message: 'Sign-up is already done. Your USN, year, and spot cannot be changed.',
      });
    }

    const liveState = await resolveStudentLiveState(updatedStudent);
    return res.status(200).json({
      success: true,
      message: 'Sign-up done.',
      student: formatStudentResponse(updatedStudent, liveState),
    });
  } catch (error) {
    console.error('Unhandled completeRegistration error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong on our side. Please try again.',
    });
  }
};

/**
 * Controller: getMe
 * Endpoint: GET /api/auth/me
 *
 * Protected route returning the current authenticated student profile
 * synchronized with live round and evaluation state without mutating DB state.
 */
const getMe = async (req, res) => {
  try {
    const student = req.student;
    const liveState = await resolveStudentLiveState(student);

    return res.status(200).json({
      success: true,
      student: formatStudentResponse(student, liveState),
    });
  } catch (error) {
    console.error('getMe controller error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Could not load your profile.',
    });
  }
};

module.exports = {
  verifyGoogleAuth,
  completeRegistration,
  getMe,
};