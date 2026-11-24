import { useEffect, useState } from 'react'
import { Check, Clock3, Flag } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { backendCompetitionService } from '../services/backendCompetitionService'
import { useStudent } from '../context/StudentContext'
import { formatCurrency } from '../utils/formatters'
import { Button, CountdownDisplay, EmptyState, InlineTag, LoadingState } from '../components/ui'

function questionExamples(question) {
  if (Array.isArray(question.examples)) return question.examples.filter(Boolean)
  return question.sample ? [question.sample] : []
}

function QuestionCard({ question, status }) {
  const passed = status === 'PASS'
  const failed = status === 'FAIL'
  const statement = question.statement ?? question.prompt ?? ''
  const constraints = Array.isArray(question.constraints) ? question.constraints : question.constraints ? [question.constraints] : []
  const examples = questionExamples(question)
  // The grey box shows the question number and level - the identifiers the
  // organizer matches against their own page. The raw database id is never
  // shown to students. The level comes from the question snapshot; the
  // "Question H4" span that used to sit in the title is removed so the
  // number appears exactly once.
  const questionLabel = question.bankNumber ? `Question ${question.bankNumber}` : null
  const levelLabel = question.levelNumber ? `Level ${question.levelNumber}` : null
  const boxLabel = [levelLabel, questionLabel].filter(Boolean).join(' - ') || 'Assigned question'

  return <article className="question-card" aria-labelledby={`question-title-${question.id}`}>
    <header className="question-header">
      <div className="question-number" title="Assigned question">{boxLabel}</div>
      <div className="question-title"><InlineTag tone={question.difficulty?.toLowerCase()}>{question.difficulty}</InlineTag><h3 id={`question-title-${question.id}`}>{question.title}</h3></div>
      <span className={`evaluation-status${passed ? ' evaluation-pass' : failed ? ' evaluation-fail' : ''}`} aria-label={`Evaluation status: ${status}`}><span />{status}</span>
    </header>
    <div className="question-body">
      <div className="problem-section"><h4>Problem statement</h4><div className="problem-statement">{statement.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></div>
      {question.inputFormat && <div className="problem-section"><h4>Input format</h4><p className="format-copy">{question.inputFormat}</p></div>}
      {question.outputFormat && <div className="problem-section"><h4>Output format</h4><p className="format-copy">{question.outputFormat}</p></div>}
      {constraints.length > 0 && <div className="problem-section"><h4>Constraints</h4><ul>{constraints.map((constraint, index) => <li key={constraint?.id || index}>{typeof constraint === 'string' ? constraint : constraint?.text || constraint?.value || ''}</li>)}</ul></div>}
      {examples.length > 0 && <div className="sample-list"><h4 className="problem-section-heading">Sample input and output</h4>{examples.map((example, index) => <div className="sample-grid" key={example.id || index}><div><h5>{example.title || `Sample ${index + 1} · input`}</h5><pre>{example.input}</pre></div><div><h5>{example.title ? `${example.title} · output` : `Sample ${index + 1} · output`}</h5><pre>{example.output}</pre></div></div>)}</div>}
      <footer className="question-footer"><span><Check size={14} /> Evaluation by organizer</span><span className="readonly-evaluation">Read only</span></footer>
    </div>
  </article>
}

export default function RoundPage() {
  const { state, refresh } = useStudent()
  const navigate = useNavigate()
  const [round, setRound] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [pollError, setPollError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [pollKey, setPollKey] = useState(0)
  // The active round and the history load independently: a history failure
  // must never block the round view. The question renders as soon as the
  // active round resolves; history only feeds the evaluation status.
  useEffect(() => {
    let mounted = true
    backendCompetitionService.getActiveRound()
      .then(active => { if (mounted) { setRound(previous => ({ ...(previous || {}), active })); setLoading(false) } })
      .catch(loadError => { if (mounted) { setError(loadError.message || 'Round details are unavailable. Please return to your dashboard.'); setLoading(false) } })
    backendCompetitionService.getRoundHistory()
      .then(history => { if (mounted) { setRound(previous => ({ ...(previous || {}), history })); setHistoryError('') } })
      .catch(() => { if (mounted) setHistoryError('Round history could not be loaded.') })
    return () => { mounted = false }
  }, [reloadKey])
  // Fail-soft poll: a failed refresh never replaces the page. The question
  // stays visible, a small notice says the connection dropped, and polling
  // continues. History refreshes independently of the active round.
  useEffect(() => {
    const current = round?.active?.round
    if (!current) return undefined
    let mounted = true
    const sync = async () => {
      try {
        const active = await backendCompetitionService.getActiveRound()
        if (!mounted) return
        if (!active) {
          await refresh()
          navigate('/dashboard', { replace: true })
          return
        }
        setRound(previous => ({ ...previous, active }))
        setPollError('')
      } catch (pollFailure) {
        if (mounted) setPollError(pollFailure.message || 'Round status could not be refreshed.')
      }
      try {
        const history = await backendCompetitionService.getRoundHistory()
        if (!mounted) return
        setRound(previous => ({ ...previous, history }))
        setHistoryError('')
      } catch {
        if (mounted) setHistoryError('Round history could not be loaded.')
      }
    }
    sync()
    const interval = window.setInterval(sync, 10000)
    return () => { mounted = false; window.clearInterval(interval) }
  }, [round?.active?.round?.id, refresh, navigate, pollKey])

  function retryLoad() {
    setError('')
    setHistoryError('')
    setPollError('')
    setRound(null)
    setLoading(true)
    setReloadKey(key => key + 1)
  }

  function retryPoll() {
    setPollError('')
    setHistoryError('')
    setPollKey(key => key + 1)
  }

  if (error) return <div className="page"><div role="alert" className="error-state">{error}</div><div className="round-retry"><Button variant="dark" onClick={retryLoad}>Try again</Button><Link to="/dashboard" className="back-link">Back to dashboard</Link></div></div>
  if (loading) return <LoadingState label="Loading your assigned round…" />
  const activeRound = round.active?.round
  if (!activeRound) return <div className="page"><EmptyState title="No question has been assigned yet." detail="Return to your dashboard to enter your current level." action={<Button to="/dashboard" variant="dark">Back to dashboard</Button>} /></div>

  const configuration = state.competition
  const level = state.levelConfigurations.find(item => item.number === state.student.currentLevel)
  const nextLevel = state.levelConfigurations.find(item => item.number === state.student.currentLevel + 1)
  const question = activeRound.question
  const historyRound = round.history?.rounds?.find(item => item.id === activeRound.id)
  const evaluation = historyRound?.evaluation?.status || 'PENDING'
  const status = String(evaluation).toUpperCase()
  const passedCount = status === 'PASS' ? 1 : 0
  const timerStatus = activeRound.status === 'inProgress' ? 'Live timer' : activeRound.status === 'timeExpired' ? 'Time expired · awaiting evaluation' : activeRound.status === 'submitted' ? 'Submitted · awaiting evaluation' : activeRound.status === 'evaluated' ? 'Round evaluated' : 'Awaiting organizer start'
  const timerSeconds = activeRound.status === 'inProgress' ? activeRound.remainingSeconds : activeRound.status === 'timeExpired' ? 0 : null
  const roundLevelNumber = activeRound.levelNumber

  return <div className="page round-page">
    <Link to="/dashboard" className="back-link">← Back to dashboard</Link>
    {(pollError || historyError) && <div className="round-sync-notice" role="alert"><span>{pollError ? 'Connection lost - retrying...' : historyError}</span><button type="button" onClick={retryPoll}>Retry now</button></div>}
    <div className="round-top"><div><p className="eyebrow">{configuration?.name || 'Code Buddy'} · {level?.name || `Level ${roundLevelNumber}`}</p><h1>Your round.<br /><span>One assigned question.</span></h1><p className="hero-subtitle">Solve externally and demonstrate your solution to an organizer.</p></div><CountdownDisplay seconds={timerSeconds} status={timerStatus} running={activeRound?.status === 'inProgress'} /></div>
    <section className="round-guidance"><span><Clock3 size={16} />One shared timer</span><p>{activeRound.status === 'inProgress' ? `The official deadline is ${activeRound.deadline ? new Date(activeRound.deadline).toLocaleTimeString() : 'shown on the timer'}. This countdown follows the official timer. Refresh the page to update it.` : activeRound.status === 'timeExpired' ? 'Time has expired. Your organizer will record your result and move you on.' : activeRound.status === 'submitted' ? 'Your round is submitted and awaiting organizer evaluation. Your result will appear once your organizer records it.' : activeRound.status === 'evaluated' ? 'This round has been evaluated. Your result is shown below.' : 'Your assignment is ready. An organizer starts the official timer. No student timer controls are available.'}</p></section>
    <div className="question-list-heading"><div><h2>Your assigned question</h2><p>Evaluation is provided by your organizer and is read-only here.</p></div><div className="round-progress" aria-label={`${passedCount} of 1 questions passed`}><span>QUESTION PROGRESS</span><strong>{passedCount}/1</strong><div className="progress-track"><span style={{ width: `${passedCount * 100}%` }} /></div></div></div>
    <div className="language-row"><span>Supported walkthrough languages</span><div>{(configuration?.supportedLanguages || []).map(language => <InlineTag key={language}>{language}</InlineTag>)}</div><InlineTag tone="demo">ASSIGNED QUESTION</InlineTag></div>
    <div className="question-stack"><QuestionCard question={question} status={status} /></div>
    <section className="round-rules"><div className="rules-icon"><Flag size={17} /></div><div><strong>Competition rules</strong><p>Your assigned question must pass. {activeRound?.status === 'timeExpired' ? 'Time has expired; your result is pending until your organizer records it.' : 'Failure or timer expiry is handled by your organizer.'} {nextLevel ? `The next level risk requirement is ${formatCurrency(nextLevel.entryFee, configuration?.currency, configuration?.locale)}.` : 'Passing this question completes the final level.'} {level && `The pass payout is ${formatCurrency(level.passReward, configuration?.currency, configuration?.locale)}.`} Official results and wallet changes are recorded by your organizer.</p></div></section>
    <p className="round-readonly-note">Student evaluation and the official timer are managed by your organizer. Solve in your own tools and demonstrate your solution to an organizer.</p>
  </div>
}
