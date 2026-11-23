/**
 * Build the standard `{ success: false, code, message }` API error body.
 */
const buildErrorResponse = (code, message) => ({
  success: false,
  code,
  message,
});

/**
 * Build an operational HTTP error carrying a marker flag so the throwing
 * handler's catch block can tell its own errors apart from unexpected ones.
 * The flag name is caller-chosen: settlement code uses 'isSettlementHttpError',
 * recovery code uses 'isRecoveryError'. Behaviour is identical to the two
 * helpers this replaces.
 */
const createHttpError = (status, code, message, flag) => {
  const err = new Error(message);
  err[flag] = true;
  err.status = status;
  err.code = code;
  return err;
};

module.exports = {
  buildErrorResponse,
  createHttpError,
};
