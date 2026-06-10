import { AlertTriangle, Info } from 'lucide-react'

/**
 * Surfaces admin data load failures or an empty database, never silent demo blending.
 */
export default function AdminStatusBanner({ data }) {
  if (!data) return null

  if (data.loadErrors?.length) {
    return (
      <div className="mb-6 flex gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
        <div>
          <p className="font-medium text-rose-100">Could not load admin data</p>
          <ul className="mt-1 list-inside list-disc text-rose-200/90">
            {data.loadErrors.map((e) => (
              <li key={e.source}>
                <span className="font-medium capitalize">{e.source}:</span> {e.message}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-rose-200/70">
            Confirm you are signed in as the platform super-admin and that admin RLS migrations are applied.
          </p>
        </div>
      </div>
    )
  }

  if (data.isEmpty) {
    return (
      <div className="mb-6 flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <div>
          <p className="font-medium">No resellers or practices yet</p>
          <p className="mt-1 text-xs text-amber-200/80">
            The database is empty. Add a reseller from the Resellers tab or wait for the first practice signup.
          </p>
        </div>
      </div>
    )
  }

  return null
}
