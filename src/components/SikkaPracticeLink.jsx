import { useState } from 'react'
import { Building2, Loader2, Search, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react'
import { lookupSikkaRegistration, linkSikkaRegistration } from '../lib/pms'

/**
 * Practice enters their Master Customer ID (SPU → Settings → Account Details),
 * registration queue, they confirm, then discovery runs via PmsSyncApproval.
 */
export default function SikkaPracticeLink({ practiceId, onLinked }) {
  const [officeId, setOfficeId] = useState('')
  const [registration, setRegistration] = useState(null)
  const [searching, setSearching] = useState(false)
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState(null)

  async function handleSearch(e) {
    e?.preventDefault()
    const id = officeId.trim()
    if (!id || !practiceId) return
    setSearching(true)
    setError(null)
    setRegistration(null)
    try {
      const reg = await lookupSikkaRegistration(practiceId, id)
      setRegistration(reg)
    } catch (err) {
      setError(err.message || 'Lookup failed')
    } finally {
      setSearching(false)
    }
  }

  async function handleLink() {
    if (!registration || !practiceId) return
    setLinking(true)
    setError(null)
    try {
      await linkSikkaRegistration(practiceId, registration.sikka_practice_id)
      await onLinked?.()
    } catch (err) {
      setError(err.message || 'Link failed')
    } finally {
      setLinking(false)
    }
  }

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Link your Sikka practice</h3>
        <p className="mt-1 text-xs text-slate-400 leading-relaxed">
          Once you&apos;ve registered on the{' '}
          <a
            href="https://www.sikkasoft.com/CaseLift"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-300 hover:text-primary-200 underline underline-offset-2"
          >
            Sikka marketplace
          </a>
          , installed the SPU, and completed your first sync, open <strong className="text-slate-300">Settings → Account Details</strong> in the SPU
          and enter your <strong className="text-slate-300">Master Customer ID</strong> below
          (for example <span className="font-mono text-slate-300">D56103</span>).
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex flex-wrap gap-2">
        <input
          type="text"
          className="input min-w-[12rem] flex-1 font-mono uppercase"
          placeholder="Master Customer ID (e.g. D56103)"
          value={officeId}
          onChange={(e) => setOfficeId(e.target.value.toUpperCase())}
          disabled={searching || linking}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={searching || linking || !officeId.trim()} className="btn-primary">
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Find my practice
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300 flex gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {registration && (
        <div className="rounded-xl border border-surface-700 bg-surface-900/60 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-400">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-white">{registration.practice_name || 'Sikka practice'}</p>
              <p className="font-mono text-xs text-slate-500">{registration.sikka_practice_id}</p>
              {registration.npi && <p className="mt-1 text-xs text-slate-400">NPI {registration.npi}</p>}
              {registration.address && <p className="text-xs text-slate-500">{registration.address}</p>}
              {registration.pms_type && (
                <p className="mt-1 text-xs text-slate-400">PMS: {registration.pms_type.replace(/_/g, ' ')}</p>
              )}
            </div>
          </div>
          <p className="text-xs text-slate-500">Is this your practice? Confirm to start consult sync setup.</p>
          <button type="button" onClick={handleLink} disabled={linking} className="btn-primary w-full sm:w-auto">
            {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Yes, connect this practice
            {!linking && <ArrowRight className="h-4 w-4" />}
          </button>
        </div>
      )}
    </div>
  )
}
