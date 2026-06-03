// Shared constants + helpers for the practice referral program.

export const REFERRAL_AMOUNT = 250 // USD per active referral, per month
export const MIN_PAYOUT = 250

// The public referral link. Always points at the public marketing domain so the
// copied link is shareable regardless of which app host generated it.
export function referralLink(code) {
  if (!code) return ''
  return `https://caselift.io/r/${code}`
}

// Pre-written, editable share email. `link` is interpolated into the body.
export const EMAIL_SUBJECT =
  "This AI is recovering our implant cases, thought you'd want to see it"

export function emailBody(link) {
  return (
    "Hey, we've been using CaseLift to follow up with implant patients who " +
    "didn't commit at their consult. It has been recovering cases we thought " +
    `were lost. Here is a link to check it out: ${link}. No pressure, just ` +
    'thought it was worth sharing.'
  )
}

// Status → badge styling for the referral history table.
export function referralStatusMeta(status) {
  switch (status) {
    case 'active':
      return { label: 'Active', classes: 'bg-emerald-500/15 text-emerald-300' }
    case 'trial':
      return { label: 'Trial', classes: 'bg-amber-500/15 text-amber-300' }
    case 'cancelled':
    case 'canceled':
    case 'expired':
      return { label: 'Cancelled', classes: 'bg-slate-500/15 text-slate-400' }
    case 'paused':
      return { label: 'Paused', classes: 'bg-[var(--bg-subtle)] text-[var(--text-muted)]' }
    case 'past_due':
    case 'unpaid':
      return { label: 'Past due', classes: 'bg-rose-500/15 text-rose-300' }
    default:
      return { label: 'Trial', classes: 'bg-amber-500/15 text-amber-300' }
  }
}
