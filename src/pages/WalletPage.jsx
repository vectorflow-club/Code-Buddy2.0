import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Wallet } from 'lucide-react'
import { EmptyState, LoadingState, MetricCard, SectionHeading } from '../components/ui'
import { useStudent } from '../context/StudentContext'
import { backendCompetitionService } from '../services/backendCompetitionService'
import { formatCurrency, transactionTypeLabel } from '../utils/formatters'

export default function WalletPage() {
  const { state } = useStudent()
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let mounted = true
    setData(null); setError(null)
    const request = backendCompetitionService.getTransactions({ page, limit: 20 })
    request.then(result => { if (mounted) setData(result) }).catch(loadError => { if (mounted) setError(loadError) })
    return () => { mounted = false }
  }, [page])

  return <div className="page wallet-page">
    <SectionHeading kicker="Student wallet" title="Wallet activity." detail="Your money and past entries. Your organizer adds each result." />
    {error && <div className="error-state" role="alert">{error.message || 'We could not load your wallet.'}</div>}
    {!data && !error && <LoadingState label="Loading wallet details…" />}
    {data && <>
      <section className="metric-grid" aria-label="Wallet balances">
        <MetricCard label={['stopped', 'eliminated', 'completed'].includes(state.student?.competitionStatus) ? 'Money to collect' : 'Current balance'} value={formatCurrency(data.walletBalance, state.competition?.currency, state.competition?.locale)} caption="Your money right now" accent />
        <MetricCard label="Total won" value={formatCurrency(data.totalEarned, state.competition?.currency, state.competition?.locale)} caption="From your record" />
        <MetricCard label="Total you risked" value={formatCurrency(data.totalRisked, state.competition?.currency, state.competition?.locale)} caption="From your record" />
      </section>
      <section className="wallet-ledger" aria-labelledby="wallet-ledger-title">
        <div className="wallet-ledger-heading"><span className="record-icon"><Wallet size={18}/></span><div><h2 id="wallet-ledger-title">Money history</h2><p>Past entries cannot be changed.</p></div></div>
        {data.transactions?.length ? <div className="transaction-list">{data.transactions.map(transaction => <article className="transaction-row" key={transaction.id}><span className="transaction-mark" aria-hidden="true">{transaction.type === 'REWARD_CREDIT' ? <ArrowDown size={16}/> : <ArrowUp size={16}/>}</span><div className="transaction-description"><strong>{transaction.description || transactionTypeLabel(transaction.type)}</strong><span>{transactionTypeLabel(transaction.type)} · Level {transaction.levelNumber ?? '—'} · {new Date(transaction.timestamp).toLocaleString()}</span></div><div className="transaction-amount"><strong>{formatCurrency(transaction.amount, state.competition?.currency, state.competition?.locale)}</strong><span>Money left · {formatCurrency(transaction.balanceAfter, state.competition?.currency, state.competition?.locale)}</span></div></article>)}</div> : <EmptyState title="No money moves yet." detail="No money has moved in or out yet." />}
        {data.pagination?.totalPages > 1 && <nav className="ledger-pagination" aria-label="Money history pages"><button type="button" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={!data.pagination.hasPrevPage}>Previous</button><span>Page {page} of {data.pagination.totalPages}</span><button type="button" onClick={() => setPage(value => value + 1)} disabled={!data.pagination.hasNextPage}>Next</button></nav>}
      </section>
      <p className="record-source">Wallet records</p>
    </>}
  </div>
}
