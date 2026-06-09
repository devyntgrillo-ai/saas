import { Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePermissions } from '../lib/permissions'
import AuthLoadingScreen from './AuthLoadingScreen'
import AccessRestricted from './AccessRestricted'

// Route guard keyed off a usePermissions() flag. Unlike a redirect guard, it
// renders an Access Restricted screen in place (which logs the attempt), so the
// blocked user gets a clear message and the event is auditable.
//
// Usage:
//   <Route element={<RequirePermission perm="canViewPHI" resource="consult" />}>
//     <Route path="/consults/:id" element={<ConsultDetail />} />
//   </Route>
export default function RequirePermission({ perm, resource = 'restricted', children }) {
  const { contextLoading } = useAuth()
  const perms = usePermissions()

  if (contextLoading) return <AuthLoadingScreen />
  if (!perms[perm]) return <AccessRestricted resource={resource} reason={`missing:${perm}`} />
  return children ?? <Outlet />
}
