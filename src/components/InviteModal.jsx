import { useState } from 'react'
import { Loader2, Send, Copy, Check, UserPlus } from 'lucide-react'
import Modal from './Modal'
import { useAuth } from '../context/AuthContext'
import { usePermissions, ACCESS_LABELS } from '../lib/permissions'
import { useSendTeamInvite } from '../lib/queries'

// Invite modal usable at agency / practice scope.
export default function InviteModal({ scope, agencyId, practiceId, practices = [], onClose, onSent }) {
  const { user } = useAuth()
  const perms = usePermissions()
  const roles = perms.grantableRoles(scope)
  const sendInvite = useSendTeamInvite()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState(roles[roles.length - 1] || '')
  const [message, setMessage] = useState('')
  const [allPractices, setAllPractices] = useState(true)
  const [selected, setSelected] = useState([])
  const [error, setError] = useState('')
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [emailSent, setEmailSent] = useState(null)
  const [emailReason, setEmailReason] = useState('')

  const showPracticePicker = role === 'agency_member' && practices.length > 0

  async function send() {
    if (!email.trim() || !role) return
    setError('')
    const accessible = role === 'agency_member' && !allPractices ? selected : null
    try {
      const result = await sendInvite.mutateAsync({
        email,
        role,
        scope,
        agencyId,
        practiceId,
        accessiblePracticeIds: accessible,
        personalMessage: message,
        invitedByUserId: user.id,
      })
      setLink(result.inviteLink)
      setEmailSent(result.emailSent)
      setEmailReason(result.emailReason)
      onSent?.()
    } catch (e) {
      setError(e?.message || 'Could not send invite.')
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* noop */
    }
  }

  return (
    <Modal
      title="Invite a team member"
      onClose={onClose}
      footer={
        link ? (
          <button onClick={onClose} className="btn-primary">Done</button>
        ) : (
          <>
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={send} disabled={sendInvite.isPending || !email.trim() || !role} className="btn-primary">
              {sendInvite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send invite
            </button>
          </>
        )
      }
    >
      {link ? (
        <div className="space-y-3">
          {emailSent ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              <UserPlus className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Invitation emailed to <span className="font-semibold">{email}</span>. You can also share this link:</span>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              <UserPlus className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Invitation created for <span className="font-semibold">{email}</span>, but the email couldn’t be sent automatically
                {emailReason ? ` (${emailReason})` : ''}. Share this link directly:
              </span>
            </div>
          )}
          <div className="flex gap-2">
            <input readOnly value={link} className="input font-mono text-xs" />
            <button onClick={copy} className="btn-ghost shrink-0">
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="label">Email address</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@practice.com" />
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => (
                <option key={r} value={r}>{ACCESS_LABELS[r] || r}</option>
              ))}
            </select>
          </div>

          {showPracticePicker && (
            <div>
              <label className="label">Practice access</label>
              <label className="mb-2 flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={allPractices} onChange={(e) => setAllPractices(e.target.checked)} className="h-4 w-4 rounded border-surface-600 bg-surface-800 text-primary" />
                All practices
              </label>
              {!allPractices && (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-surface-700 bg-surface-800/50 p-2">
                  {practices.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-300 hover:bg-surface-800">
                      <input
                        type="checkbox"
                        checked={selected.includes(p.id)}
                        onChange={(e) => setSelected((prev) => (e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)))}
                        className="h-4 w-4 rounded border-surface-600 bg-surface-800 text-primary"
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="label">Personal message (optional)</label>
            <textarea className="input resize-y" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Looking forward to working with you!" />
          </div>

          {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
