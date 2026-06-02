// ============================================================================
// Client-side audit-logging middleware.
//
// HIPAA requires an access trail for PHI. Every read or transmission of patient
// data routes through logAudit(), which calls the tamper-resistant
// `log_audit_event` SQL function (SECURITY DEFINER) - the row is always stamped
// with the caller's own auth.uid() + practice_id server-side, so the browser
// cannot forge entries.
//
// These helpers are intentionally fire-and-forget: an audit-log failure must
// never block the user from seeing their data, but it is reported to the
// console for monitoring.
// ============================================================================
import { supabase } from './supabase'

// Canonical action names - keep these stable; dashboards/exports key off them.
export const AUDIT = {
  CONSULT_VIEWED: 'consult.viewed',
  PATIENT_ACCESSED: 'patient.accessed',
  MESSAGE_SENT: 'message.sent',
  CONVERSATION_VIEWED: 'conversation.viewed',
}

/**
 * Record an audit event.
 * @param {string} action - one of the AUDIT.* constants
 * @param {object} [opts]
 * @param {string} [opts.resourceType] - consult | patient | message | conversation
 * @param {string} [opts.resourceId]   - uuid of the accessed resource
 */
export async function logAudit(action, { resourceType = null, resourceId = null } = {}) {
  try {
    const { error } = await supabase.rpc('log_audit_event', {
      p_action: action,
      p_resource_type: resourceType,
      p_resource_id: resourceId,
      p_ip_address: null, // client IP is captured server-side (edge fn); unreliable here
    })
    if (error) console.warn('[audit] failed to log event', action, error.message)
  } catch (e) {
    console.warn('[audit] failed to log event', action, e)
  }
}

// Semantic convenience wrappers used across the app at each PHI access point.
export const auditConsultViewed = (id) =>
  logAudit(AUDIT.CONSULT_VIEWED, { resourceType: 'consult', resourceId: id })

export const auditPatientAccessed = (id) =>
  logAudit(AUDIT.PATIENT_ACCESSED, { resourceType: 'patient', resourceId: id })

export const auditMessageSent = (conversationId) =>
  logAudit(AUDIT.MESSAGE_SENT, { resourceType: 'conversation', resourceId: conversationId })

export const auditConversationViewed = (id) =>
  logAudit(AUDIT.CONVERSATION_VIEWED, { resourceType: 'conversation', resourceId: id })
