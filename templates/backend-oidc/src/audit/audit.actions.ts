/**
 * Every action the audit log records, by category. The frontend has a text for each one in every language (checked by
 * the tests of the CLI). Add one here when you record something new.
 */
export const AUDIT_ACTIONS = {
    login: [
        'login.succeeded',
        'login.failed',
        'login.mfa_failed',
        'login.logout',
        'login.session_ended',
        'login.sessions_ended',
        'login.token_reuse'
    ],
    account: [
        'account.registered',
        'account.email_verified',
        'account.password_reset',
        'account.mfa_enabled',
        'account.mfa_disabled',
        'account.mfa_codes_renewed',
        'account.mfa_reset',
        'account.eid_linked',
        'account.eid_unlinked',
        'account.external_linked',
        'account.passkey_added',
        'account.passkey_removed'
    ],
    members: [
        'members.invited',
        'members.invitation_resent',
        'members.invitation_withdrawn',
        'members.joined',
        'members.role_changed',
        'members.disabled',
        'members.enabled',
        'members.removed'
    ],
    platform: [
        'platform.tenant_created',
        'platform.tenant_suspended',
        'platform.tenant_activated',
        'platform.superadmin_granted',
        'platform.superadmin_revoked'
    ],
    licences: [
        'licences.product_created',
        'licences.product_changed',
        'licences.discount_created',
        'licences.discount_switched',
        'licences.grant_added',
        'licences.grant_revoked',
        'licences.trial_started',
        'licences.trial_extended',
        'licences.seat_assigned',
        'licences.seat_unassigned',
        'licences.subscription_started',
        'licences.subscription_activated',
        'licences.subscription_seats_changed',
        'licences.subscription_canceled',
        'licences.subscription_renewed',
        'licences.subscription_past_due',
        'licences.payment_refund_needed'
    ]
} as const

export type AuditCategory = keyof typeof AUDIT_ACTIONS
export type AuditAction = (typeof AUDIT_ACTIONS)[AuditCategory][number]
export const AUDIT_CATEGORIES = Object.keys(AUDIT_ACTIONS) as AuditCategory[]

/** What an event is about. */
export type AuditTargetType =
    'user' | 'tenant' | 'session' | 'invitation' | 'product' | 'discount' | 'grant' | 'subscription' | 'payment'

/** Extra facts of an event: short values only, never a password, token, code or card number (undefined is left out). */
export type AuditDetails = Record<string, string | number | boolean | null | undefined>
