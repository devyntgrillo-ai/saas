import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { applyPrimaryColor, resetPrimaryColor } from '../lib/whitelabel'
import { useAuth } from './AuthContext'

// The resolved white-label theme, available app-wide via useBranding().
// Resolution order (see the branding memo below):
//   1. Super-admin (Devyn) → CaseLift in their own view; when impersonating a
//      client practice, that client's (reseller) brand applies.
//   2. The current user's reseller (their own agency, the agency of the practice
//      they belong to, or the practice they're impersonating) → reseller brand.
//   3. A reseller matched by custom domain / ?brand= slug (pre-auth marketing).
//   4. CaseLift defaults.
const DEFAULT_BRANDING = {
  brandName: 'CaseLift',
  companyName: 'CaseLift',
  logoUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  primaryColor: null, // null → the default indigo palette from index.css
  secondaryColor: null,
  accentColor: null,
  supportEmail: 'support@caselift.io',
  supportPhone: null,
  onboardingMessage: null,
  slug: null,
  isWhiteLabeled: false,
}

const DEFAULT_TITLE = 'CaseLift — We Do The Heavy Lifting'
const CACHE_KEY = 'ciq_brand'

const BrandingContext = createContext(DEFAULT_BRANDING)

// white_label_enabled is the authoritative switch (set by the reseller's Brand
// settings, backfilled by migration for legacy branded resellers). Matches the
// edge-function resolveBrand() logic so app + email branding stay in sync.
function isWhiteLabeledAgency(a) {
  return Boolean(a?.white_label_enabled && (a.company_name || a.brand_name || a.name))
}

// Map an agency_accounts row → branding shape.
function brandFromAgency(a) {
  const name = a.company_name || a.brand_name || a.name || 'CaseLift'
  return {
    brandName: name,
    companyName: name,
    logoUrl: a.logo_url || null,
    logoDarkUrl: a.logo_dark_url || null,
    faviconUrl: a.favicon_url || null,
    primaryColor: a.primary_color || null,
    secondaryColor: a.secondary_color || null,
    accentColor: a.accent_color || null,
    supportEmail: a.support_email || DEFAULT_BRANDING.supportEmail,
    supportPhone: a.support_phone || null,
    onboardingMessage: a.onboarding_message || null,
    slug: a.id || null,
    isWhiteLabeled: true,
  }
}

// Map the get_branding() RPC payload → branding shape.
function brandFromRpc(data, fallbackSlug) {
  const name = data.company_name || data.brand_name || 'CaseLift'
  return {
    brandName: name,
    companyName: name,
    logoUrl: data.logo_url || null,
    logoDarkUrl: data.logo_dark_url || null,
    faviconUrl: data.favicon_url || null,
    primaryColor: data.primary_color || null,
    secondaryColor: data.secondary_color || null,
    accentColor: data.accent_color || null,
    supportEmail: data.support_email || DEFAULT_BRANDING.supportEmail,
    supportPhone: data.support_phone || null,
    onboardingMessage: data.onboarding_message || null,
    slug: data.slug || fallbackSlug,
    isWhiteLabeled: true,
  }
}

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// Point the browser-tab favicon at a custom URL, remembering the original so we
// can restore it for the default brand.
let DEFAULT_FAVICON = null
function applyFavicon(url) {
  let link = document.querySelector("link[rel~='icon']")
  if (DEFAULT_FAVICON === null) DEFAULT_FAVICON = link ? link.getAttribute('href') : ''
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  const next = url || DEFAULT_FAVICON
  if (next) link.setAttribute('href', next)
}

// Apply the cached brand's color synchronously at module load - before React
// paints - so a returning white-label user never flashes the default palette
// while auth resolves. The full brand is reconciled once auth is ready.
;(function primeFromCache() {
  const cached = readCache()
  if (cached?.primaryColor) applyPrimaryColor(cached.primaryColor)
})()

export function BrandingProvider({ children }) {
  const { agency, activeAgency, profile, practice, isSuperAdmin, isImpersonating } = useAuth()

  const [domainBrand, setDomainBrand] = useState(null)

  // Pre-auth path: a reseller matched by custom domain or ?brand=<id>. Runs once.
  useEffect(() => {
    let active = true
    ;(async () => {
      const params = new URLSearchParams(window.location.search)
      const slug = params.get('brand') || null
      const host = window.location.hostname
      if (!slug && (host === 'localhost' || host === '127.0.0.1')) return
      try {
        const { data } = await supabase.rpc('get_branding', { p_slug: slug, p_domain: host })
        if (active && data) setDomainBrand(brandFromRpc(data, slug))
      } catch {
        /* fall back to default CaseLift branding */
      }
    })()
    return () => {
      active = false
    }
  }, [])

  // The reseller for the current viewer: their own agency, the agency a
  // super-admin is impersonating directly, the agency of the practice they're
  // impersonating, or their home practice's agency.
  // activeAgency (the reseller a super-admin is impersonating) takes precedence
  // over the super-admin's own agency membership, so branding follows the
  // impersonated reseller rather than the viewer's own agency.
  const resellerAgency = useMemo(
    () => activeAgency || agency || practice?.agency || profile?.practice?.agency || null,
    [agency, activeAgency, practice, profile]
  )

  // The effective brand, derived from auth context and any domain match. No
  // mirror state - this IS the resolved brand. A super-admin sees CaseLift in
  // their own view; when they impersonate a client practice, the client's
  // (reseller) brand applies, matching what that client actually sees.
  const branding = useMemo(() => {
    if (isSuperAdmin && !isImpersonating) return DEFAULT_BRANDING
    if (isWhiteLabeledAgency(resellerAgency)) return brandFromAgency(resellerAgency)
    if (domainBrand) return domainBrand
    return DEFAULT_BRANDING
  }, [isSuperAdmin, isImpersonating, resellerAgency, domainBrand])

  // Apply the brand to the document (primary palette, favicon, tab title) and
  // keep the session cache in sync. DOM/storage side effects only - no setState.
  useEffect(() => {
    if (branding.primaryColor) applyPrimaryColor(branding.primaryColor)
    else resetPrimaryColor()
    applyFavicon(branding.faviconUrl)
    document.title = branding.isWhiteLabeled ? branding.companyName : DEFAULT_TITLE
    try {
      if (branding.isWhiteLabeled) sessionStorage.setItem(CACHE_KEY, JSON.stringify(branding))
      else sessionStorage.removeItem(CACHE_KEY)
    } catch {
      /* sessionStorage unavailable */
    }
  }, [branding])

  // Called after a reseller saves new brand settings - drop the cache so the
  // freshly-loaded agency record re-resolves cleanly.
  const invalidateBrand = useCallback(() => {
    try {
      sessionStorage.removeItem(CACHE_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo(
    () => ({ ...branding, invalidateBrand }),
    [branding, invalidateBrand]
  )

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBranding() {
  return useContext(BrandingContext)
}
