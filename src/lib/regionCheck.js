// ============================================================================
// Supabase region verification (HIPAA data-residency).
//
// HIPAA does not strictly mandate US-only hosting, but CaseLift's policy is to
// keep all PHI in a US region. This module confirms, at app startup, that the
// project is pinned to a US region and surfaces the region for the admin
// dashboard / dev console.
//
// IMPORTANT: a Supabase *cloud* project URL is `https://<project-ref>.supabase.co`
// — the ref is opaque and does NOT encode the region. So the URL alone cannot
// prove the region. The authoritative source is the dashboard
// (Project Settings → General → Region), recorded here via VITE_SUPABASE_REGION.
// This check validates that recorded value and, for self-hosted/region-style
// hostnames, will also parse a region out of the URL when present.
// ============================================================================

// Supabase runs on AWS; these are the US regions.
const US_REGIONS = new Set(['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2'])

const REGION_LABELS = {
  'us-east-1': 'US East (N. Virginia)',
  'us-east-2': 'US East (Ohio)',
  'us-west-1': 'US West (N. California)',
  'us-west-2': 'US West (Oregon)',
}

/**
 * Resolve the configured region from env, falling back to anything parseable
 * from the URL host (covers self-hosted / region-prefixed hostnames).
 * @returns {{ region: string|null, source: 'env'|'url'|'unknown' }}
 */
export function resolveSupabaseRegion(url = import.meta.env.VITE_SUPABASE_URL) {
  const envRegion = (import.meta.env.VITE_SUPABASE_REGION || '').trim().toLowerCase()
  if (envRegion) return { region: envRegion, source: 'env' }

  // Cloud URLs (<ref>.supabase.co) carry no region; only region-style hosts do.
  const match = String(url || '').match(/\b(us|eu|ap|sa|ca)-[a-z]+-\d\b/i)
  if (match) return { region: match[0].toLowerCase(), source: 'url' }

  return { region: null, source: 'unknown' }
}

/**
 * Confirm the Supabase project is in a US region. Logs in dev; warns loudly if
 * the region is non-US or cannot be determined. Returns a structured result so
 * an admin dashboard panel can render it.
 * @returns {{ region: string|null, label: string, isUS: boolean, source: string }}
 */
export function verifySupabaseRegion(url = import.meta.env.VITE_SUPABASE_URL) {
  const { region, source } = resolveSupabaseRegion(url)
  const isUS = Boolean(region && US_REGIONS.has(region))
  const label = (region && REGION_LABELS[region]) || region || 'unknown'
  const result = { region, label, isUS, source }

  const isDev = Boolean(import.meta.env?.DEV)

  if (!region) {
    // Can't confirm from the URL (expected for cloud URLs). Tell the dev how.
    console.warn(
      '[CaseLift] Supabase region: UNKNOWN — cloud project URLs do not encode the region. ' +
        'Set VITE_SUPABASE_REGION to the value shown in the Supabase dashboard ' +
        '(Project Settings → General → Region), e.g. "us-west-2", to enable the data-residency check.',
    )
    return result
  }

  if (!isUS) {
    // Non-US region is a compliance problem — always warn, in every environment.
    console.warn(
      `[CaseLift] ⚠️ Supabase region: ${label} (${region}) is NOT a US region. ` +
        'PHI data-residency policy requires a US region — verify the project in the Supabase dashboard.',
    )
    return result
  }

  if (isDev) {
    console.info(`[CaseLift] Supabase region: ${label} (${region}) — US ✓ [source: ${source}]`)
  }
  return result
}
