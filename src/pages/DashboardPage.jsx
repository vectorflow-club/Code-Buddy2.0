import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookOpenText, CircleDot, Clock3, Wallet, Zap } from 'lucide-react'
import { useStudent } from '../context/StudentContext'
import { backendCompetitionService } from '../services/backendCompetitionService'
import { competitionStatusLabel, formatCurrency, roundAvailabilityLabel } from '../utils/formatters'
import { Button, CountdownDisplay, InlineTag, MetricCard, NextArrow, SectionHeading } from '../components/ui'

export default function DashboardPage() {
  const { state, refresh } = useStudent()
  const navigate = useNavigate()
  const [entering, setEntering] = useState(false)
  const [enterError, setEnterError] = useState('')
  const [confirmingStop, setConfirmingStop] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [liveRound, setLiveRound] = useState(null)
  const allocationInFlight = useRef(false)
  // Live round timer, mirroring the Round page: fetch the active round on
  // mount and re-poll every 10s while one exists. Fails soft: a failed
  // fetch (backend down) leaves the dashboard as it was; the timer is
  // extra, never a full-page error on the landing page.
  useEffect(() => {
    let mounted = true
    backendCompetitionService.getActiveRound()
      .then(active => { if (mounted) setLiveRound(active?.round || null) })
      .catch(() => { if (mounted) setLiveRound(null) })
    return () => { mounted = false }
  }, [])
  useEffect(() => {
    if (!liveRound) return undefined
    let mounted = true
    const interval = window.setInterval(async () => {
      try {
        const active = await backendCompetitionService.getActiveRound()
        if (mounted) setLiveRound(active?.round || null)
      } catch (pollError) {
        // Fail soft: keep the last known timer instead of erroring.
      }
    }, 10000)
    return () => { mounted = false; window.clearInterval(interval) }
  }, [liveRound?.id])
  const student = state.student
  const level = state.levelInfo?.level
  const balance = state.levelInfo?.walletBalance ?? student.walletBalance
  const hasActiveRound = Boolean(state.activeRound?.round)
  const canAllocate = student.roundAvailability === 'ready' && !hasActiveRound
  // Voluntary cash-out, between levels only: the student can stop once they
  // have something to keep (a balance, or a cleared level behind them).
  const canStop = canAllocate && ((typeof balance === 'number' && balance > 0) || (student.currentLevel || 1) > 1)
  const stopAmount = typeof balance === 'number' ? formatCurrency(balance, state.competition?.currency, state.competition?.locale) : 'your balance'
  const roundMessage = student.roundAvailability === 'inProgress' ? 'Your organizer has started this round.'
    : student.roundAvailability === 'evaluationPending' ? 'Your organizer is checking your answer.'
      : student.roundAvailability === 'eliminated' ? 'You are out of the competition.'
        : student.roundAvailability === 'completed' ? 'You finished the competition.'
          : student.roundAvailability === 'stopped' ? 'You stopped and kept your money.'
          : hasActiveRound ? 'Your question is ready.'
            : student.roundAvailability === 'ready' ? typeof level?.entryRiskAmount === 'number' ? 'You can enter this round.' : 'The risk amount for this level is missing.'
              : 'We cannot tell if you can play right now.'
  const allocateRealRound = async () => {
    if (!canAllocate || allocationInFlight.current) return
    allocationInFlight.current = true
    setEntering(true)
    setEnterError('')
    try {
      await backendCompetitionService.allocateQuestion()
      await refresh()
      navigate('/round')
    } catch (error) {
      setEnterError(error.message || 'Your question could not be loaded.')
    } finally {
      allocationInFlight.current = false
      setEntering(false)
    }
  }
  const stopCompetition = async () => {
    if (stopping) return
    setStopping(true)
    setEnterError('')
    try {
      await backendCompetitionService.stopCompetition()
      setConfirmingStop(false)
      await refresh()
      navigate('/result/stopped')
    } catch (error) {
      setEnterError(error.message || 'Stopping did not work. Please try again.')
      setConfirmingStop(false)
    } finally {
      setStopping(false)
    }
  }
  return <div className="page dashboard-page">
    <div className="dashboard-heading"><div><p className="eyebrow">Verified student · {student.year}</p><h1>Good to see you,<br /><span>{student.name.split(' ')[0]}.</span></h1><p className="hero-subtitle">Your competition profile.</p></div><div className="dashboard-id"><span className="id-label">YOUR DETAILS</span><strong>{student.usn}</strong><span>{student.email}</span><span>{student.year}</span></div></div>
    <section className="round-banner"><div className="round-copy"><span className="round-mark"><Zap size={18} /></span><div><p className="eyebrow">Competition status</p><h2>{competitionStatusLabel(student.competitionStatus)} · L{student.currentLevel || '—'}</h2><p>{roundMessage}</p>{level && <p>{level.name} · You risk {typeof level.entryFee === 'number' ? formatCurrency(level.entryFee, state.competition?.currency, state.competition?.locale) : '—'} · Prize for passing {typeof level.passReward === 'number' ? formatCurrency(level.passReward, state.competition?.currency, state.competition?.locale) : '—'}</p>}</div></div><div className="round-banner-action"><InlineTag>{roundAvailabilityLabel(student.roundAvailability)}</InlineTag>{liveRound?.status === 'inProgress' && <CountdownDisplay seconds={liveRound.remainingSeconds} status={liveRound.isPaused ? 'Paused' : 'Live timer'} running={!liveRound.isPaused} />}{confirmingStop ? <div className="stop-confirm" role="alertdialog" aria-label="Confirm stopping"><p>Stop here and keep {stopAmount}? You won&apos;t be able to continue.</p><div className="stop-confirm-actions"><Button variant="outline" disabled={stopping} onClick={() => setConfirmingStop(false)}>Keep playing</Button><Button variant="dark" disabled={stopping} onClick={stopCompetition}>{stopping ? 'Stopping...' : 'Yes, stop'}</Button></div></div> : student.roundAvailability === 'eliminated' ? <Button to="/result/eliminated" variant="outline">View result</Button> : student.roundAvailability === 'stopped' ? <Button to="/result/stopped" variant="outline">View result</Button> : student.roundAvailability === 'completed' ? <Button to="/result/completed" variant="lime">View completion</Button> : hasActiveRound ? <Button to="/round" variant="lime">Start round <NextArrow /></Button> : canAllocate ? <><Button disabled={entering} onClick={allocateRealRound} variant="lime">{entering ? 'Loading assignment…' : 'Enter current level'} <NextArrow /></Button>{canStop && <Button variant="outline" onClick={() => setConfirmingStop(true)}>Stop here</Button>}</> : student.roundAvailability === 'ready' && level && typeof balance === 'number' && typeof level.entryRiskAmount === 'number' && balance < level.entryRiskAmount ? <Button to="/result/insufficient" variant="outline">Not enough money</Button> : student.roundAvailability === 'evaluationPending' ? <Button to="/round" variant="lime">View your result</Button> : <span className="round-unavailable">{state.dataErrors?.levelInfo?.message || 'We could not load your level.'}</span>}</div><div className="banner-index" aria-hidden="true">{String(student.currentLevel || 0).padStart(2, '0')}</div></section>
    {enterError && <p className="error-state" role="alert">{enterError}</p>}
    {state.dataErrors?.configuration && <p className="error-state" role="alert">Competition settings are missing: {state.dataErrors.configuration.message}</p>}
    <SectionHeading kicker="Verified account" title="Your profile." detail="Your competition settings and wallet." />
    <section className="metric-grid" aria-label="Competition statistics"><MetricCard label="Current level" value={student.currentLevel ? `L${student.currentLevel}` : '—'} caption={level?.name || 'From your record'} accent /><MetricCard label="Wallet balance" value={typeof balance === 'number' ? formatCurrency(balance, state.competition?.currency, state.competition?.locale) : '—'} caption="From your record" /><MetricCard label="Levels cleared" value={typeof student.levelsCleared === 'number' ? String(student.levelsCleared).padStart(2, '0') : '—'} caption="From your record" /></section>
    {state.competition && <section className="journey-row"><div><p className="eyebrow">The path ahead</p><h2>{state.competition.totalLevels} levels. One clear route.</h2><p>Cleared levels are marked below.</p></div><div className="level-track" aria-label={`${student.levelsCleared || 0} of ${state.competition.totalLevels} levels cleared`}>{state.competition.levels.map(item => { const complete = item.number <= (student.levelsCleared || 0); const current = item.number === student.currentLevel; const locked = !complete && !current; const levelState = complete ? 'cleared' : current ? 'current' : 'locked'; return <span key={item.number} className={`level-node${complete ? ' level-complete' : ''}${current ? ' level-current' : ''}${locked ? ' level-locked' : ''}`} title={`L${item.number} · ${levelState}`} aria-label={`L${item.number}, ${levelState}`}><span>{complete ? '✓' : String(item.number).padStart(2, '0')}</span></span> })}</div></section>}
    <section className="finance-strip" aria-label="Wallet summary"><div><span className="finance-icon"><Wallet size={17} /></span><div><span>Total won</span><strong>{typeof student.totalEarned === 'number' ? formatCurrency(student.totalEarned, state.competition?.currency, state.competition?.locale) : '—'}</strong></div></div><span className="finance-divider" /><div><span>Total you risked</span><strong>{typeof student.totalRisked === 'number' ? formatCurrency(student.totalRisked, state.competition?.currency, state.competition?.locale) : '—'}</strong></div><span className="finance-divider" /><div><span>Amount you keep</span><strong>{typeof student.safeZoneAmount === 'number' ? formatCurrency(student.safeZoneAmount, state.competition?.currency, state.competition?.locale) : '—'}</strong></div></section>
    <section className="round-rules"><div><strong>How a round works</strong><p>An organizer starts the official timer and records your result. Your wallet and level update after each round.</p>{state.wallet?.transactions?.length > 0 && <p><Link to="/wallet">See your {state.wallet.count} wallet entries <NextArrow /></Link></p>}</div></section>
    {state.leaderboard?.participant && <section className="personal-rank" aria-label="Your competition position"><span>YOUR COMPETITION POSITION</span><strong>#{state.leaderboard.participant.rank}</strong><small>of {state.leaderboard.totalParticipants} students</small></section>}
    {state.dataErrors?.leaderboard && <p className="record-source">We cannot show your place right now.</p>}
    <section className="dashboard-links"><Link to="/records"><BookOpenText size={17}/><span><strong>Competition records</strong><small>Two records from the whole competition</small></span><NextArrow/></Link><Link to="/history"><Clock3 size={17}/><span><strong>Round history</strong><small>Past rounds and results</small></span><NextArrow/></Link><Link to="/profile"><CircleDot size={17}/><span><strong>My student profile</strong><small>See your sign-up details</small></span><NextArrow/></Link><Link to="/wallet"><Wallet size={17}/><span><strong>Wallet activity</strong><small>Your money and past entries</small></span><NextArrow/></Link></section>
  </div>
}
