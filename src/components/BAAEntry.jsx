import { useLayoutEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { baaReturnFromLocation, takeBaaReturnPath } from '../lib/baaReturn'
import AuthLoadingScreen from './AuthLoadingScreen'
import BAA from '../pages/BAA'

function resolveReturnPath(location) {
  return takeBaaReturnPath() || baaReturnFromLocation(location.state) || '/'
}

// Gate /baa so the agreement UI never paints before auth + BAA status are known.
export default function BAAEntry() {
  const { contextLoading, profileResolved, baaAccepted } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const ready = !contextLoading && profileResolved

  useLayoutEffect(() => {
    if (!ready || !baaAccepted) return
    navigate(resolveReturnPath(location), { replace: true })
  }, [ready, baaAccepted, navigate, location])

  if (!ready) {
    return <AuthLoadingScreen />
  }

  if (baaAccepted) {
    return <AuthLoadingScreen />
  }

  return <BAA />
}
