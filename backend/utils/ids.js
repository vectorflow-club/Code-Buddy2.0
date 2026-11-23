const mongoose = require('mongoose');

const OBJECT_ID_HEX_REGEX = /^[0-9a-fA-F]{24}$/;

/**
 * Plain MongoDB ObjectId validity check (BSON semantics).
 */
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

/**
 * Strict ObjectId check: the value must be a string of exactly 24 hex
 * characters AND pass BSON validation. Checking 24-hex format first avoids
 * BSON ObjectId.isValid() returning true for 12-char ASCII USNs.
 */
const isStrictObjectId = (value) =>
  typeof value === 'string' &&
  OBJECT_ID_HEX_REGEX.test(value) &&
  mongoose.Types.ObjectId.isValid(value);

module.exports = {
  isValidObjectId,
  isStrictObjectId,
};
