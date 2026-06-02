// Phone & messaging (Twilio + Mailgun) client helpers + display config.
import { supabase } from './supabase'

export const A2P_STATUS = {
  unregistered: { label: 'Not registered', dot: 'bg-slate-500', text: 'text-slate-400' },
  pending: { label: 'Registration pending', dot: 'bg-amber-400 animate-pulse', text: 'text-amber-300' },
  approved: { label: 'Approved', dot: 'bg-emerald-400', text: 'text-emerald-300' },
  failed: { label: 'Failed', dot: 'bg-rose-500', text: 'text-rose-300' },
}
export function a2pMeta(s) {
  return A2P_STATUS[s] || A2P_STATUS.unregistered
}

/** Overall SMS readiness for a practice row. */
export function smsProvisioningStatus(practice) {
  if (!practice?.twilio_phone_number) return 'no_number'
  const brand = practice.a2p_brand_status || 'unregistered'
  const campaign = practice.a2p_campaign_status || 'unregistered'
  if (brand === 'approved' && campaign === 'approved') return 'active'
  if (brand === 'failed' || campaign === 'failed') return 'failed'
  if (brand === 'pending' || campaign === 'pending') return 'pending'
  return 'number_only'
}

export const DELIVERY = {
  queued: { label: 'Queued', icon: 'Clock', cls: 'text-slate-500' },
  sent: { label: 'Sent', icon: 'Check', cls: 'text-slate-400' },
  delivered: { label: 'Delivered', icon: 'CheckCheck', cls: 'text-slate-400' },
  opened: { label: 'Opened', icon: 'CheckCheck', cls: 'text-sky-400' },
  read: { label: 'Read', icon: 'CheckCheck', cls: 'text-sky-400' },
  received: { label: 'Received', icon: 'Check', cls: 'text-slate-500' },
  failed: { label: 'Failed', icon: 'XCircle', cls: 'text-rose-400' },
}
export function deliveryMeta(s) {
  return DELIVERY[s] || DELIVERY.sent
}

export async function searchNumbers(practiceId, areaCode) {
  const { data, error } = await supabase.functions.invoke('twilio-provision', {
    body: { action: 'search-numbers', practice_id: practiceId, area_code: areaCode },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data.numbers || []
}

export async function purchaseNumber(practiceId, phoneNumber) {
  const { data, error } = await supabase.functions.invoke('twilio-provision', {
    body: { action: 'purchase-number', practice_id: practiceId, phone_number: phoneNumber },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

export async function registerA2P(practiceId, business = {}) {
  const { data, error } = await supabase.functions.invoke('twilio-a2p', {
    body: { action: 'register', practice_id: practiceId, business },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

export async function pollA2PStatus(practiceId) {
  const { data, error } = await supabase.functions.invoke('twilio-a2p', {
    body: { action: 'poll-status', practice_id: practiceId },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

export async function fetchOptOutCount(practiceId) {
  const { count, error } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('practice_id', practiceId)
    .eq('opted_out', true)
  if (error) return 0
  return count || 0
}

export async function fetchMessagingStats(practiceId) {
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const { data } = await supabase
    .from('message_logs')
    .select('direction, cost_usd, created_at')
    .eq('practice_id', practiceId)
  const rows = data || []
  const monthRows = rows.filter((r) => new Date(r.created_at) >= monthStart)
  return {
    sent: rows.filter((r) => r.direction === 'outbound').length,
    received: rows.filter((r) => r.direction === 'inbound').length,
    costMonth: monthRows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0),
  }
}
