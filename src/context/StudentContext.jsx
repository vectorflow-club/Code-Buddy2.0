import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { loadStudentState } from './loadStudentState'

const StudentContext = createContext(null)

export function StudentProvider({ children }) {
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const refresh = useCallback(async () => {
    setLoading(true); setLoadError(null)
    try { const next = await loadStudentState(); setState(next); return next }
    catch (error) { setLoadError(error); throw error }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { refresh().catch(() => {}) }, [refresh])
  useEffect(() => {
    const handleUnauthorized = () => { refresh().catch(() => {}) }
    window.addEventListener('code-buddy:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('code-buddy:unauthorized', handleUnauthorized)
  }, [refresh])
  return <StudentContext.Provider value={{ state, loading, loadError, refresh }}>{children}</StudentContext.Provider>
}
export function useStudent() { const context = useContext(StudentContext); if (!context) throw new Error('useStudent requires StudentProvider'); return context }
