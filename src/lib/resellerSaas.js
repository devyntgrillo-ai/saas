// Shared helpers + constants for Reseller SaaS mode (the GoHighLevel-style
// configurator). One source of truth so the reseller configurator, the admin
// overview, and the billing function all agree on the economics.

// What Hope AI charges a reseller per active subaccount, per month.
export const WHOLESALE_PRICE = 297
// Floor on what a reseller may charge their clients, so they always clear at
// least $100/mo over our wholesale. Enforced in the UI and by a DB CHECK.
export const MIN_CLIENT_PRICE = 397
// Annual plans get 10% off (2 months effectively) when the reseller enables it.
export const ANNUAL_DISCOUNT = 0.1
// Max trial length a reseller can offer their clients.
export const MAX_TRIAL_DAYS = 30

// Subaccount statuses that count as "active" for revenue / wholesale billing.
// Matches ACTIVE_STATUSES in the bill-resellers edge function.
const ACTIVE_STATUSES = new Set(['active', 'trial', 'trialing'])
export function isActiveSubaccount(status) {
  return ACTIVE_STATUSES.has(status)
}

// Turn a company name into a URL-safe slug: "Northwest Implant Group" →
// "northwest-implant-group". Trimmed to a sane length.
export function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

// A slug is valid if it's lowercase alphanumerics + hyphens, 3-40 chars.
export function isValidSlug(slug) {
  return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(String(slug || ''))
}

// Per-client and aggregate economics for a reseller.
export function economics({ clientPrice, activeCount = 0 }) {
  const price = Number(clientPrice) || 0
  const perClientMargin = price - WHOLESALE_PRICE
  const gross = price * activeCount
  const wholesale = WHOLESALE_PRICE * activeCount
  return {
    perClientMargin,
    gross, // what the reseller collects from clients
    wholesale, // what Hope AI bills the reseller
    margin: gross - wholesale, // the reseller's take
  }
}

// Annual price (with the 10% discount) for a given monthly price.
export function annualPrice(monthly) {
  return Math.round(Number(monthly || 0) * 12 * (1 - ANNUAL_DISCOUNT))
}

export const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`
