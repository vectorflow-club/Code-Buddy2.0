import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { ArrowRight, CircleHelp, Clock3, Code2, LoaderCircle, ShieldCheck } from 'lucide-react'
import { formatClock, formatDuration } from '../utils/formatters'

export function Brand({ inverse = false }) {
  return <Link to="/dashboard" className={`brand${inverse ? ' brand-inverse' : ''}`} aria-label="Code Buddy home"><span className="brand-symbol"><Code2 size={19} strokeWidth={2.4} /></span><span>code buddy<span className="brand-dot">.</span></span></Link>
}
export function Button({ children, to, variant = 'dark', className = '', type = 'button', onClick, disabled = false }) {
  const classes = `button button-${variant} ${className}`
  return to && !disabled ? <Link to={to} className={classes}>{children}</Link> : <button type={type} onClick={onClick} disabled={disabled} className={classes}>{children}</button>
}
export function SectionHeading({ kicker, title, detail, action }) {
  return <div className="section-heading"><div><p className="eyebrow">{kicker}</p><h2>{title}</h2>{detail && <p className="section-detail">{detail}</p>}</div>{action}</div>
}
export function LoadingState({ label = 'Loading your competition…' }) { return <div className="state-message"><LoaderCircle className="spin" size={20} aria-hidden="true" />{label}</div> }
export function EmptyState({ title, detail, action }) { return <div className="empty-state"><CircleHelp size={24} /><h2>{title}</h2><p>{detail}</p>{action}</div> }
export function ErrorState({ message = 'Something went wrong. Please try again.' }) { return <div role="alert" className="error-state"><CircleHelp size={17} />{message}</div> }
export function InlineTag({ children, tone = 'default' }) { return <span className={`tag tag-${tone}`}>{children}</span> }
export function MetricCard({ label, value, caption, accent = false }) { return <article className={`metric-card${accent ? ' metric-accent' : ''}`}><p>{label}</p><strong>{value}</strong>{caption && <span>{caption}</span>}</article> }
export function Pagination({ pagination, limit, loading, onPageChange, onLimitChange, perPageLabel }) {
  return <div className="participant-toolbar"><span>{pagination ? `Page ${pagination.page} of ${pagination.totalPages}` : ''}</span><select aria-label={perPageLabel} value={limit} onChange={onLimitChange} disabled={loading}>{[10, 20, 50, 100].map(value => <option key={value} value={value}>{value} per page</option>)}</select><button className="participant-view-btn" type="button" onClick={() => onPageChange((pagination?.page || 1) - 1)} disabled={loading || !pagination?.hasPrevPage}>Previous</button><button className="participant-view-btn" type="button" onClick={() => onPageChange((pagination?.page || 1) + 1)} disabled={loading || !pagination?.hasNextPage}>Next</button></div>
}
export function CountdownDisplay({ seconds, status, running = false }) {
  const [displaySeconds, setDisplaySeconds] = useState(seconds)
  useEffect(() => {
    setDisplaySeconds(seconds)
    if (!running || !Number.isFinite(seconds)) return undefined
    const displayDeadline = Date.now() + seconds * 1000
    const update = () => {
      setDisplaySeconds(Math.max(0, Math.ceil((displayDeadline - Date.now()) / 1000)))
    }
    update()
    const interval = window.setInterval(update, 1000)
    return () => window.clearInterval(interval)
  }, [seconds, running])
  return <div className="timer-block"><span><Clock3 size={14} /> Organizer controlled</span><strong>{Number.isFinite(displaySeconds) ? formatClock(displaySeconds) : '— — : — —'}</strong><small>{status || (Number.isFinite(seconds) ? `Reference duration · ${formatDuration(seconds)}` : 'Timer not started')}</small></div>
}
export function NextArrow() { return <ArrowRight size={17} aria-hidden="true" /> }
export function TrustNote({ children }) { return <p className="trust-note"><ShieldCheck size={15} />{children}</p> }
