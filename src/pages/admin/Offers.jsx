import { useEffect, useState } from 'react'
import { Tag, Plus, Copy, Check, Loader2, Ban, Link2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Super-admin → Offers: generate special-pricing / free-trial signup links.
// The code is the server-trusted source of price + trial (helcim-checkout reads
// it), so the URL price can't be tampered with. Standard $997 is the default
// when no offer is used.
const SIGNUP_BASE = 'https://get.caselift.io/signup'

// Short, unambiguous code (no easily-confused chars).
function genCode(n = 7) {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => a[x % a.length]).join('')
}

const offerLink = (code) => `${SIGNUP_BASE}?offer=${code}`

export default function Offers() {
  const { user } = useAuth()
  const [offers, setOffers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')
  const [form, setForm] = useState({ label: '', price: '997', trial_days: '0', max_uses: '', expires_at: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('signup_offers').select('*').order('created_at', { ascending: false })
    if (error) setErr(error.message)
    setOffers(data || [])
    setLoading(false)
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [])

  async function create(e) {
    e.preventDefault()
    setErr('')
    const price = Number(form.price)
    if (!(price > 0)) { setErr('Enter a valid monthly price.'); return }
    setSaving(true)
    const row = {
      code: genCode(),
      label: form.label.trim() || null,
      price,
      trial_days: Math.max(0, parseInt(form.trial_days || '0', 10) || 0),
      max_uses: form.max_uses ? Math.max(1, parseInt(form.max_uses, 10)) : null,
      expires_at: form.expires_at ? new Date(`${form.expires_at}T23:59:59`).toISOString() : null,
      created_by: user?.id ?? null,
    }
    const { error } = await supabase.from('signup_offers').insert(row)
    setSaving(false)
    if (error) { setErr(error.message || 'Could not create the offer.'); return }
    setForm({ label: '', price: '997', trial_days: '0', max_uses: '', expires_at: '' })
    await load()
  }

  async function toggleActive(o) {
    await supabase.from('signup_offers').update({ active: !o.active }).eq('id', o.id)
    await load()
  }

  function copy(code) {
    navigator.clipboard?.writeText(offerLink(code)).then(() => {
      setCopied(code); setTimeout(() => setCopied(''), 2000)
    })
  }

  function offerState(o) {
    if (!o.active) return { label: 'Disabled', cls: 'bg-slate-500/15 text-slate-300' }
    if (o.expires_at && new Date(o.expires_at) <= new Date()) return { label: 'Expired', cls: 'bg-amber-500/15 text-amber-300' }
    if (o.max_uses != null && o.uses >= o.max_uses) return { label: 'Used up', cls: 'bg-amber-500/15 text-amber-300' }
    return { label: 'Active', cls: 'bg-emerald-500/15 text-emerald-300' }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white"><Tag className="h-6 w-6 text-primary-400" /> Signup Offers</h1>
        <p className="mt-1 text-sm text-slate-400">Generate special-pricing or free-trial links for specific people. Standard pricing is $997/month; these links override it (server-side, so the price can't be tampered with).</p>
      </div>

      {/* Create */}
      <form onSubmit={create} className="card p-6">
        <h2 className="text-base font-semibold text-white">New offer link</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label className="label">Label (who it's for)</label>
            <input className="input" placeholder="e.g. Dr. Lee — founding rate" value={form.label} onChange={set('label')} />
          </div>
          <div>
            <label className="label">Price ($/month)</label>
            <input className="input" type="number" min="1" step="1" value={form.price} onChange={set('price')} />
          </div>
          <div>
            <label className="label">Free trial (days)</label>
            <input className="input" type="number" min="0" step="1" value={form.trial_days} onChange={set('trial_days')} placeholder="0" />
          </div>
          <div>
            <label className="label">Max uses (blank = ∞)</label>
            <input className="input" type="number" min="1" step="1" value={form.max_uses} onChange={set('max_uses')} placeholder="∞" />
          </div>
          <div>
            <label className="label">Expires (optional)</label>
            <input className="input" type="date" value={form.expires_at} onChange={set('expires_at')} />
          </div>
        </div>
        {err && <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{err}</p>}
        <div className="mt-4 flex items-center gap-3">
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Generate link
          </button>
          <span className="text-xs text-slate-500">{Number(form.trial_days) > 0 ? `${form.trial_days}-day free trial, then $${form.price}/mo` : `Charges $${form.price} now, then monthly`}</span>
        </div>
      </form>

      {/* List */}
      <div className="card overflow-hidden">
        <div className="border-b border-surface-700 px-6 py-3.5"><h2 className="text-base font-semibold text-white">Links</h2></div>
        {loading ? (
          <p className="px-6 py-6 text-sm text-slate-500">Loading…</p>
        ) : offers.length === 0 ? (
          <p className="px-6 py-6 text-sm text-slate-500">No offer links yet.</p>
        ) : (
          <ul className="divide-y divide-surface-700">
            {offers.map((o) => {
              const st = offerState(o)
              return (
                <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium text-slate-100">
                      {o.label || <span className="text-slate-400">Unlabeled</span>}
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                      <Link2 className="h-3.5 w-3.5" />
                      <code className="text-slate-400">{offerLink(o.code)}</code>
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-semibold text-emerald-300">${Number(o.price).toLocaleString()}/mo</p>
                    <p className="text-xs text-slate-500">
                      {o.trial_days > 0 ? `${o.trial_days}-day trial · ` : ''}
                      {o.uses}{o.max_uses != null ? `/${o.max_uses}` : ''} used
                      {o.expires_at ? ` · exp ${new Date(o.expires_at).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => copy(o.code)} className="btn-ghost text-xs">
                      {copied === o.code ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied === o.code ? 'Copied' : 'Copy link'}
                    </button>
                    <button onClick={() => toggleActive(o)} className="rounded-md p-2 text-slate-500 transition hover:bg-surface-800 hover:text-rose-300" title={o.active ? 'Disable' : 'Enable'}>
                      <Ban className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
