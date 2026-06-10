// Shared helpers for the agency referral-commission model. Single source of
// truth for commission economics across the agency dashboard, the admin
// Resellers table, the admin Commissions payout sheet, and the notification
// email, so the numbers can never drift.

// Subaccount statuses that count as "active" for commission.
const ACTIVE_STATUSES = new Set(['active', 'trial', 'trialing'])
export function isActiveSubaccount(status) {
  return ACTIVE_STATUSES.has(status)
}

// Default flat monthly commission an agency earns per ACTIVE referred practice.
// Overridable per-agency via agency_accounts.commission_rate.
export const COMMISSION_DEFAULT = 200

// Resolve an agency's monthly commission rate (per active referred practice).
export function commissionRate(agency) {
  const r = Number(agency?.commission_rate)
  return Number.isFinite(r) && r >= 0 ? r : COMMISSION_DEFAULT
}

// Monthly commission owed to an agency = rate × active referred practices.
export function commissionOwed({ rate, activeCount = 0 }) {
  return (Number(rate) || 0) * (Number(activeCount) || 0)
}

export const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`
