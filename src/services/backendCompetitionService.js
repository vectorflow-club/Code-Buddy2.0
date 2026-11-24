import { apiClient, ApiError, API_ERROR_CODES } from './apiClient'
import { normalizeCompetitionConfiguration, normalizeCompetitionLevel, normalizeCompetitionRecords, normalizeBackendRound } from './normalizers'

const SUPPORTED_LANGUAGES = ['C', 'C++', 'Java', 'Python']

function requireSuccess(response, label) {
  if (!response || response.success !== true) {
    throw new ApiError(`The site sent a strange ${label} reply. Please try again.`, API_ERROR_CODES.RESPONSE)
  }
  return response
}

function isMissingRound(error) {
  return error instanceof ApiError && error.status === 404 && error.responseBody?.code === 'ROUND_NOT_ALLOCATED'
}

export const backendCompetitionService = {
  async getConfiguration() {
    const response = requireSuccess(await apiClient.get('/api/competition/config'), 'competition settings')
    const configuration = normalizeCompetitionConfiguration({
      ...response,
      currency: response.currency ?? 'INR',
      locale: response.locale ?? 'en-IN',
      supportedLanguages: response.supportedLanguages ?? SUPPORTED_LANGUAGES,
      questionsPerRound: response.questionsPerRound ?? 1,
    })
    if (configuration.totalLevels !== 6 || configuration.levels.length !== 6) {
      throw new ApiError('The competition settings do not have six levels.', API_ERROR_CODES.RESPONSE, { responseBody: response })
    }
    return { ...configuration, name: response.name ?? 'Code Buddy', source: 'backend' }
  },

  async getLevelInfo() {
    const response = requireSuccess(await apiClient.get('/api/rounds/level-info'), 'current level')
    return {
      ...response,
      level: normalizeCompetitionLevel(response.level),
      source: 'backend',
    }
  },

  async allocateQuestion() {
    // This endpoint accepts no body and creates or returns the student's persistent assignment.
    const response = requireSuccess(await apiClient.post('/api/rounds/allocate'), 'question')
    if (!response.round) throw new ApiError('The site did not send your round.', API_ERROR_CODES.RESPONSE)
    return { ...response, round: normalizeBackendRound(response.round), source: 'backend' }
  },

  async stopCompetition() {
    // Voluntary cash-out between levels. No body; the backend guards
    // against stopping mid-round and answers idempotently.
    const response = requireSuccess(await apiClient.post('/api/student/stop'), 'stop')
    return { ...response, source: 'backend' }
  },

  async getActiveRound() {
    try {
      const response = requireSuccess(await apiClient.get('/api/rounds/active'), 'active round')
      if (!response.round) throw new ApiError('The site did not send your round details.', API_ERROR_CODES.RESPONSE)
      return { ...response, round: normalizeBackendRound(response.round), source: 'backend' }
    } catch (error) {
      if (isMissingRound(error)) return null
      throw error
    }
  },

  async getRoundHistory({ page = 1, limit = 20 } = {}) {
    const response = requireSuccess(await apiClient.get(`/api/student/rounds/history?page=${page}&limit=${limit}`), 'past rounds')
    return { ...response, rounds: (response.rounds || []).map(round => ({ ...normalizeBackendRound(round), evaluation: round.evaluation || null })), source: 'backend' }
  },

  async getMyRank() {
    return { ...requireSuccess(await apiClient.get('/api/leaderboard/me'), 'your place in the competition'), source: 'backend' }
  },

  async getTransactions({ page = 1, limit = 20 } = {}) {
    return { ...requireSuccess(await apiClient.get(`/api/student/transactions?page=${page}&limit=${limit}`), 'money'), source: 'backend' }
  },

  async getRecords() {
    return normalizeCompetitionRecords(requireSuccess(await apiClient.get('/api/competition/records'), 'records'))
  },
}
