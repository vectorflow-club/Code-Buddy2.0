import { studentAuthenticationService } from '../services/studentAuthenticationService'
import { backendCompetitionService } from '../services/backendCompetitionService'

export async function loadStudentState() {
  const realSession = await studentAuthenticationService.restoreSession()
  if (realSession) {
    if (!realSession.auth?.signedIn) return { ...realSession, competition: null, levelConfigurations: [] }
    const requests = await Promise.allSettled([
      backendCompetitionService.getConfiguration(),
      backendCompetitionService.getLevelInfo(),
      backendCompetitionService.getActiveRound(),
      backendCompetitionService.getRoundHistory(),
      backendCompetitionService.getTransactions(),
      backendCompetitionService.getMyRank(),
    ])
    if (!studentAuthenticationService.hasRealSession && studentAuthenticationService.hasRealMode) {
      return { auth: { signedIn: false, mode: 'real' }, pendingIdentity: null, student: null, sessionExpired: true, competition: null, levelConfigurations: [] }
    }
    const [configuration, levelInfo, activeRound, roundHistory, wallet, leaderboard] = requests.map(result => result.status === 'fulfilled' ? result.value : null)
    const dataErrors = Object.fromEntries(requests.map((result, index) => [
      ['configuration', 'levelInfo', 'activeRound', 'roundHistory', 'wallet', 'leaderboard'][index],
      result.status === 'rejected' ? result.reason : null,
    ]))
    const student = {
      ...realSession.student,
      competitionStatus: activeRound?.competitionStatus ?? realSession.student.competitionStatus,
      roundAvailability: activeRound?.roundAvailability ?? realSession.student.roundAvailability,
      walletBalance: levelInfo?.walletBalance ?? realSession.student.walletBalance,
      currentLevel: levelInfo?.currentLevel ?? realSession.student.currentLevel,
      ...(wallet ? { totalEarned: wallet.totalEarned, totalRisked: wallet.totalRisked, safeZoneAmount: wallet.safeZoneAmount } : {}),
    }
    return {
      ...realSession,
      student,
      competition: configuration,
      levelConfigurations: configuration?.levels || [],
      levelInfo,
      activeRound,
      roundHistory,
      wallet,
      leaderboard,
      dataErrors,
    }
  }
  return { auth: { signedIn: false, mode: null }, pendingIdentity: null, student: null, competition: null, levelConfigurations: [] }
}
