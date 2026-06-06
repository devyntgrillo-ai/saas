import { createContext, useCallback, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { logImpersonation } from '../lib/admin'
import { useAdminData } from '../lib/queries'
import { useAuth } from './AuthContext'

const AdminContext = createContext(null)

export function AdminProvider({ children }) {
  const { user, viewPractice, viewAgency } = useAuth()
  const navigate = useNavigate()
  const { data = null, isLoading: loading, refetch } = useAdminData()

  const refresh = useCallback(async () => {
    const r = await refetch()
    return r.data
  }, [refetch])

  const impersonatePractice = useCallback(
    (practice) => {
      if (!practice?.id) return
      logImpersonation({ actorId: user?.id, targetType: 'practice', targetId: practice.id, targetName: practice.name })
      viewPractice(practice.id)
      navigate('/')
    },
    [user, viewPractice, navigate],
  )

  // Reseller-level impersonation: view the reseller's OWN dashboard (/agency)
  // scoped + branded as them — not a jump into one of their practices.
  const impersonateAgency = useCallback(
    (agency) => {
      if (!agency?.id) return
      logImpersonation({ actorId: user?.id, targetType: 'agency', targetId: agency.id, targetName: agency.name })
      viewAgency(agency.id)
      navigate('/agency')
    },
    [user, viewAgency, navigate],
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
