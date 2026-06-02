import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadAdminData, logImpersonation } from '../lib/admin'
import { useAuth } from './AuthContext'

const AdminContext = createContext(null)

// Loads the admin dataset once and shares it across all admin pages, with a
// refresh hook and impersonation helpers that reuse the app's practice-view
// context.
export function AdminProvider({ children }) {
  const { user, viewPractice } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const d = await loadAdminData()
    setData(d)
    setLoading(false)
    return d
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh()
  }, [refresh])

  // Impersonate a specific practice: switch the main app's practice context and
  // jump to its dashboard. Real (non-demo) practices only.
  const impersonatePractice = useCallback(
    (practice) => {
      if (!practice?.id || String(practice.id).startsWith('demo-')) {
        navigate('/')
        return
      }
      logImpersonation({ actorId: user?.id, targetType: 'practice', targetId: practice.id, targetName: practice.name })
      viewPractice(practice.id)
      navigate('/')
    },
    [user, viewPractice, navigate],
  )

  // Impersonate an agency: view its first practice (the app has no standalone
  // agency-impersonation context, so we land inside one of its practices).
  const impersonateAgency = useCallback(
    (agency) => {
      const first = data?.practices.find((p) => p.agency_id === agency?.id && !String(p.id).startsWith('demo-'))
      logImpersonation({ actorId: user?.id, targetType: 'agency', targetId: agency?.id, targetName: agency?.name })
      if (first) {
        viewPractice(first.id)
        navigate('/')
      } else {
        navigate('/')
      }
    },
    [data, user, viewPractice, navigate],
  )

  return (
    <AdminContext.Provider value={{ data, loading, refresh, impersonatePractice, impersonateAgency }}>
      {children}
    </AdminContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAdmin() {
  const ctx = useContext(AdminContext)
  if (!ctx) throw new Error('useAdmin must be used within AdminProvider')
  return ctx
}
