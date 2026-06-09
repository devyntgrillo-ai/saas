import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, UserCog, Ban, Eye, Check, Plus, Loader2, Mail } from 'lucide-react'
import Modal from '../../components/Modal'
import { useAdmin } from '../../context/AdminContext'
import { agencyStatusMeta } from '../../lib/admin'
import { statusMeta as subStatusMeta } from '../../lib/billing'
import { timeAgo } from '../../lib/consults'
import {
  useToggleAgencySuspended,
  useResendAgencyOwnerInvite,
  useAssignReferredPractice,
  useUpdateAgencyAdminNotes,
} from '../../lib/queries'
import { StatCard, Table, Badge, Avatar, money, stop } from '../../components/admin/ui'

export default function AgencyDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data, refresh, impersonateAgency, impersonatePractice } = useAdmin()
  const toggleSuspendMutation = useToggleAgencySuspended()
  const resendInviteMutation = useResendAgencyOwnerInvite()
  const [confirmSuspend, setConfirmSuspend] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [inviteNotice, setInviteNotice] = useState('')

  const agency = data.agencies.find((a) => String(a.id) === String(id))
  if (!agency) {
    return (
      <div className="card px-6 py-16 text-center">
        <p className="text-sm text-slate-400">Reseller not found.</p>
        <button onClick={() => navigate('/admin/agencies')} className="btn-ghost mt-4">Back to resellers</button>
      </div>
    )
  }

  const practices = data.practices.filter((p) => p.agency_id === agency.id)
  const consultsMonth = practices.reduce((s, p) => s + (p.consults_month || 0), 0)
  const recovered = practices.reduce((s, p) => s + (p.recovered || 0), 0)
  const meta = agencyStatusMeta(agency.status)

  function resendOwnerInvite() {
    if (!agency.owner_email || resendInviteMutation.isPending) return
    setInviteLink('')
    setInviteNotice('')
    resendInviteMutation.mutate(
      { agencyId: agency.id, ownerEmail: agency.owner_email },
      {
        onSuccess: async (data) => {
          await refresh()
          if (data.emailSent) setInviteNotice(`Invite email sent to ${agency.owner_email}.`)
          else if (data.inviteLink) {
            setInviteLink(data.inviteLink)
            setInviteNotice('Email could not be sent. Copy the invite link below and share it with the owner.')
          } else setInviteNotice('Invite processed, but no confirmation was returned.')
        },
        onError: (e) => setInviteNotice(e.message || 'Could not send invite.'),
      },
    )
  }

  function suspend() {
    if (String(agency.id).startsWith('demo-')) {
      setConfirmSuspend(false)
      return
    }
    toggleSuspendMutation.mutate(
      { agencyId: agency.id, currentlySuspended: agency.status === 'suspended' },
      { onSuccess: async () => { await refresh(); setConfirmSuspend(false) } },
    )
  }

  const suspending = toggleSuspendMutation.isPending
  const resendingInvite = resendInviteMutation.isPending

  return (
    <div className="space-y-8">
      <button onClick={() => navigate('/admin/agencies')} className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" /> All resellers
      </button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar name={agency.name} color={agency.white_label?.primary_color} />
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold text-white">{agency.name}</h1>
              <Badge className={meta.classes}>{meta.label}</Badge>
            </div>
            <p className="text-sm text-slate-500">
              {agency.owner_email || 'No owner email'} · Joined {new Date(agency.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {agency.owner_email && (
            <button
              onClick={resendOwnerInvite}
              disabled={resendingInvite}
              className="btn-ghost text-slate-200"
              title="Send setup email to reseller owner"
            >
              {resendingInvite ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Resend owner invite
            </button>
          )}
          <button onClick={() => setAssigning(true)} className="btn-primary">
            <Plus className="h-4 w-4" /> Assign a practice
          </button>
          <button onClick={() => impersonateAgency(agency)} className="btn-ghost text-primary-300">
            <UserCog className="h-4 w-4" /> Impersonate
          </button>
          <button onClick={() => setConfirmSuspend(true)} className="btn-ghost text-rose-300">
            <Ban className="h-4 w-4" /> {agency.status === 'suspended' ? 'Reactivate' : 'Suspend'}
          </button>
        </div>
      </div>

      {(inviteNotice || inviteLink) && (
        <div className={`rounded-lg border px-3 py-2.5 text-sm ${inviteLink ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
          <p>{inviteNotice}</p>
          {inviteLink && (
            <div className="mt-2 flex gap-2">
              <input className="input flex-1 text-xs" readOnly value={inviteLink} />
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(inviteLink)}
                className="btn-ghost shrink-0 text-xs"
              >
                Copy
              </button>
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Commission / mo" value={money(agency.commissionOwed)} accent="text-emerald-300" />
        <StatCard label="Commission rate" value={`${money(agency.commission_rate)}/practice`} />
        <StatCard label="Active referred" value={practices.filter((p) => p.subscription_status === 'active').length} />
        <StatCard label="Consults (mo)" value={consultsMonth} />
        <StatCard label="Recovered (mo)" value={money(recovered)} accent="text-emerald-300" />
      </div>

      {/* Practices */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-white">Practices</h2>
        <Table
          head={['Practice', 'Doctor', 'Location', 'Subscription', 'Consults/mo', 'Recovered', '']}
          rows={practices.map((p) => [
            <span className="font-medium text-slate-100">{p.name}</span>,
            p.doctor ? `Dr. ${p.doctor}` : '-',
            p.location || '-',
            <Badge className={subStatusMeta(p.subscription_status).classes}>{subStatusMeta(p.subscription_status).label}</Badge>,
            p.consults_month,
            money(p.recovered),
            <div className="flex items-center gap-1.5" onClick={stop}>
              <button onClick={() => navigate(`/admin/practices/${p.id}`)} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-slate-300 transition hover:bg-surface-700" title="View"><Eye className="h-3.5 w-3.5" /></button>
              <button onClick={() => impersonatePractice(p)} className="rounded-md border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-primary-300 transition hover:bg-surface-700">Impersonate</button>
            </div>,
          ])}
          empty="No practices under this reseller yet."
          onRowClick={(i) => navigate(`/admin/practices/${practices[i].id}`)}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <WhiteLabelCard wl={agency.white_label} />
        <InternalNotes agency={agency} onSaved={refresh} />
      </div>

      {assigning && (
        <AssignPracticeModal
          agency={agency}
          practices={data.practices}
          onClose={() => setAssigning(false)}
          onSaved={() => { setAssigning(false); refresh() }}
        />
      )}

      {confirmSuspend && (
        <Modal title={agency.status === 'suspended' ? 'Reactivate reseller?' : 'Suspend reseller?'} onClose={() => setConfirmSuspend(false)} footer={
          <>
            <button onClick={() => setConfirmSuspend(false)} className="btn-ghost">Cancel</button>
            <button onClick={suspend} disabled={suspending} className="btn-primary inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-70">
              {suspending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {agency.status === 'suspended' ? 'Reactivate' : 'Suspend'}
            </button>
          </>
        }>
          <p className="text-sm text-slate-300">
            {agency.status === 'suspended'
              ? `Reactivate ${agency.name}? Their practices regain full access.`
              : `Suspend ${agency.name}? Their ${practices.length} practice(s) will lose access until reactivated.`}
          </p>
        </Modal>
      )}
    </div>
  )
}

// Provision a practice under this agency: sets practices.agency_id (commission
// attribution + co-brand inheritance) and fires the commission email, both via
// the assign-referred-practice edge function.
function AssignPracticeModal({ agency, practices, onClose, onSaved }) {
  const assignMutation = useAssignReferredPractice()
  const available = (practices || []).filter((p) => !p.agency_id && !p.archived_at)
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')

  function save() {
    if (!selected || assignMutation.isPending) return
    setError('')
    assignMutation.mutate(
      { practiceId: selected, agencyId: agency.id },
      {
        onSuccess: () => onSaved(),
        onError: (e) => setError(e.message || 'Could not assign the practice.'),
      },
    )
  }

  const busy = assignMutation.isPending

  return (
    <Modal
      title={`Assign a practice — ${agency.name}`}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={busy || !selected} className="btn-primary">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Assign &amp; notify
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-400">
          Attributes the practice to {agency.name} and emails the owner that {money(agency.commission_rate)}/mo
          was added to their payouts. The practice keeps billing CaseLift $997 directly.
        </p>
        {available.length === 0 ? (
          <p className="rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-slate-400">
            No unassigned practices available. Every practice is already under an agency.
          </p>
        ) : (
          <div>
            <label className="label">Practice</label>
            <select className="input" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Select a practice…</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
        {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
      </div>
    </Modal>
  )
}

function WhiteLabelCard({ wl }) {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-white">White label</h2>
      {!wl ? (
        <p className="mt-3 text-sm text-slate-500">Not white-labeled - uses default CaseLift branding.</p>
      ) : (
        <dl className="mt-3 space-y-2.5 text-sm">
          <Row label="Brand name" value={wl.brand_name} />
          <Row label="Primary color" value={
            <span className="inline-flex items-center gap-2">
              <span className="h-4 w-4 rounded ring-1 ring-white/10" style={{ background: wl.primary_color }} />
              <span className="font-mono text-xs">{wl.primary_color}</span>
            </span>
          } />
          <Row label="Custom domain" value={wl.custom_domain || '-'} />
          <Row label="Support email" value={wl.support_email || '-'} />
        </dl>
      )}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-200">{value}</dd>
    </div>
  )
}

// Auto-saving internal notes (super-admin only).
function InternalNotes({ agency, onSaved }) {
  const updateNotesMutation = useUpdateAgencyAdminNotes()
  const [value, setValue] = useState(agency.notes || '')
  const [savedAt, setSavedAt] = useState(null)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  function onChange(e) {
    setValue(e.target.value)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (String(agency.id).startsWith('demo-')) {
        setSavedAt(new Date())
        onSaved?.()
        return
      }
      updateNotesMutation.mutate(
        { agencyId: agency.id, notes: e.target.value },
        {
          onSuccess: () => {
            setSavedAt(new Date())
            onSaved?.()
          },
        },
      )
    }, 900)
  }

  const saving = updateNotesMutation.isPending

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Internal notes</h2>
        <span className="text-xs text-slate-500">
          {saving ? 'Saving…' : savedAt ? <span className="inline-flex items-center gap-1 text-emerald-300"><Check className="h-3 w-3" /> Saved {timeAgo(savedAt.toISOString())}</span> : 'Admin only'}
        </span>
      </div>
      <textarea
        value={value}
        onChange={onChange}
        placeholder="Private notes about this reseller - auto-saves."
        className="input mt-3 min-h-[120px]"
      />
    </div>
  )
}

