/**
 * Shared competition constants — the single source of truth for values that
 * were previously copied across models, controllers, scripts, and tests.
 *
 * Timer rule: the duration values below are DEFAULTS for seeding and fixtures
 * only. At runtime the stored Level document's durationSeconds is the
 * authority (admins may change times on the event day); nothing in the
 * round/timer flow reads a timer value from here.
 */

// Number of competition levels (L1..L6).
const TOTAL_LEVELS = 6;

// Level numbers 1..TOTAL_LEVELS, for queries that must cover every level.
const LEVEL_NUMBERS = Object.freeze(
  Array.from({ length: TOTAL_LEVELS }, (_, index) => index + 1)
);

// First academic year — the only year assigned EASY questions.
const FIRST_YEAR = '1st Year';

// Academic years, in order. The first entry is FIRST_YEAR.
const ACADEMIC_YEARS = Object.freeze([FIRST_YEAR, '2nd Year', '3rd Year', '4th Year']);

// University Seat Number format: 8-15 alphanumeric characters. Callers
// uppercase the input before testing; the flag only makes the check itself
// case-insensitive. No /g flag, so the shared instance is safe to reuse.
const USN_REGEX = /^[A-Z0-9]{8,15}$/i;

// Immutable ledger transaction types (matches the Transaction model enum).
const TRANSACTION_TYPES = Object.freeze({
  STAKE_DEBIT: 'STAKE_DEBIT',
  REWARD_CREDIT: 'REWARD_CREDIT',
  REFUND: 'REFUND',
  SAFE_ZONE_PAYOUT: 'SAFE_ZONE_PAYOUT',
  ADMIN_ADJUSTMENT: 'ADMIN_ADJUSTMENT',
  ROUND_SETTLEMENT: 'ROUND_SETTLEMENT',
});

// Default round length in seconds for Levels 1-3 (3 minutes).
const DEFAULT_LEVEL_DURATION_SECONDS = 180;

// Extended round length in seconds for Levels 4-6 (5 minutes).
const EXTENDED_LEVEL_DURATION_SECONDS = 300;

module.exports = {
  TOTAL_LEVELS,
  LEVEL_NUMBERS,
  FIRST_YEAR,
  ACADEMIC_YEARS,
  USN_REGEX,
  TRANSACTION_TYPES,
  DEFAULT_LEVEL_DURATION_SECONDS,
  EXTENDED_LEVEL_DURATION_SECONDS,
};
