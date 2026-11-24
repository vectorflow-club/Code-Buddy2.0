export function formatCurrency(amount, currency = 'INR', locale = 'en-IN') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount ?? 0)
}

export function formatDuration(seconds = 0) {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (minutes && remainder) return `${minutes} min ${remainder} sec`
  if (minutes) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  return `${remainder} ${remainder === 1 ? 'second' : 'seconds'}`
}

export function formatClock(seconds = 0) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function formatDate(value, fallback = '—') {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString()
}

export function displayStatus(status) {
  if (['registered', 'inProgress', 'cleared'].includes(status)) return 'ACTIVE'
  return String(status || 'UNKNOWN').toUpperCase()
}

// Plain-English labels for the codes the backend stores. The codes stay
// exactly as they are in requests, routes and the database; only what the
// user reads changes.
const transactionTypeLabels = {
  STAKE_DEBIT: 'Money risked',
  REWARD_CREDIT: 'Prize won',
  REFUND: 'Money back',
  SAFE_ZONE_PAYOUT: 'Safe amount',
  ADMIN_ADJUSTMENT: 'Changed by admin',
  ROUND_SETTLEMENT: 'Round payment',
}

export function transactionTypeLabel(type) {
  return transactionTypeLabels[type] || String(type || '—')
}

const roundStatusLabels = {
  ready: 'Ready',
  inProgress: 'Playing now',
  timeExpired: 'Time up',
  submitted: 'Sent',
  evaluated: 'Result given',
  abandoned: 'Left',
}

export function roundStatusLabel(status) {
  return roundStatusLabels[status] || String(status || '—')
}

const evaluationStatusLabels = {
  PENDING: 'Waiting',
  PASS: 'Passed',
  FAIL: 'Failed',
}

export function evaluationStatusLabel(status) {
  return evaluationStatusLabels[status] || String(status || '—')
}

const competitionStatusLabels = {
  registered: 'Signed up',
  inProgress: 'Playing',
  cleared: 'Level cleared',
  eliminated: 'Out',
  completed: 'Finished',
  stopped: 'Stopped',
}

export function competitionStatusLabel(status) {
  return competitionStatusLabels[status] || String(status || '—')
}

const roundAvailabilityLabels = {
  unavailable: 'Not available',
  ready: 'Ready to play',
  inProgress: 'Playing now',
  evaluationPending: 'Waiting for result',
  cleared: 'Level cleared',
  eliminated: 'Out',
  completed: 'Finished',
  stopped: 'Stopped',
  insufficientBalance: 'Not enough money',
}

export function roundAvailabilityLabel(status) {
  return roundAvailabilityLabels[status] || String(status || '—')
}

// Counts maps are keyed by either a round status or an evaluation status;
// both maps are checked so one helper covers both tables.
export function statusCountLabel(key) {
  return roundStatusLabels[key] || evaluationStatusLabels[key] || String(key || '—')
}

const levelStatusLabels = {
  ACTIVE: 'On',
  INACTIVE: 'Off',
}

export function levelStatusLabel(status) {
  return levelStatusLabels[status] || String(status || '—')
}
