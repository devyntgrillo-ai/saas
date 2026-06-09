import { useMemo, useState } from 'react'
import { Users, Search, Loader2, Plus, Shield, Send, Copy, Check, UserMinus, Pencil } from 'lucide-react'
import Modal from '../../components/Modal'
import { useAdmin } from '../../context/AdminContext'
import { useAdminUsers } from '../../lib/queries'
import { supabase } from '../../lib/supabase'
import { StatCard, Table, Badge, stop } from '../../components/admin/ui'

const SUPER_ADMIN_EMAIL = 'devyntgrillo@gmail.com'

// Derive a user's effective access + display from their row.
function classify(u) {
  const lvl = u.access_level || ''
  if (lvl === 'super_admin' || (u.email || '').toLowerCase() === SUPER_ADMIN_EMAIL) {
    return { kind: 'super_admin', label: 'Super Admin', cls: 'bg-rose-500/15 text-rose-300', scope: 'Platform' }
  }
  if (lvl.startsWith('agency_') || (u.agencies && u.agencies.length)) {
    const mem = u.agencies?.[0]
    const role = mem?.role || lvl.split('_')[1] || 'owner'
    return { kind: 'reseller', label: `Reseller ${role}`, cls: 'bg-indigo-500/15 text-indigo-300', scope: mem?.agency?.name || 'Reseller' }
  }
  if (u.practice_id || lvl.startsWith('practice_')) {
    const role = lvl.startsWith('practice_') ? lvl.split('_')[1] : u.role || 'member'
    return { kind: 'practice', label: `Practice ${role}`, cls: 'bg-sky-500/15 text-sky-300', scope: u.practice?.name || '—' }
  }
  return { kind: 'none', label: 'No access', cls: 'bg-slate-500/15 text-slate-400', scope: '—' }
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'super_admin', label: 'Super admins' },
  { key: 'reseller', label: 'Resellers' },
  { key: 'practice', label: 'Practice users' },
  { key: 'none', label: 'No access' },
]

export default function AdminTeam() {
  const { data: ctx } = useAdmin()
  const { data: users, isLoading, refetch } = useAdminUsers()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState(null) // user object, or 'new'
  const [busyId, setBusyId] = useState(null)
  const [flash, setFlash] = useState('')

  const agencies = ctx?.agencies || []
  const practices = ctx?.practices || []
  const list = users || []

  function note(msg) {
    setFlash(msg)
    setTimeout(() => setFlash(''), 6000)
  }

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase()
    return list
      .map((u) => ({ u, meta: classify(u) }))
      .filter(({ u, meta }) => {
        if (filter !== 'all' && meta.kind !== filter) return false
        if (query && !(u.email || '').toLowerCase().includes(query) && !(meta.scope || '').toLowerCase().includes(query)) return false
        return true
      })
  }, [list, q, filter])

  const summary = useMemo(() => {
    const c = { super_admin: 0, reseller: 0, practice: 0 }
    for (const u of list) {
      const k = classify(u).kind
      if (c[k] != null) c[k] += 1
    }
    return c
  }, [list])

  async function removeUser(u) {
    if (!confirm(`Remove access for ${u.email}? They lose all access (account is kept, not deleted) and can be re-granted later.`)) return
    setBusyId(u.id)
    try {
      const { data, error } = await supabase.functions.invoke('admin-users', { body: { action: 'remove', user_id: u.id, mode: 'revoke' } })
      if (error) throw new Error(data?.error || error.message)
      note(`Access removed for ${u.email}.`)
      await refetch()
    } catch (e) {
      note(e?.message || 'Could not remove access.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Users</h1>
          <p className="text-sm text-slate-500">{list.length} users across all subaccounts &amp; resellers</p>
        </div>
        <button onClick={() => setEditing('new')} className="btn-primary"><Plus className="h-4 w-4" /> Add user</button>
      </div>

      {flash && <p className="rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-slate-300">{flash}</p>}

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Super admins" value={summary.super_admin} icon={Shield} accent="text-rose-300" />
        <StatCard label="Resellers" value={summary.reseller} icon={Users} />
        <StatCard label="Practice users" value={summary.practice} icon={Users} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email or subaccount/reseller..." className="input pl-9" />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} className={`rounded-lg px-3 py-2 text-sm font-medium transition ${filter === f.key ? 'bg-primary/10 text-primary-300' : 'text-slate-400 hover:text-slate-200'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="card flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
      ) : (
        <Table
          head={['User', 'Access', 'Scope', 'Joined', '']}
          rows={rows.map(({ u, meta }) => {
            const busy = busyId === u.id
            return [
              <div className="leading-tight">
                <div className="font-medium text-slate-100">{u.display_name || u.email}</div>
                <div className="text-xs text-slate-500">
                  {u.job_title ? `${u.job_title}${u.display_name ? ` · ${u.email}` : ''}` : u.display_name ? u.email : ''}
                </div>
              </div>,
              <Badge className={meta.cls}>{meta.label}</Badge>,
              <span className="text-slate-300">{meta.scope}</span>,
              u.created_at ? new Date(u.created_at).toLocaleDateString() : '-',
              <div className="flex items-center gap-1.5" onClick={stop}>
                <button onClick={() => setEditing(u)} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-slate-300 transition hover:bg-surface-700" title="Edit access"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => removeUser(u)} disabled={busy} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-rose-300 transition hover:bg-surface-700 disabled:opacity-40" title="Remove access">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserMinus className="h-3.5 w-3.5" />}
                </button>
              </div>,
            ]
          })}
          empty="No users match your filters."
          icon={Users}
        />
      )}

      {editing && (
        <UserAccessModal
          existing={editing === 'new' ? null : editing}
          agencies={agencies}
          practices={practices}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); note(msg); refetch() }}
        />
      )}
    </div>
  )
}

function UserAccessModal({ existing, agencies, practices, onClose, onSaved }) {
  const isEdit = Boolean(existing)
  const initial = isEdit ? classify(existing) : { kind: 'practice' }
  const [email, setEmail] = useState(existing?.email || '')
  const [access, setAccess] = useState(initial.kind === 'none' ? 'practice' : initial.kind === 'super_admin' ? 'super_admin' : initial.kind)
  const [role, setRole] = useState(
    initial.kind === 'reseller'
      ? existing?.agencies?.[0]?.role || 'owner'
      : initial.kind === 'practice'
      ? (existing?.access_level?.split('_')[1] || existing?.role || 'member')
      : 'owner',
  )
  const [agencyId, setAgencyId] = useState(existing?.agencies?.[0]?.agency?.id || agencies[0]?.id || '')
  const [practiceId, setPracticeId] = useState(existing?.practice?.id || practices[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)

  async function save() {
    setError('')
    if (!isEdit && !email.trim()) return setError('Email is required.')
    if (access === 'reseller' && !agencyId) return setError('Select a reseller.')
    if (access === 'practice' && !practiceId) return setError('Select a subaccount.')
    setBusy(true)
    try {
      const payload = isEdit
        ? { action: 'set_access', user_id: existing.id, access, role, agency_id: access === 'reseller' ? agencyId : null, practice_id: access === 'practice' ? practiceId : null }
        : { action: 'invite', email: email.trim().toLowerCase(), access, role, agency_id: access === 'reseller' ? agencyId : null, practice_id: access === 'practice' ? practiceId : null, app_origin: window.location.origin }
      const { data, error: e } = await supabase.functions.invoke('admin-users', { body: payload })
      if (e) throw new Error(data?.error || e.message)
      if (!isEdit && data?.invite_link && !data?.email_sent) {
        setLink(data.invite_link) // show copyable link if email didn't go out
        setBusy(false)
        return
      }
      onSaved(isEdit ? `Updated access for ${existing.email}.` : `Invite sent to ${email}.`)
    } catch (e) {
      setError(e?.message || 'Something went wrong.')
      setBusy(false)
    }
  }

  const roleOptions = access === 'reseller'
    ? [['owner', 'Owner'], ['admin', 'Admin']]
    : access === 'practice'
    ? [['owner', 'Admin'], ['member', 'Member'], ['viewer', 'Viewer']]
    : []

  return (
    <Modal
      title={isEdit ? `Edit access — ${existing.email}` : 'Add user'}
      onClose={onClose}
      footer={link ? (
        <button onClick={onClose} className="btn-primary">Done</button>
      ) : (
        <>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {isEdit ? 'Save access' : 'Send invite'}
          </button>
        </>
      )}
    >
      {link ? (
        <div className="space-y-3">
          <p className="text-sm text-emerald-200">User created. Email couldn’t be sent automatically — share this sign-in link:</p>
          <div className="flex gap-2">
            <input readOnly value={link} className="input font-mono text-xs" />
            <button onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000) }} className="btn-ghost shrink-0">
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {!isEdit && (
            <div>
              <label className="label">Email address</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@company.com" />
            </div>
          )}
          <div>
            <label className="label">Access level</label>
            <select className="input" value={access} onChange={(e) => setAccess(e.target.value)}>
              <option value="super_admin">Super Admin (full platform access)</option>
              <option value="reseller">Reseller (agency)</option>
              <option value="practice">Practice / subaccount user</option>
            </select>
          </div>

          {access === 'reseller' && (
            <div>
              <label className="label">Reseller</label>
              <select className="input" value={agencyId} onChange={(e) => setAgencyId(e.target.value)}>
                {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
          {access === 'practice' && (
            <div>
              <label className="label">Subaccount</label>
              <select className="input" value={practiceId} onChange={(e) => setPracticeId(e.target.value)}>
                {practices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          {roleOptions.length > 0 && (
            <div>
              <label className="label">Role</label>
              <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
                {roleOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          )}

          {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
