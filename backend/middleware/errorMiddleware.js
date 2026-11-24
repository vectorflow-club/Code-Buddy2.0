/**
 * Centralized 404 and Error-Handling Middleware
 *
 * Enforces consistent JSON API error contracts across the Express 5 pipeline
 * without leaking stack traces, secrets, credentials, or internal DB details.
 */

const { buildErrorResponse } = require('../utils');

/**
 * Catch-all 404 middleware for unmatched API and non-API routes.
 * Must be registered after all application and health routes.
 */
const notFoundHandler = (req, res) => {
  return res.status(404).json(
    buildErrorResponse('ROUTE_NOT_FOUND', 'That page does not exist.')
  );
};

/**
 * Centralized Express 5 four-argument error-handling middleware.
 * Must be registered as the final middleware in backend/server.js.
 */
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (!err || typeof err !== 'object') {
    console.error(`[ErrorHandler] ${req.method} ${req.originalUrl} -> Non-object error thrown`);
    return res.status(500).json(
      buildErrorResponse('INTERNAL_SERVER_ERROR', 'Something went wrong on our side. Please try again.')
    );
  }

  if (err.code === 'CORS_ORIGIN_NOT_ALLOWED' || err.isCorsError) {
    return res.status(403).json(
      buildErrorResponse('CORS_ORIGIN_NOT_ALLOWED', 'Origin is not allowed by CORS policy.')
    );
  }

  if (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413) {
    return res.status(413).json(
      buildErrorResponse('PAYLOAD_TOO_LARGE', 'What you sent is too big.')
    );
  }

  if (
    err.type === 'entity.parse.failed' ||
    (err instanceof SyntaxError && (err.status === 400 || err.statusCode === 400) && 'body' in err)
  ) {
    return res.status(400).json(
      buildErrorResponse('INVALID_JSON_BODY', 'What you sent could not be read.')
    );
  }

  const explicitStatus = Number.isInteger(err.statusCode) ? err.statusCode : err.status;
  if (Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus < 500) {
    const code =
      typeof err.code === 'string' && err.code.trim() !== ''
        ? err.code.trim()
        : 'BAD_REQUEST';
    const message =
      typeof err.message === 'string' && err.message.trim() !== ''
        ? err.message
        : 'That could not be done. Please try again.';
    return res.status(explicitStatus).json(buildErrorResponse(code, message));
  }

  if (err.name === 'ValidationError' && err.errors && typeof err.errors === 'object') {
    const fieldMessages = Object.values(err.errors)
      .map((item) => (item && typeof item.message === 'string' ? item.message : null))
      .filter(Boolean);
    const summary =
      fieldMessages.length > 0
        ? fieldMessages.join(' ')
        : 'Some details are not right. Please check and try again.';
    return res.status(400).json(buildErrorResponse('VALIDATION_ERROR', summary));
  }

  if (err.name === 'CastError') {
    if (explicitStatus >= 500 || err.isInternalError) {
      console.error(`[ErrorHandler] ${req.method} ${req.originalUrl} -> Internal CastError (${err.path || 'unknown'})`);
      return res.status(500).json(
        buildErrorResponse('INTERNAL_SERVER_ERROR', 'Something went wrong on our side. Please try again.')
      );
    }

    if (err.kind === 'ObjectId' || err.path === '_id') {
      return res.status(400).json(
        buildErrorResponse('INVALID_ID', 'That ID does not look right.')
      );
    }

    return res.status(400).json(
      buildErrorResponse('INVALID_FIELD_FORMAT', 'One value does not look right.')
    );
  }

  if (err.code === 11000 || (typeof err.message === 'string' && err.message.includes('E11000'))) {
    return res.status(409).json(
      buildErrorResponse('DUPLICATE_RESOURCE', 'That value is already used.')
    );
  }

  // 8. Unexpected / unhandled server errors (never leak stack traces or secrets)
  console.error(
    `[ErrorHandler] ${req.method} ${req.originalUrl} -> ${err.name || 'Error'}: ${err.message || 'Unhandled server error'}`
  );

  return res.status(500).json(
    buildErrorResponse('INTERNAL_SERVER_ERROR', 'Something went wrong on our side. Please try again.')
  );
};

module.exports = {
  notFoundHandler,
  errorHandler,
};

