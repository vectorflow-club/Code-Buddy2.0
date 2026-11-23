/**
 * Format an immutable Transaction ledger record for student consumption.
 */
const formatStudentTransactionResponse = (transaction) => ({
  id: (transaction._id || '').toString(),
  type: transaction.type,
  status: transaction.status || 'SUCCESS',
  amount: transaction.amount,
  balanceAfter: transaction.balanceAfter,
  levelNumber: transaction.levelNumber ?? null,
  roundId: transaction.roundId ? transaction.roundId.toString() : null,
  description: transaction.description,
  timestamp: transaction.timestamp,
});

/**
 * Validate and parse a stored Round deadline into epoch milliseconds.
 * Safely guards against null, undefined, booleans, empty strings, non-date objects, and NaN timestamps.
 */
const parseValidDeadlineMs = (deadline) => {
  if (deadline === null || deadline === undefined || deadline === '') {
    return {
      errorCode: 'MISSING_ROUND_DEADLINE',
      message: 'Active round is missing a stored deadline.',
    };
  }

  if (!(deadline instanceof Date) && typeof deadline !== 'string' && typeof deadline !== 'number') {
    return {
      errorCode: 'INVALID_ROUND_DEADLINE',
      message: 'Active round contains an invalid deadline value.',
    };
  }

  const timestampMs = deadline instanceof Date ? deadline.getTime() : new Date(deadline).getTime();
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    return {
      errorCode: 'INVALID_ROUND_DEADLINE',
      message: 'Active round contains an invalid deadline timestamp.',
    };
  }

  return { timestampMs };
};

/**
 * Derive non-mutating remainingSeconds and isExpired timer metadata from a Round document.
 */
const computeTimerFields = (round, now = new Date()) => {
  if (!round) {
    return { remainingSeconds: null, isExpired: false };
  }

  if (round.status === 'timeExpired') {
    return { remainingSeconds: 0, isExpired: true };
  }

  if (round.status === 'inProgress') {
    const parsed = parseValidDeadlineMs(round.deadline);
    if (parsed.errorCode) {
      return { remainingSeconds: null, isExpired: false };
    }
    const diffMs = parsed.timestampMs - now.getTime();
    if (diffMs <= 0) {
      return { remainingSeconds: 0, isExpired: true };
    }
    return { remainingSeconds: Math.ceil(diffMs / 1000), isExpired: false };
  }

  if (['submitted', 'evaluated', 'abandoned'].includes(round.status)) {
    return { remainingSeconds: 0, isExpired: false };
  }

  // 'ready' or not yet started
  return { remainingSeconds: null, isExpired: false };
};

/**
 * Format round response for client consumption.
 * Strictly sanitizes question content: hiddenTestCases are NEVER exposed,
 * and the bank number is exposed only when showBankNumber is true.
 */
const formatRoundStudentResponse = (round, timerState = null) => {
  const snapshot = round.questionSnapshot || {};
  const timer = timerState || computeTimerFields(round);
  const showBankNumber = snapshot.showBankNumber !== false && Boolean(snapshot.bankNumber);
  return {
    id: (round._id || '').toString(),
    studentId: (round.studentId || '').toString(),
    levelNumber: round.levelNumber,
    questionId: (round.questionId || '').toString(),
    status: round.status,
    durationSeconds: round.durationSeconds,
    startedAt: round.startedAt || null,
    deadline: round.deadline || null,
    remainingSeconds: timer.remainingSeconds,
    isExpired: timer.isExpired,
    completedAt: round.completedAt || null,
    createdAt: round.createdAt,
    question: {
      questionId: snapshot.questionId
        ? snapshot.questionId.toString()
        : (round.questionId || '').toString(),
      title: snapshot.title,
      statement: snapshot.statement,
      constraints: snapshot.constraints || [],
      examples: snapshot.examples || [],
      difficulty: snapshot.difficulty,
      levelNumber: snapshot.levelNumber,
      ...(showBankNumber ? { bankNumber: snapshot.bankNumber } : {}),
    },
  };
};

/**
 * Format round response for volunteer consumption. Volunteers always see the
 * bank number and its visibility flag — they need the number to match the
 * student to the right test sheet — even when the number is hidden from the
 * student. Hidden test cases are still never exposed here.
 */
const formatRoundVolunteerResponse = (round, timerState = null) => {
  const studentView = formatRoundStudentResponse(round, timerState);
  const snapshot = round.questionSnapshot || {};
  return {
    ...studentView,
    question: {
      ...studentView.question,
      bankNumber: snapshot.bankNumber || '',
      showBankNumber: snapshot.showBankNumber !== false,
    },
  };
};

/**
 * Format Level configuration for student-facing API responses.
 */
const formatLevelResponse = (levelConfig) => ({
  number: levelConfig.number,
  name: levelConfig.name,
  entryRiskAmount:
    levelConfig.entryRiskAmount !== null && levelConfig.entryRiskAmount !== undefined
      ? levelConfig.entryRiskAmount
      : 0,
  winningPayout: levelConfig.winningPayout,
  losingPayout: levelConfig.losingPayout,
  safeZoneAmount: levelConfig.safeZoneAmount ?? 0,
  isSafeZone: Boolean(levelConfig.isSafeZone),
  isFinal: Boolean(levelConfig.isFinal),
  durationSeconds: levelConfig.durationSeconds,
});

/**
 * Format Volunteer document for API responses, ensuring passwordHash is excluded
 * unless the caller explicitly asks for the password (admin detail view only:
 * organizer passwords are stored as plain text, so the admin can read them
 * back; the list endpoint never includes them).
 */
const formatVolunteerResponse = (volunteer, options = {}) => ({
  id: volunteer._id.toString(),
  name: volunteer.name,
  username: volunteer.username,
  role: 'VOLUNTEER',
  isActive: volunteer.isActive,
  assignedLab: volunteer.assignedLab || '',
  createdAt: volunteer.createdAt,
  updatedAt: volunteer.updatedAt,
  ...(options.includePassword ? { password: volunteer.passwordHash || '' } : {}),
});

module.exports = {
  formatStudentTransactionResponse,
  parseValidDeadlineMs,
  computeTimerFields,
  formatRoundStudentResponse,
  formatRoundVolunteerResponse,
  formatLevelResponse,
  formatVolunteerResponse,
};
