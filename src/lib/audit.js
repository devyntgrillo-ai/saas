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
//
// IMPORTANT: never put raw PHI (transcript text, patient names, message bodies)
// in `details`. Log identifiers and metadata only - the audit log is read by a
// broader audience (super-admin) than the underlying record.
// ============================================================================
import { supabase } from './supabase'

// Canonical action names - keep these stable; dashboards/exports key off them.
export const AUDIT = {
  // ── PHI access (phi_accessed: true) ──
  CONSULT_VIEWED: 'consult.viewed',
  TRANSCRIPT_VIEWED: 'transcript.viewed',
  PATIENT_ACCESSED: 'patient.accessed',
  CONVERSATION_VIEWED: 'conversation.viewed',
  MESSAGES_VIEWED: 'conversation.messages_viewed',
  FILE_DOWNLOADED: 'file.downloaded',
  RECORDING_ACCESSED: 'recording.accessed',
  IMPERSONATION_STARTED: 'impersonation.started',

  // ── Auth ──
  LOGIN_SUCCESS: 'auth.login_success',
  LOGIN_FAILURE: 'auth.login_failure',
  LOGOUT: 'auth.logout',
  PASSWORD_RESET_REQUESTED: 'auth.password_reset_requested',
  PASSWORD_CHANGED: 'auth.password_changed',
  MFA_ENROLLED: 'auth.mfa_enrolled',
  MFA_CHALLENGE: 'auth.mfa_challenge',

  // ── Admin ──
  IMPERSONATION_ENDED: 'impersonation.ended',
  PRACTICE_CREATED: 'practice.created',
  PRACTICE_ARCHIVED: 'practice.archived',
  USER_INVITED: 'user.invited',
  USER_ROLE_CHANGED: 'user.role_changed',
  BILLING_ACTION: 'billing.action',
  BAA_ACCEPTED: 'baa.accepted',

  // ── Access control ──
  // A lower-privileged user tried to reach restricted PHI/content. Recorded so
  // attempted access (not just successful access) is auditable per HIPAA.
  ACCESS_DENIED: 'access.denied',

  // ── Data ──
  CONSULT_CREATED: 'consult.created',
  CONSULT_DELETED: 'consult.deleted',
  SEQUENCE_STARTED: 'sequence.started',
  SEQUENCE_STOPPED: 'sequence.stopped',
  MESSAGE_SENT: 'message.sent',
}

// Actions that touch PHI - used to default phi_accessed when a caller doesn't
// pass it explicitly.
const PHI_ACTIONS = new Set([
  AUDIT.CONSULT_VIEWED,
  AUDIT.TRANSCRIPT_VIEWED,
  AUDIT.PATIENT_ACCESSED,
  AUDIT.CONVERSATION_VIEWED,
  AUDIT.MESSAGES_VIEWED,
  AUDIT.FILE_DOWNLOADED,
  AUDIT.RECORDING_ACCESSED,
  AUDIT.IMPERSONATION_STARTED,
])

/**
 * Record an audit event for the signed-in user.
 * @param {string} action - one of the AUDIT.* constants
 * @param {object} [opts]
 * @param {string}  [opts.resourceType] - consult | patient | conversation | practice | user | ...
 * @param {string}  [opts.resourceId]   - id of the accessed resource
 * @param {object}  [opts.details]      - non-PHI metadata (ids, labels, counts)
 * @param {boolean} [opts.phiAccessed]  - overrides the PHI_ACTIONS default
 * @param {string}  [opts.practiceId]   - super-admin only: attribute to a target practice
 */
export async function logAudit(
  action,
  { resourceType = null, resourceId = null, details = null, phiAccessed, practiceId = null } = {},
) {
  try {
    const { error } = await supabase.rpc('log_audit_event', {
      p_action: action,
      p_resource_type: resourceType,
      p_resource_id: resourceId != null ? String(resourceId) : null,
      p_details: details,
      p_phi_accessed: typeof phiAccessed === 'boolean' ? phiAccessed : PHI_ACTIONS.has(action),
      p_ip_address: null, // client IP is unreliable in the browser; captured server-side
      p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      p_practice_id: practiceId || null,
    })
    if (error) console.warn('[audit] failed to log event', action, error.message)
  } catch (e) {
    console.warn('[audit] failed to log event', action, e)
  }
}

/**
 * Spec-shaped convenience wrapper:
 *   auditLog(action, resourceType, details, phiAccessed)
 */
export function auditLog(action, resource = null, details = null, phiAccessed = false) {
  return logAudit(action, { resourceType: resource, details, phiAccessed })
}

/**
 * Log an auth event that may have NO active session (e.g. a failed login).
 * Routed through the `log-audit` edge function, which captures the real client
 * IP / user-agent and writes with the service-role key.
 */
export async function logAuthEvent(action, { email = null, details = null } = {}) {
  try {
    await supabase.functions.invoke('log-audit', {
      body: {
        action,
        resource_type: 'auth',
        user_email: email || null,
        details: details || null,
        phi_accessed: false,
      },
    })
  } catch (e) {
    console.warn('[audit] failed to log auth event', action, e)
  }
}

// ── Semantic convenience wrappers used across the app ──
// A blocked access attempt. resource describes what was being reached (e.g.
// 'consult', 'conversation', 'settings:billing'); details carry the reason +
// the path. phi_accessed stays false — access was denied, no PHI was shown.
export const auditAccessDenied = (resource, resourceId = null, details = null) =>
  logAudit(AUDIT.ACCESS_DENIED, { resourceType: resource, resourceId, details, phiAccessed: false })

export const auditConsultViewed = (id) =>
  logAudit(AUDIT.CONSULT_VIEWED, { resourceType: 'consult', resourceId: id })

export const auditTranscriptViewed = (id) =>
  logAudit(AUDIT.TRANSCRIPT_VIEWED, { resourceType: 'consult', resourceId: id })

export const auditPatientAccessed = (id) =>
  logAudit(AUDIT.PATIENT_ACCESSED, { resourceType: 'patient', resourceId: id })

export const auditMessageSent = (conversationId) =>
  logAudit(AUDIT.MESSAGE_SENT, { resourceType: 'conversation', resourceId: conversationId, phiAccessed: true })

export const auditConversationViewed = (id) =>
  logAudit(AUDIT.CONVERSATION_VIEWED, { resourceType: 'conversation', resourceId: id })

export const auditMessagesViewed = (id) =>
  logAudit(AUDIT.MESSAGES_VIEWED, { resourceType: 'conversation', resourceId: id })

export const auditFileDownloaded = (resourceType, id, details = null) =>
  logAudit(AUDIT.FILE_DOWNLOADED, { resourceType, resourceId: id, details, phiAccessed: true })

export const auditConsultCreated = (id, details = null) =>
  logAudit(AUDIT.CONSULT_CREATED, { resourceType: 'consult', resourceId: id, details })

export const auditConsultDeleted = (id, details = null) =>
  logAudit(AUDIT.CONSULT_DELETED, { resourceType: 'consult', resourceId: id, details })

export const auditSequenceStarted = (id, details = null) =>
  logAudit(AUDIT.SEQUENCE_STARTED, { resourceType: 'sequence', resourceId: id, details })

export const auditSequenceStopped = (id, details = null) =>
  logAudit(AUDIT.SEQUENCE_STOPPED, { resourceType: 'sequence', resourceId: id, details })

export const auditUserInvited = (email, details = null) =>
  logAudit(AUDIT.USER_INVITED, { resourceType: 'user', resourceId: email, details })

export const auditUserRoleChanged = (userId, details = null) =>
  logAudit(AUDIT.USER_ROLE_CHANGED, { resourceType: 'user', resourceId: userId, details })

export const auditPracticeArchived = (practiceId, details = null) =>
  logAudit(AUDIT.PRACTICE_ARCHIVED, { resourceType: 'practice', resourceId: practiceId, details })

export const auditPracticeCreated = (practiceId, details = null) =>
  logAudit(AUDIT.PRACTICE_CREATED, { resourceType: 'practice', resourceId: practiceId, details })

export const auditBillingAction = (action, details = null) =>
  logAudit(AUDIT.BILLING_ACTION, { resourceType: 'billing', resourceId: action, details })

// MFA lifecycle events. Routed through logAuthEvent so they carry the user's
// identity + real client IP from the edge function. Never include the TOTP
// secret, codes, or backup codes in details.
export const auditMfaEnrolled = (details = null) =>
  logAuthEvent(AUDIT.MFA_ENROLLED, { details })

export const auditMfaDisabled = (details = null) =>
  logAuthEvent(AUDIT.MFA_CHALLENGE, { details: { ...(details || {}), event: 'disabled' } })

export const auditImpersonationStarted = (targetType, targetId, details = null, practiceId = null) =>
  logAudit(AUDIT.IMPERSONATION_STARTED, { resourceType: targetType, resourceId: targetId, details, practiceId })

export const auditImpersonationEnded = (targetType, targetId, details = null, practiceId = null) =>
  logAudit(AUDIT.IMPERSONATION_ENDED, {
    resourceType: targetType,
    resourceId: targetId,
    details,
    practiceId,
    phiAccessed: false,
  })
