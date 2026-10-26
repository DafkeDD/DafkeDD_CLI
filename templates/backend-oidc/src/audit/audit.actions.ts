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
        'login.token_reuse',
        'login.backchannel_failed'
    ],
    account: [
        'account.registered',
        'account.email_verified',
        'account.password_reset',
        'account.password_changed',
        'account.mfa_enabled',
        'account.mfa_disabled',
        'account.mfa_codes_renewed',
        'account.mfa_reset',
        'account.eid_linked',
        'account.eid_unlinked',
        'account.external_linked',
        'account.passkey_added',
        'account.passkey_removed',
        'account.consent_granted',
        'account.consent_revoked',
        'account.profile_changed',
        'account.email_change_requested',
        'account.email_changed',
        'account.vault_uploaded',
        'account.vault_password_saved',
        'account.vault_removed',
        'account.vault_retrieved',
        'account.vault_delegates_changed'
    ],
    members: [
        'members.invited',
        'members.invitation_resent',
        'members.invitation_withdrawn',
        'members.joined',
        'members.role_changed',
        'members.app_roles_changed',
        'members.disabled',
        'members.enabled',
        'members.removed',
        'members.profession_changed'
    ],
    platform: [
        'platform.tenant_created',
        'platform.tenant_suspended',
        'platform.tenant_activated',
        'platform.tenant_changed',
        'platform.superadmin_granted',
        'platform.superadmin_revoked',
        'platform.client_created',
        'platform.client_updated',
        'platform.client_secret_rotated',
        'platform.client_disabled',
        'platform.client_enabled',
        'platform.client_deleted',
        'platform.client_link_code',
        'platform.client_linked',
        'platform.client_roles_pushed'
    ],
    licences: [
        'licences.product_created',
        'licences.product_changed',
        'licences.product_deleted',
        'licences.discount_created',
        'licences.discount_switched',
        'licences.grant_added',
        'licences.grant_revoked',
        'licences.trial_started',
        'licences.trial_extended',
        'licences.trial_ended',
        'licences.seat_assigned',
        'licences.seat_unassigned',
        'licences.subscription_started',
        'licences.subscription_activated',
        'licences.subscription_seats_changed',
        'licences.subscription_canceled',
        'licences.subscription_renewed',
        'licences.subscription_past_due',
        'licences.payment_refund_needed',
        'licences.billing_details_changed'
    ],
    support: [
        'support.ticket_created',
        'support.message_added',
        'support.ticket_claimed',
        'support.ticket_closed',
        'support.ticket_reopened',
        'support.note_added',
        'support.ticket_rated'
    ],
    invoices: ['invoices.issued', 'invoices.paid', 'invoices.voided', 'invoices.checkout_started']
} as const

export type AuditCategory = keyof typeof AUDIT_ACTIONS
export type AuditAction = (typeof AUDIT_ACTIONS)[AuditCategory][number]
export const AUDIT_CATEGORIES = Object.keys(AUDIT_ACTIONS) as AuditCategory[]

/** What an event is about. */
export type AuditTargetType =
    | 'user'
    | 'tenant'
    | 'session'
    | 'invitation'
    | 'product'
    | 'discount'
    | 'grant'
    | 'subscription'
    | 'payment'
    | 'client'
    | 'ticket'
    | 'invoice'

/** Extra facts of an event: short values only, never a password, token, code or card number (undefined is left out). */
export type AuditDetails = Record<string, string | number | boolean | null | undefined>
