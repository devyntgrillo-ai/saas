import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Plus, Trash2, Loader2, Mail, Clock } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { usePermissions, ACCESS_LABELS } from '../lib/permissions'
import { supabase } from '../lib/supabase'
import InviteModal from '../components/InviteModal'
import AgencyTabs from '../components/AgencyTabs'
import { formatDateTime } from '../lib/consults'

export default function AgencyTeam() {
  const { agency, isAgencyUser, contextLoading } = useAuth()
  const perms = usePermissions()
  const [members, setMembers] = useState([])
  const [pending, setPending] = useState([])
  const [practices, setPractices] = useState([])
  const [loading, setLoading] = useState(true)
  const [invite, setInvite] = useState(false)

  const load = useCallback(async () => {
    if (!agency?.id) return
    setLoading(true)
    const [m, p, pr] = await Promise.all([
      supabase.from('agency_members').select('id, role, accessible_practice_ids, user_id, user:users(email)').eq('agency_id', agency.id),
      supabase.from('invitations').select('*').eq('agency_id', agency.id).is('accepted_at', null).order('created_at', { ascending: false }),
      supabase.from('practices').select('id, name').eq('agency_id', agency.id).order('name'),
    ])
    setMembers(m.data || [])
    setPending(p.data || [])
    setPractices(pr.data || [])
    setLoading(false)
  }, [agency?.id])

  // Initial load + refetch whenever the agency changes.
  useEffect(() => {
    load() // eslint-disable-line react-hooks/set-state-in-effect
  }, [load])

  if (!contextLoading && !isAgencyUser) return <Navigate to="/" replace />

  async function removeMember(id) {
    setMembers((prev) => prev.filter((m) => m.id !== id))
    await supabase.from('agency_members').delete().eq('id', id)
  }
  async function cancelInvite(id) {
    setPending((prev) => prev.filter((i) => i.id !== id))
    await supabase.from('invitations').delete().eq('id', id)
  }

  return (
    <div className="space-y-6">
      <AgencyTabs />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Team</h1>
          <p className="mt-1 text-sm text-slate-400">{agency?.name} · members and their practice access.</p>
        </div>
        {perms.canManageAgency && (
          <button onClick={() => setInvite(true)} className="btn-primary"><Plus className="h-4 w-4" /> Invite member</button>
        )}
      </div>

      {loading ? (
        <div className="card py-16 text-center text-sm text-slate-500"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
      ) : (
        <>
          <div className="card overflow-hidden">
            <div className="border-b border-surface-700 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Members</div>
            {members.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">No members yet.</p>
            ) : (
              <ul className="divide-y divide-surface-700">
                {members.map((m) => {
                  const access = Array.isArray(m.accessible_practice_ids)
                    ? `${m.accessible_practice_ids.length} practice${m.accessible_practice_ids.length === 1 ? '' : 's'}`
                    : 'All practices'
                  return (
                    <li key={m.id} className="flex items-center gap-3 px-5 py-3.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-700 text-xs font-semibold text-slate-200">
                        {(m.user?.email || '?').slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-200">{m.user?.email || m.user_id}</p>
                        <p className="text-xs text-slate-500">{ACCESS_LABELS[`agency_${m.role}`] || m.role} · {access}</p>
                      </div>
                      {perms.canManageAgency && (
                        <button onClick={() => removeMember(m.id)} className="rounded-md p-2 text-slate-500 transition hover:bg-surface-800 hover:text-rose-400" title="Remove">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {pending.length > 0 && (
            <div className="card overflow-hidden">
              <div className="border-b border-surface-700 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Pending invitations</div>
              <ul className="divide-y divide-surface-700">
                {pending.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-5 py-3.5">
                    <Mail className="h-4 w-4 text-slate-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-200">{i.email}</p>
                      <p className="flex items-center gap-1 text-xs text-slate-500"><Clock className="h-3 w-3" /> Invited {formatDateTime(i.created_at)} · {ACCESS_LABELS[i.role] || i.role}</p>
                    </div>
                    {perms.canManageAgency && (
                      <button onClick={() => cancelInvite(i.id)} className="text-xs font-medium text-slate-500 hover:text-rose-300">Cancel</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {invite && (
        <InviteModal scope="agency" agencyId={agency.id} practices={practices} onClose={() => setInvite(false)} onSent={load} />
      )}
    </div>
  )
}
