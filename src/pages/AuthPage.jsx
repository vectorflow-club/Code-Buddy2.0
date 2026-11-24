import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight, Code2, ShieldCheck } from 'lucide-react'
import { useStudent } from '../context/StudentContext'
import { googleAuthService } from '../services/authService'
import { studentAuthenticationService } from '../services/studentAuthenticationService'
import { Brand, Button, TrustNote } from '../components/ui'

export default function AuthPage({ mode }) {
  const isRegister = mode === 'register'
  const { state, refresh } = useStudent()
  const navigate = useNavigate()
  const buttonRef = useRef(null)
  const [form, setForm] = useState({ usn: '', year: '', location: '' })
  const [error, setError] = useState('')
  const [googleReady, setGoogleReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const clientId = googleAuthService.getClientId()

  const handleGoogleCredential = useCallback(async credential => {
    setError(''); setBusy(true)
    try {
      await studentAuthenticationService.signInWithGoogle(credential)
      const next = await refresh()
      if (next.auth?.mode !== 'real' || (!next.auth?.signedIn && !next.pendingIdentity)) {
        throw new Error(next.sessionExpired
          ? 'Your session expired. Sign in again to continue.'
          : 'We could not load your profile. Please try again.')
      }
      navigate(next.pendingIdentity ? '/register' : '/dashboard')
    } catch (authError) { setError(authError.message) }
    finally { setBusy(false) }
  }, [navigate, refresh])

  useEffect(() => {
    if (isRegister || !clientId || !buttonRef.current) return
    let mounted = true
    const controller = new AbortController()
    const registrationToken = Symbol('google-button-effect')
    setGoogleReady(false)
    googleAuthService.mountButton(buttonRef.current, handleGoogleCredential, { signal: controller.signal, registrationToken })
      .then(ready => { if (mounted) setGoogleReady(ready) })
      .catch(loadError => { if (mounted) setError(loadError.message) })
    return () => {
      mounted = false
      controller.abort()
      googleAuthService.clearButtonCallback(registrationToken)
    }
  }, [clientId, handleGoogleCredential, isRegister])

  if (state.auth?.signedIn) return <Navigate to="/dashboard" replace />
  if (isRegister && !state.pendingIdentity) return <Navigate to="/login" replace />

  const submitRegistration = async event => {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      const usn = form.usn.trim().toUpperCase()
      if (!/^[A-Z0-9]{8,15}$/.test(usn)) throw new Error('Enter a valid USN (8–15 letters or numbers).')
      if (!['1st Year', '2nd Year', '3rd Year', '4th Year'].includes(form.year)) throw new Error('Choose your year of study.')
      if (!['M Block Entrance', 'CCD', 'Mangaluru Canteen'].includes(form.location)) throw new Error('Choose the spot where you are playing.')

      const response = await studentAuthenticationService.register({ usn, year: form.year, location: form.location })
      if (response.student.registrationComplete !== true) {
        throw new Error('We could not finish your sign-up. Please try again.')
      }
      const next = await refresh()
      if (next.auth?.signedIn !== true || next.student?.registrationComplete !== true) {
        throw new Error(next.sessionExpired
          ? 'Your session expired. Sign in again to continue.'
          : 'We could not finish your sign-up. Please try again.')
      }
      navigate('/dashboard')
    } catch (registrationError) { setError(registrationError.message) }
    finally { setBusy(false) }
  }

  return <div className="auth-shell">
    <header className="auth-header"><Brand /><span>STUDENT PORTAL</span></header>
    <main className="auth-main">
      <section className="auth-card">
        <div className="auth-kicker"><span className="auth-icon"><Code2 size={19} /></span><span>VVCE · CODE BUDDY</span></div>
        <h1>{isRegister ? <>Your next chapter<br />starts here.</> : <>Welcome back,<br />problem solver.</>}</h1>
        <p className="auth-description">{isRegister ? 'Confirm your details to get started.' : 'Sign in with your VVCE Google account to enter the competition.'}</p>
        {!isRegister && <>
          <p className="google-heading">CONTINUE WITH GOOGLE</p>
          {clientId ? <div className={`google-button-host${googleReady ? ' google-ready' : ''}`} aria-label="Continue with Google"><div ref={buttonRef} style={{ width: '100%' }} />{!googleReady && <button type="button" className="google-fallback" onClick={() => setError('Google sign-in is loading. Please try again in a moment.')} disabled={!clientId}><span className="google-g" aria-hidden="true">G</span>Continue with Google</button>}</div> : <button type="button" className="google-fallback" onClick={() => setError('Google sign-in is not available right now. Please try again later.')}><span className="google-g" aria-hidden="true">G</span>Continue with Google</button>}
          <p className="auth-domain-note">Use a verified Google account ending in <strong>@vvce.ac.in</strong>.</p>
          {state.sessionExpired && <p className="form-error auth-alert" role="status">Your session expired. Sign in again to continue.</p>}
        </>}
        {isRegister && <form onSubmit={submitRegistration} className="auth-form registration-form" noValidate>
          <label>Full name<span className="input-wrap"><input value={state.pendingIdentity?.name || ''} readOnly aria-readonly="true" /></span><small>From your Google account. You cannot change it here.</small></label>
          <label>University seat number (USN)<span className="input-wrap"><input required autoComplete="off" value={form.usn} onChange={event => setForm({ ...form, usn: event.target.value.toUpperCase() })} placeholder="e.g. 4VV23CS051" aria-describedby={error ? 'form-error' : undefined}/></span></label>
          <label>VVCE Gmail address<span className="input-wrap"><input value={state.pendingIdentity?.email || ''} readOnly aria-readonly="true" /></span><small>From your verified account. You cannot change it here.</small></label>
          <label>Year of study<select required value={form.year} onChange={event => setForm({ ...form, year: event.target.value })}><option value="" disabled>Select your year</option>{['1st Year','2nd Year','3rd Year','4th Year'].map(year => <option key={year}>{year}</option>)}</select></label>
          <label>Event spot<select required value={form.location} onChange={event => setForm({ ...form, location: event.target.value })}><option value="" disabled>Select your spot</option>{['M Block Entrance','CCD','Mangaluru Canteen'].map(spot => <option key={spot}>{spot}</option>)}</select><small>The spot where you are playing - only its organizers will see you.</small></label>
          {error && <p id="form-error" className="form-error" role="alert">{error}</p>}
          <Button type="submit" variant="dark" className="auth-submit" disabled={busy}>{busy ? 'Saving…' : 'Finish signing up'}<ArrowRight size={17} /></Button>
        </form>}
        {!isRegister && error && <p className="form-error auth-alert" role="alert">{error}</p>}
        {!isRegister && <TrustNote>You can use everything once your college account is checked.</TrustNote>}
        {isRegister && <div className="auth-switch">Already signed up? <button type="button" onClick={async () => { await studentAuthenticationService.signOut(); await refresh(); navigate('/login') }}>Back to sign in <ArrowRight size={13}/></button></div>}
      </section>
      <aside className="auth-aside"><span className="aside-toplabel">THINK CLEAR. SOLVE WELL.</span><div className="auth-aside-art"><span>if (idea) {'{'}</span><span className="aside-code-indent">keep_thinking();</span><span>{'}'}</span><span className="aside-code-cursor" /></div><div className="auth-aside-bottom"><span>01 — 05</span><p>Big ideas begin with a<br />single line of code.</p></div></aside>
    </main>
    <footer className="auth-footer"><span>Code Buddy · VVCE</span><span><ShieldCheck size={14} /> Student access</span></footer>
  </div>
}
