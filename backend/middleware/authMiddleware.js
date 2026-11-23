const jwt = require('jsonwebtoken');
const { Student, Admin, Volunteer } = require('../models');
const { isStrictObjectId } = require('../utils');

/**
 * Retrieve the JWT secret key from environment variables.
 * Strictly required across all environments; no fallback secret allowed.
 */
const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || typeof secret !== 'string' || secret.trim() === '') {
    throw new Error('JWT_SECRET must be configured in environment variables.');
  }
  return secret;
};

/**
 * Sign a session JWT for any role using HS256.
 */
const signToken = (subjectId, role, expiresIn = process.env.JWT_EXPIRES_IN || '7d') => {
  return jwt.sign(
    {
      sub: String(subjectId),
      role,
    },
    getJwtSecret(),
    {
      algorithm: 'HS256',
      expiresIn,
    }
  );
};

/**
 * Helper to generate a signed student session JWT using HS256.
 */
const signStudentToken = (studentId, expiresIn) => signToken(studentId, 'STUDENT', expiresIn);

/**
 * Helper to generate a signed admin session JWT using HS256.
 */
const signAdminToken = (adminId, expiresIn) => signToken(adminId, 'ADMIN', expiresIn);

/**
 * Helper to generate a signed volunteer session JWT using HS256.
 */
const signVolunteerToken = (volunteerId, expiresIn) => signToken(volunteerId, 'VOLUNTEER', expiresIn);

/**
 * Internal helper to extract and cryptographically verify Bearer JWT from headers.
 * Throws structured errors for missing, expired, or invalid tokens.
 */
const extractAndVerifyToken = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    const error = new Error('Authentication required. No token provided.');
    error.code = 'NO_TOKEN';
    error.statusCode = 401;
    throw error;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    const error = new Error('Authentication required. No token provided.');
    error.code = 'NO_TOKEN';
    error.statusCode = 401;
    throw error;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
    });

    if (!decoded.sub || typeof decoded.sub !== 'string' || decoded.sub.trim() === '') {
      const error = new Error('Authentication token missing user identifier.');
      error.code = 'MALFORMED_TOKEN_PAYLOAD';
      error.statusCode = 401;
      throw error;
    }

    if (!isStrictObjectId(decoded.sub.trim())) {
      const error = new Error('Authentication token contains an invalid user identifier.');
      error.code = 'INVALID_TOKEN';
      error.statusCode = 401;
      throw error;
    }

    return decoded;
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      const error = new Error('Session has expired. Please sign in again.');
      error.code = 'TOKEN_EXPIRED';
      error.statusCode = 401;
      throw error;
    }
    if (err.name === 'NotBeforeError') {
      const error = new Error('Authentication token is not active yet.');
      error.code = 'INVALID_TOKEN';
      error.statusCode = 401;
      throw error;
    }
    if (err.name === 'JsonWebTokenError') {
      const error = new Error('Invalid authentication token.');
      error.code = 'INVALID_TOKEN';
      error.statusCode = 401;
      throw error;
    }
    throw err;
  }
};

/**
 * Per-role account configuration for the shared auth core. The differences
 * between roles are data, not code: students have no active-status check and
 * their stored role is compared exactly, while staff roles normalize case
 * and must be active.
 */
const ROLE_CONFIG = {
  STUDENT: {
    model: Student,
    reqKey: 'student',
    label: 'Student',
    notFoundMessage: 'Student account belonging to this token no longer exists.',
    roleMismatchMessage: 'Access denied. Account is not a registered student.',
    normalizeRole: false,
    checkActive: false,
    deactivatedMessage: null,
  },
  ADMIN: {
    model: Admin,
    reqKey: 'admin',
    label: 'Admin',
    notFoundMessage: 'Admin account belonging to this token no longer exists.',
    roleMismatchMessage: 'Access denied. Account does not have administrator privileges.',
    normalizeRole: true,
    checkActive: true,
    deactivatedMessage: 'Admin account has been deactivated.',
  },
  VOLUNTEER: {
    model: Volunteer,
    reqKey: 'volunteer',
    label: 'Volunteer',
    notFoundMessage: 'Volunteer account belonging to this token no longer exists.',
    roleMismatchMessage: 'Access denied. Account does not have volunteer privileges.',
    normalizeRole: true,
    checkActive: true,
    deactivatedMessage: 'Volunteer account has been deactivated. Please contact an administrator.',
  },
};

/**
 * Resolve and validate the live database account matching an authenticated JWT role.
 * Enforces account existence, role match, and active status for staff accounts.
 */
const resolveAuthenticatedAccount = async (req, role, subjectId) => {
  const config = ROLE_CONFIG[role];
  if (!config) {
    return {
      error: {
        status: 403,
        code: 'FORBIDDEN_ROLE',
        message: 'Access denied. Insufficient role authorization.',
      },
    };
  }

  const account = await config.model.findById(subjectId);
  if (!account) {
    return {
      error: {
        status: 401,
        code: 'USER_NOT_FOUND',
        message: config.notFoundMessage,
      },
    };
  }

  const storedRole = config.normalizeRole ? account.role?.toUpperCase() : account.role;
  if (storedRole !== role) {
    return {
      error: {
        status: 403,
        code: 'FORBIDDEN_ROLE',
        message: config.roleMismatchMessage,
      },
    };
  }

  if (config.checkActive && !account.isActive) {
    return {
      error: {
        status: 403,
        code: 'ACCOUNT_DEACTIVATED',
        message: config.deactivatedMessage,
      },
    };
  }

  req[config.reqKey] = account;
  req.user = {
    id: account._id.toString(),
    role,
  };
  return { account };
};

/**
 * Single-role authentication middleware factory.
 *
 * Enforces:
 * 1. Valid HS256 JWT with role matching the guarded role.
 * 2. Live account existence in MongoDB with matching role.
 * 3. Verified active status for staff roles (isActive === true).
 * 4. Injects req.<role key> and req.user for downstream handlers.
 */
const createRoleGuard = (role) => {
  const config = ROLE_CONFIG[role];

  return async (req, res, next) => {
    try {
      let decoded;
      try {
        decoded = extractAndVerifyToken(req);
      } catch (tokenErr) {
        return res.status(tokenErr.statusCode || 401).json({
          success: false,
          code: tokenErr.code || 'AUTH_FAILED',
          message: tokenErr.message,
        });
      }

      if (decoded.role !== role) {
        return res.status(403).json({
          success: false,
          code: 'FORBIDDEN_ROLE',
          message: `Access denied. ${config.label} authorization required.`,
        });
      }

      const resolved = await resolveAuthenticatedAccount(req, role, decoded.sub.trim());
      if (resolved.error) {
        return res.status(resolved.error.status).json({
          success: false,
          code: resolved.error.code,
          message: resolved.error.message,
        });
      }

      next();
    } catch (error) {
      console.error(`${config.label} auth middleware error:`, error.message);
      return res.status(500).json({
        success: false,
        code: 'INTERNAL_AUTH_ERROR',
        message: 'Internal authentication error.',
      });
    }
  };
};

/**
 * Student Authentication Middleware (protectStudent)
 */
const protectStudent = createRoleGuard('STUDENT');

/**
 * Admin Authentication Middleware (protectAdmin)
 */
const protectAdmin = createRoleGuard('ADMIN');

/**
 * Volunteer Authentication Middleware (protectVolunteer)
 */
const protectVolunteer = createRoleGuard('VOLUNTEER');

/**
 * Role authorization middleware factory.
 *
 * Verifies that the authenticated user on req.user has the required role.
 */
const createRoleAuthorizer = (role) => {
  const config = ROLE_CONFIG[role];

  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_ROLE',
        message: `Access denied. ${config.label} authorization required.`,
      });
    }
    next();
  };
};

/**
 * Admin Authorization Middleware (authorizeAdmin)
 */
const authorizeAdmin = createRoleAuthorizer('ADMIN');

/**
 * Volunteer Authorization Middleware (authorizeVolunteer)
 */
const authorizeVolunteer = createRoleAuthorizer('VOLUNTEER');

/**
 * Shared Multi-Role Authentication Middleware Factory (protectRoles)
 *
 * Allows access to requests bearing a valid JWT whose role is included in allowedRoles,
 * while enforcing live MongoDB account existence and active staff verification.
 */
const protectRoles = (...allowedRoles) => {
  const normalizedAllowedRoles = allowedRoles
    .flat()
    .map((role) => (typeof role === 'string' ? role.trim().toUpperCase() : ''))
    .filter(Boolean);

  return async (req, res, next) => {
    try {
      let decoded;
      try {
        decoded = extractAndVerifyToken(req);
      } catch (tokenErr) {
        return res.status(tokenErr.statusCode || 401).json({
          success: false,
          code: tokenErr.code || 'AUTH_FAILED',
          message: tokenErr.message,
        });
      }

      const tokenRole = typeof decoded.role === 'string' ? decoded.role.trim().toUpperCase() : '';
      if (!normalizedAllowedRoles.includes(tokenRole)) {
        return res.status(403).json({
          success: false,
          code: 'FORBIDDEN_ROLE',
          message: 'Access denied. Insufficient role authorization.',
        });
      }

      const resolved = await resolveAuthenticatedAccount(req, tokenRole, decoded.sub.trim());
      if (resolved.error) {
        return res.status(resolved.error.status).json({
          success: false,
          code: resolved.error.code,
          message: resolved.error.message,
        });
      }

      next();
    } catch (error) {
      console.error('Multi-role auth middleware error:', error.message);
      return res.status(500).json({
        success: false,
        code: 'INTERNAL_AUTH_ERROR',
        message: 'Internal authentication error.',
      });
    }
  };
};

module.exports = {
  getJwtSecret,
  signStudentToken,
  signAdminToken,
  signVolunteerToken,
  protectStudent,
  protectAdmin,
  authorizeAdmin,
  protectVolunteer,
  authorizeVolunteer,
  protectRoles,
};
