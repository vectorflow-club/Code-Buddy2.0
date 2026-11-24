import { useEffect, useState } from 'react'
import { ArrowUpRight, Medal, Wallet } from 'lucide-react'
import { backendCompetitionService } from '../services/backendCompetitionService'
import { useStudent } from '../context/StudentContext'
import { formatCurrency } from '../utils/formatters'
import { EmptyState, LoadingState, SectionHeading } from '../components/ui'

export default function RecordsPage() {
  const { state } = useStudent()
  const [records, setRecords] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { backendCompetitionService.getRecords().then(setRecords).catch(setError) }, [])
  const recordLevel = state.levelConfigurations.find(level => level.number === records?.highestRound?.value)

  return <div className="page records-page">
    <SectionHeading kicker="Competition-wide milestones" title="Competition records." detail="Two records from the whole competition. No rankings." />
    {error && <div className="error-state" role="alert">{error.message || 'We could not load the records. Please try again.'}</div>}
    {!records && !error && <LoadingState label="Loading competition records…" />}
    {records && <>
      <div className="record-grid">
        <article className="record-card"><div className="record-top"><span className="record-icon"><Medal size={19}/></span><span className="eyebrow">RECORD A</span></div><p className="record-label">Furthest level reached</p><strong className="record-value">{recordLevel?.name || (records.highestRound?.value ? `Level ${records.highestRound.value}` : 'No record yet')}</strong><div className="record-holder"><span>Student</span><b>{records.highestRound?.participantName || '—'}</b></div></article>
        <article className="record-card record-highlight"><div className="record-top"><span className="record-icon"><Wallet size={19}/></span><span className="eyebrow">RECORD B</span></div><p className="record-label">Most money won</p><strong className="record-value">{typeof records.highestEarnings?.value === 'number' ? formatCurrency(records.highestEarnings.value, state.competition?.currency, state.competition?.locale) : 'No record yet'}</strong><div className="record-holder"><span>Student</span><b>{records.highestEarnings?.participantName || '—'}</b></div></article>
      </div>
      <p className="record-footnote"><ArrowUpRight size={14}/> The most money won by one student.</p>
      <p className="record-source">Competition record</p>
    </>}
  </div>
}
