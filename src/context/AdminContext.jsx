import { createContext, useCallback, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAdminData } from '../lib/queries'
import { useAuth } from './AuthContext'

const AdminContext = createContext(null)

export function AdminProvider({ children }) {
  const { viewPractice, viewAgency } = useAuth()
  const navigate = useNavigate()
  const { data = null, isLoading: loading, refetch } = useAdminData()

  const refresh = useCallback(async () => {
    const r = await refetch()
    return r.data
  }, [refetch])

  // Impersonation is audited inside viewPractice / viewAgency (AuthContext), which
  // also covers the agency-dashboard and account-switcher entry points.
  const impersonatePractice = useCallback(
    (practice) => {
      if (!practice?.id) return
      viewPractice(practice.id)
      navigate('/')
    },
    [viewPractice, navigate],
  )

  // Reseller-level impersonation: view the reseller's OWN dashboard (/agency)
  // scoped + branded as them, not a jump into one of their practices.
  const impersonateAgency = useCallback(
    (agency) => {
      if (!agency?.id) return
      viewAgency(agency.id)
      navigate('/agency')
    },
    [viewAgency, navigate],
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
