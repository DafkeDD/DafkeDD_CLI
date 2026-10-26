import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service.js'
import { I18nService } from 'nestjs-i18n'
import { AppException } from '../common/app.exception.js'
import { MailService } from '../mail/mail.service.js'
import { buildMail, type MailKind } from '../mail/mails.js'
import {
    type AccountTokenKind,
    type AccountTokens,
    accountTokenKey,
    openAccountToken,
    sealAccountToken
} from './account-token.js'
import { AppRolesService } from './app-roles.service.js'
import { sha256 } from './crypto.js'
import { EidService } from './eid.service.js'
import { LoginLimiter } from './login-limiter.js'
import { OIDC, OidcConfig, slugify } from './oidc.config.js'
import { hashPassword, verifyPassword } from './password.js'
import { type Invitation, OIDC_STORE, type OidcStore, type StoredUser, type TenantRole } from './store/oidc.store.js'

/** Pages of the frontend that the links in emails open. */
const PAGES: Record<AccountTokenKind, string> = {
    verify: '/verify-email',
    reset: '/reset-password',
    // A new email address is confirmed on the same page as a first one
    email: '/verify-email',
    invite: '/invite'
}

const normalize = (email: string) => email.trim().toLowerCase()

/** A fingerprint of the password hash: a reset link stops working as soon as the password changed. */
const fingerprint = (user: StoredUser) => sha256(user.passwordHash ?? 'no password').slice(0, 32)

/**
 * Accounts: registration, email verification, forgotten passwords and invitations. Answers never reveal whether an
 * email address has an account (registration, "forgot password" and "send again" always answer the same), and every
 * link in an email is an encrypted, expiring token (see account-token.ts): no table for them.
 */
@Injectable()
export class AccountService {
    constructor(
        @Inject(OIDC_STORE) private readonly store: OidcStore,
        private readonly config: OidcConfig,
        private readonly mail: MailService,
        private readonly limiter: LoginLimiter,
        private readonly i18n: I18nService,
        private readonly eid: EidService,
        private readonly audit: AuditService,
        private readonly appRoles: AppRolesService
    ) {}

    /** Called when an account joins an organisation (the licences give it a trial of every product). */
    private readonly joined: ((tenantId: string, userId: string) => Promise<void>)[] = []

    onMemberJoined(listener: (tenantId: string, userId: string) => Promise<void>) {
        this.joined.push(listener)
    }

    private async memberJoined(tenantId: string, userId: string) {
        for (const listener of this.joined) await listener(tenantId, userId)
    }

    private get key() {
        return accountTokenKey(this.config.masterKey())
    }

    private limit(ip: string, email: string) {
        if (!this.limiter.allow(['account-ip:' + ip, 'account-email:' + email]))
            throw new AppException('oidc.TOO_MANY_ATTEMPTS', HttpStatus.TOO_MANY_REQUESTS)
    }

    private link<K extends AccountTokenKind>(kind: K, data: AccountTokens[K], seconds: number) {
        const url = new URL(this.config.appUrl + PAGES[kind])
        url.searchParams.set('token', sealAccountToken(kind, data, seconds, this.key))
        return url.toString()
    }

    private async send(kind: MailKind, to: string, lang: string, values: Parameters<typeof buildMail>[3]) {
        const t = (key: string, args?: Record<string, string>) => String(this.i18n.t(key, { lang, args }))
        await this.mail.send(buildMail(t, kind, to, values))
    }

    private invalidLink(): never {
        throw new AppException('oidc.INVALID_LINK', HttpStatus.BAD_REQUEST)
    }

    // ---------------------------------------------------------------- registration

    /** A new account and a new organisation (the account is its admin). The account must verify its email first. */
    async register(
        input: {
            name: string
            email: string
            password: string
            organisation: string
            phone?: string
            locale?: string
        },
        requestLang: string,
        ip: string
    ) {
        if (this.config.registration !== 'open' || this.config.externalOnly)
            throw new AppException('oidc.REGISTRATION_CLOSED', HttpStatus.FORBIDDEN)
        // Every account must have its eID (OIDC_EID_REQUIRED): registering is only possible with it
        if (this.config.eidRequired) throw new AppException('oidc.EID_REQUIRED', HttpStatus.FORBIDDEN)
        const email = normalize(input.email)
        const lang = input.locale ?? requestLang
        this.limit(ip, email)
        const created = await this.store.register(
            {
                email,
                name: input.name.trim(),
                passwordHash: await hashPassword(input.password),
                emailVerified: false,
                locale: lang,
                phone: input.phone?.trim() || null
            },
            { name: input.organisation.trim(), slug: slugify(input.organisation) }
        )
        if (created) {
            await this.registered(created, 'password')
            await this.memberJoined(created.tenant.id, created.user.id)
            await this.sendVerification(created.user, lang)
        } else await this.tellOwner(email, lang)
        return { status: 'check-email' as const }
    }

    /** A new account with its own organisation (in the log of that organisation). */
    private async registered(created: { user: StoredUser; tenant: { id: string; name: string } }, method: string) {
        await this.audit.record('account.registered', {
            tenantId: created.tenant.id,
            actorId: created.user.id,
            target: { type: 'user', id: created.user.id },
            details: { method, organisation: created.tenant.name }
        })
    }

    /** Something an account did with itself (no organisation: superadmins and the account see it). */
    private own(
        action: 'account.email_verified' | 'account.password_reset' | 'account.eid_linked' | 'account.eid_unlinked',
        userId: string
    ) {
        return this.audit.record(action, { tenantId: null, actorId: userId, target: { type: 'user', id: userId } })
    }

    /** The address has an account already: tell its owner, not the person who filled in the form. */
    private async tellOwner(email: string, lang: string) {
        const existing = await this.store.findUserByEmail(email)
        if (existing)
            await this.send('exists', email, existing.locale ?? lang, {
                name: existing.name,
                app: this.config.appName,
                link: this.config.appUrl + '/forgot-password'
            })
    }

    /** Which ways of registering are open (for the registration page); eidRequired: only with the eID. */
    registrationOptions() {
        const eidRequired = this.config.eidRequired
        return {
            password: this.config.registration === 'open' && !this.config.externalOnly && !eidRequired,
            eid: this.config.registrationOpen && this.eid.enabled,
            eidRequired
        }
    }

    /** A challenge for registering with the eID, or for the eID of an invitation (the nonce goes to the bridge). */
    eidChallenge(ip: string) {
        this.eid.assertEnabled()
        if (!this.limiter.allow(['eid-challenge:' + ip]))
            throw new AppException('oidc.TOO_MANY_ATTEMPTS', HttpStatus.TOO_MANY_REQUESTS)
        return this.eid.challenge('register')
    }

    /**
     * A new account with the eID: the name comes from the card and the person chooses a password (the eID is read for
     * who they are; the login is the password, or the eID, and always the authenticator app after it). The email
     * address must still be verified. An eID can belong to one
     * account only (409 oidc.EID_ALREADY_LINKED); an email address that has an account gets the same answer as with
     * a password (its owner gets an email).
     */
    async registerWithEid(
        input: {
            challenge: string
            token: unknown
            email: string
            password: string
            organisation: string
            phone?: string
            locale?: string
        },
        requestLang: string,
        ip: string
    ) {
        if (!this.config.registrationOpen) throw new AppException('oidc.REGISTRATION_CLOSED', HttpStatus.FORBIDDEN)
        this.eid.assertEnabled()
        const email = normalize(input.email)
        const lang = input.locale ?? requestLang
        this.limit(ip, email)
        const nonce = this.eid.openChallenge(input.challenge, 'register')
        const person = await this.eid.verify(input.token, nonce)
        const created = await this.store.registerWithIdentifier(
            {
                email,
                name: person.name,
                passwordHash: await hashPassword(input.password),
                emailVerified: false,
                locale: lang,
                firstName: person.firstNames || null,
                lastName: person.lastName || null,
                phone: input.phone?.trim() || null
            },
            { name: input.organisation.trim(), slug: slugify(input.organisation) },
            { type: 'eid', valueHash: person.valueHash }
        )
        if (created === 'identifier-taken') throw new AppException('oidc.EID_ALREADY_LINKED', HttpStatus.CONFLICT)
        if (created) {
            await this.store.setEidDetails(created.user.id, {
                rrnEncrypted: person.rrnEncrypted,
                address: person.address
            })
            await this.registered(created, 'eid')
            await this.memberJoined(created.tenant.id, created.user.id)
            await this.sendVerification(created.user, lang)
        } else await this.tellOwner(email, lang)
        return { status: 'check-email' as const, name: person.name }
    }

    // ---------------------------------------------------------------- eID of the logged in account

    async eidStatus(userId: string) {
        const [identifier, user] = await Promise.all([
            this.store.findIdentifier(userId, 'eid'),
            this.store.findUserById(userId)
        ])
        return {
            enabled: this.eid.enabled,
            linked: Boolean(identifier),
            linkedAt: identifier?.createdAt ?? null,
            lastUsedAt: identifier?.lastUsedAt ?? null,
            // Without a password the eID is the only way to log in: it cannot be unlinked
            hasPassword: Boolean(user?.passwordHash),
            // OIDC_EID_REQUIRED: this account must have an eID linked (never a superadmin); the API refuses it otherwise
            required: this.config.eidRequired && user?.isSuperadmin !== true
        }
    }

    /**
     * Where an account goes back to after linking its eID on /security, when an app sent it there: the name of the app
     * and the address of its frontend (the origin of its first redirect URI). Only registered, active apps: never an
     * address from the browser, so this is no open redirect.
     */
    async eidBack(clientId: string) {
        const client = await this.store.findClient(clientId)
        const uri = client?.redirectUris[0]
        if (!client || !uri) throw new AppException('oidc.CLIENT_NOT_FOUND', HttpStatus.NOT_FOUND)
        return { clientId: client.clientId, name: client.name, url: new URL(uri).origin + '/' }
    }

    linkChallenge(userId: string) {
        return this.eid.challenge('link', userId)
    }

    /** Links the eID of the challenge to this account, so it can log in with it. */
    async linkEid(userId: string, input: { challenge: string; token: unknown }) {
        this.eid.assertEnabled()
        if (!this.limiter.allow(['eid-link:' + userId]))
            throw new AppException('oidc.TOO_MANY_ATTEMPTS', HttpStatus.TOO_MANY_REQUESTS)
        const nonce = this.eid.openChallenge(input.challenge, 'link', userId)
        const person = await this.eid.verify(input.token, nonce)
        const result = await this.store.linkIdentifier(userId, 'eid', person.valueHash)
        if (result === 'taken') throw new AppException('oidc.EID_ALREADY_LINKED', HttpStatus.CONFLICT)
        if (result === 'exists') throw new AppException('oidc.EID_OTHER_LINKED', HttpStatus.CONFLICT)
        await this.store.setEidDetails(userId, { rrnEncrypted: person.rrnEncrypted, address: person.address })
        await this.own('account.eid_linked', userId)
        return this.eidStatus(userId)
    }

    async unlinkEid(userId: string) {
        const user = await this.store.findUserById(userId)
        if (!user?.passwordHash) throw new AppException('oidc.EID_ONLY_LOGIN', HttpStatus.CONFLICT)
        // Every account must keep its eID (OIDC_EID_REQUIRED); a new card of the same person links without unlinking
        if (this.config.eidRequired && !user.isSuperadmin)
            throw new AppException('oidc.EID_REQUIRED', HttpStatus.FORBIDDEN)
        await this.store.unlinkIdentifier(userId, 'eid')
        // The national register number is only kept while the eID is linked
        await this.store.setEidDetails(userId, { rrnEncrypted: null, address: null })
        await this.own('account.eid_unlinked', userId)
        return this.eidStatus(userId)
    }

    private async sendVerification(user: StoredUser, lang: string) {
        await this.send('verify', user.email, user.locale ?? lang, {
            name: user.name,
            app: this.config.appName,
            link: this.link('verify', { userId: user.id, email: user.email }, OIDC.VERIFY_EMAIL_SECONDS)
        })
    }

    async resendVerification(input: { email: string }, lang: string, ip: string) {
        const email = normalize(input.email)
        this.limit(ip, email)
        const user = await this.store.findUserByEmail(email)
        if (user?.status === 'active' && !user.emailVerified) await this.sendVerification(user, lang)
        return { status: 'check-email' as const }
    }

    /**
     * Confirms an email address: the first one (the link after registering) or a new one (the link after changing it
     * on the profile; the address changes only now). 409 oidc.EMAIL_TAKEN when another account took it meanwhile.
     */
    async verifyEmail(input: { token: string }) {
        const change = openAccountToken('email', input.token, this.key)
        if (change) return this.confirmEmailChange(change)
        const data = openAccountToken('verify', input.token, this.key)
        const user = data ? await this.store.findUserById(data.userId) : null
        if (!data || !user || user.email.toLowerCase() !== data.email.toLowerCase()) this.invalidLink()
        await this.store.setEmailVerified(user.id)
        await this.own('account.email_verified', user.id)
        return { status: 'verified' as const, email: user.email }
    }

    // ---------------------------------------------------------------- a new email address

    /**
     * The account wants another email address: it changes only when the link sent to the new address is opened. The
     * same address as now withdraws a pending change. 409 oidc.EMAIL_TAKEN when another account has it.
     */
    async requestEmailChange(userId: string, newEmail: string, lang: string) {
        const user = await this.store.findUserById(userId)
        if (!user) throw new AppException('errors.NOT_FOUND', HttpStatus.NOT_FOUND)
        const email = normalize(newEmail)
        if (email === user.email.toLowerCase()) {
            await this.store.setPendingEmail(userId, null)
            return
        }
        if (!this.limiter.allow(['email-change:' + userId]))
            throw new AppException('oidc.TOO_MANY_ATTEMPTS', HttpStatus.TOO_MANY_REQUESTS)
        if (await this.store.findUserByEmail(email)) throw new AppException('oidc.EMAIL_TAKEN', HttpStatus.CONFLICT)
        await this.store.setPendingEmail(userId, email)
        await this.send('confirm', email, user.locale ?? lang, {
            name: user.name,
            app: this.config.appName,
            link: this.link('email', { userId, email }, OIDC.VERIFY_EMAIL_SECONDS)
        })
        await this.audit.record('account.email_change_requested', {
            tenantId: null,
            actorId: userId,
            target: { type: 'user', id: userId },
            details: { to: email }
        })
    }

    private async confirmEmailChange(data: { userId: string; email: string }) {
        const [user, profile] = await Promise.all([
            this.store.findUserById(data.userId),
            this.store.findProfile(data.userId)
        ])
        // Only the address that is still pending: a newer change (or a withdrawn one) makes older links invalid
        if (user?.status !== 'active' || profile?.pendingEmail?.toLowerCase() !== data.email.toLowerCase())
            this.invalidLink()
        if (!(await this.store.changeEmail(user.id, data.email)))
            throw new AppException('oidc.EMAIL_TAKEN', HttpStatus.CONFLICT)
        await this.audit.record('account.email_changed', {
            tenantId: null,
            actorId: user.id,
            target: { type: 'user', id: user.id },
            details: { from: user.email, to: data.email }
        })
        return { status: 'email-changed' as const, email: data.email }
    }

    // ---------------------------------------------------------------- forgotten password

    async forgotPassword(input: { email: string }, lang: string, ip: string) {
        const email = normalize(input.email)
        this.limit(ip, email)
        const user = await this.store.findUserByEmail(email)
        if (user?.status === 'active') {
            await this.send('reset', user.email, user.locale ?? lang, {
                name: user.name,
                app: this.config.appName,
                link: this.link(
                    'reset',
                    { userId: user.id, fingerprint: fingerprint(user) },
                    OIDC.RESET_PASSWORD_SECONDS
                )
            })
        }
        return { status: 'check-email' as const }
    }

    /** A new password. The link works once; every session of the account ends; the email address counts as verified. */
    async resetPassword(input: { token: string; password: string }) {
        const data = openAccountToken('reset', input.token, this.key)
        const user = data ? await this.store.findUserById(data.userId) : null
        if (!data || user?.status !== 'active' || fingerprint(user) !== data.fingerprint) this.invalidLink()
        await this.store.setPassword(user.id, await hashPassword(input.password))
        await this.store.setEmailVerified(user.id)
        await this.store.endUserSessions(user.id)
        await this.own('account.password_reset', user.id)
        return { status: 'password-changed' as const }
    }

    // ---------------------------------------------------------------- a new password while logged in

    /**
     * The logged in account chooses a new password. With a password it needs the one of now (403 oidc.WRONG_PASSWORD,
     * attempts are rate limited per account); without one (eID only) this sets the first. The new one must differ
     * (400 oidc.SAME_PASSWORD). Every other session of the account ends, `keepSessionId` (this one) stays. No email.
     */
    async changePassword(
        userId: string,
        input: { currentPassword?: string; newPassword: string },
        keepSessionId: string | null
    ) {
        const user = await this.store.findUserById(userId)
        if (user?.status !== 'active') throw new AppException('errors.UNAUTHORIZED', HttpStatus.UNAUTHORIZED)
        const first = !user.passwordHash
        if (user.passwordHash) {
            if (!this.limiter.allow(['password-change:' + userId]))
                throw new AppException('oidc.TOO_MANY_ATTEMPTS', HttpStatus.TOO_MANY_REQUESTS)
            const current = input.currentPassword ?? ''
            if (!current || !(await verifyPassword(current, user.passwordHash)))
                throw new AppException('oidc.WRONG_PASSWORD', HttpStatus.FORBIDDEN)
            if (input.newPassword === current) throw new AppException('oidc.SAME_PASSWORD', HttpStatus.BAD_REQUEST)
        }
        await this.store.setPassword(userId, await hashPassword(input.newPassword))
        const endedSessions = await this.store.endOtherUserSessions(userId, keepSessionId)
        await this.audit.record('account.password_changed', {
            tenantId: null,
            actorId: userId,
            target: { type: 'user', id: userId },
            details: { first, endedSessions }
        })
        return { status: 'password-changed' as const, endedSessions }
    }

    // ---------------------------------------------------------------- invitations

    /**
     * The one who creates a tenant makes themselves its admin (a superadmin on /admin with their own email): no
     * invitation to themselves, a member at once, so the next login offers the organisation.
     */
    async addSelfAsAdmin(userId: string, tenantId: string) {
        if (await this.store.findMember(tenantId, userId)) return
        await this.store.addMember(tenantId, userId, 'admin')
        await this.audit.record('members.joined', {
            tenantId,
            actorId: userId,
            target: { type: 'user', id: userId },
            details: { role: 'admin', newAccount: false }
        })
        await this.memberJoined(tenantId, userId)
    }

    /**
     * Invites someone to a tenant (or renews the open invitation for that address). `inviter` must be admin of that
     * tenant or superadmin (checked by the caller). `apps`: the apps the invitation gives access to, with the roles in
     * each app and optionally a seat; the email names them and the invitation page offers to open them.
     */
    async invite(
        inviter: { userId: string; name: string },
        tenant: { id: string; name: string },
        input: {
            email: string
            role: TenantRole
            apps?: { clientId: string; roles?: string[] | null; seat?: boolean }[]
        },
        lang: string
    ) {
        const email = normalize(input.email)
        const apps = await this.appRoles.checkInvitationApps(input.apps)
        const existing = await this.store.findUserByEmail(email)
        if (existing && (await this.store.findMember(tenant.id, existing.id)))
            throw new AppException('oidc.ALREADY_MEMBER', HttpStatus.CONFLICT)
        const invitation = await this.store.saveInvitation({
            tenantId: tenant.id,
            email,
            role: input.role,
            invitedBy: inviter.userId,
            apps,
            expiresAt: new Date(Date.now() + OIDC.INVITATION_SECONDS * 1000)
        })
        await this.sendInvitation(invitation, inviter.name, tenant.name, lang)
        await this.audit.record('members.invited', {
            tenantId: tenant.id,
            actorId: inviter.userId,
            target: { type: 'invitation', id: invitation.id },
            details: {
                email,
                role: input.role,
                ...(apps.length ? { apps: apps.map(app => app.clientId).join(',') } : {})
            }
        })
        return { status: 'invited' as const, email, id: invitation.id }
    }

    /** Sends an open invitation again, valid for 7 more days. */
    async resendInvitation(inviterName: string, tenant: { id: string; name: string }, id: string, lang: string) {
        const invitation = await this.store.renewInvitation(
            tenant.id,
            id,
            new Date(Date.now() + OIDC.INVITATION_SECONDS * 1000)
        )
        if (!invitation) throw new AppException('oidc.INVITATION_NOT_FOUND', HttpStatus.NOT_FOUND)
        await this.sendInvitation(invitation, inviterName, tenant.name, lang)
        await this.audit.record('members.invitation_resent', {
            tenantId: tenant.id,
            target: { type: 'invitation', id: invitation.id },
            details: { email: invitation.email, role: invitation.role }
        })
        return { status: 'invited' as const, email: invitation.email, id: invitation.id }
    }

    private async sendInvitation(invitation: Invitation, inviterName: string, tenantName: string, lang: string) {
        const existing = await this.store.findUserByEmail(invitation.email)
        const language = existing?.locale ?? lang
        const apps = await this.appRoles.describeInvitationApps(invitation.apps)
        await this.send('invite', invitation.email, language, {
            name: existing?.name ?? invitation.email,
            app: this.config.appName,
            tenant: tenantName,
            inviter: inviterName,
            role: String(this.i18n.t(`mail.ROLE_${invitation.role}`, { lang: language })),
            apps: apps.map(app => app.name).join(', '),
            link: this.link(
                'invite',
                {
                    tenantId: invitation.tenantId,
                    invitationId: invitation.id,
                    email: invitation.email,
                    role: invitation.role,
                    invitedBy: invitation.invitedBy ?? ''
                },
                Math.max(1, Math.floor((invitation.expiresAt.getTime() - Date.now()) / 1000))
            )
        })
    }

    /**
     * An invitation that can still be accepted: it was not withdrawn (its row exists), the tenant is active and the
     * inviter may still invite.
     */
    private async openInvitation(token: unknown) {
        const data = openAccountToken('invite', token, this.key)
        if (!data) this.invalidLink()
        const [invitation, tenant, inviter] = await Promise.all([
            this.store.findInvitation(data.tenantId, data.invitationId),
            this.store.findTenant(data.tenantId),
            this.store.findUserById(data.invitedBy)
        ])
        if (!invitation || invitation.email.toLowerCase() !== data.email.toLowerCase()) this.invalidLink()
        const allowed =
            inviter?.status === 'active' &&
            (inviter.isSuperadmin || (await this.store.findMemberRole(data.tenantId, inviter.id)) === 'admin')
        if (tenant?.status !== 'active' || !inviter || !allowed) this.invalidLink()
        return { data, tenant, inviter, invitation }
    }

    async invitation(token: unknown) {
        const { data, tenant, inviter, invitation } = await this.openInvitation(token)
        const account = await this.store.findUserByEmail(data.email)
        return {
            email: data.email,
            tenantName: tenant.name,
            role: data.role,
            inviterName: inviter.name,
            accountExists: Boolean(account),
            // A new account reads the eID first: possible (eid), or needed (eidRequired, OIDC_EID_REQUIRED)
            eid: this.eid.enabled,
            eidRequired: this.config.eidRequired,
            // The apps it gives access to: name, address, the roles that come with it, and whether a seat does
            apps: await this.appRoles.describeInvitationApps(invitation.apps)
        }
    }

    /**
     * The eID of the invitee (a new account), before the name and the password: checks the token of the bridge and
     * answers the name on the card with `eid`, the verified eID encrypted for this invitation (15 minutes), to send
     * along with POST invitation/accept. 409 oidc.EID_ALREADY_LINKED when the eID belongs to an account already.
     */
    async invitationEid(input: { invitation: string; challenge: string; token: unknown }, ip: string) {
        this.eid.assertEnabled()
        const { data } = await this.openInvitation(input.invitation)
        if (!this.limiter.allow(['eid-invite:' + ip, 'eid-invite:' + data.invitationId]))
            throw new AppException('oidc.TOO_MANY_ATTEMPTS', HttpStatus.TOO_MANY_REQUESTS)
        const nonce = this.eid.openChallenge(input.challenge, 'register')
        const person = await this.eid.verify(input.token, nonce)
        if (await this.store.findUserByIdentifier('eid', person.valueHash))
            throw new AppException('oidc.EID_ALREADY_LINKED', HttpStatus.CONFLICT)
        return {
            name: person.name,
            firstName: person.firstNames || null,
            lastName: person.lastName || null,
            eid: this.eid.sealPerson(person, 'invite:' + data.invitationId)
        }
    }

    /**
     * Accepts an invitation. With an account: it joins the tenant (the link proves the email address); one without an
     * eID links it after its next login (OIDC_EID_REQUIRED). Without one: `name` and `password` create it, already
     * verified, with the eID of POST invitation/eid linked (`eid`; needed when OIDC_EID_REQUIRED is on, else 403
     * oidc.EID_REQUIRED; 409 oidc.EID_ALREADY_LINKED when it belongs to another account).
     */
    async acceptInvitation(input: { token: string; name?: string; password?: string; eid?: string }, lang: string) {
        const { data, tenant, invitation } = await this.openInvitation(input.token)
        let user = await this.store.findUserByEmail(data.email)
        const accountExists = Boolean(user)
        if (!user) {
            if (!input.name || !input.password)
                throw new AppException('oidc.ACCOUNT_DETAILS_NEEDED', HttpStatus.BAD_REQUEST)
            if (!input.eid && this.config.eidRequired) throw new AppException('oidc.EID_REQUIRED', HttpStatus.FORBIDDEN)
            const person = input.eid ? this.eid.openPerson(input.eid, 'invite:' + data.invitationId) : null
            const account = {
                email: data.email,
                name: input.name.trim(),
                passwordHash: await hashPassword(input.password),
                emailVerified: true,
                locale: lang,
                ...(person ? { firstName: person.firstNames || null, lastName: person.lastName || null } : {})
            }
            const created = person
                ? await this.store.createUserWithIdentifier(account, { type: 'eid', valueHash: person.valueHash })
                : await this.store.createUser(account)
            if (created === 'identifier-taken') throw new AppException('oidc.EID_ALREADY_LINKED', HttpStatus.CONFLICT)
            if (!created) throw new AppException('errors.CONFLICT', HttpStatus.CONFLICT)
            user = created
            if (person) {
                await this.store.setEidDetails(user.id, { rrnEncrypted: person.rrnEncrypted, address: person.address })
                await this.own('account.eid_linked', user.id)
            }
        } else {
            if (user.status !== 'active') this.invalidLink()
            await this.store.setEmailVerified(user.id)
        }
        await this.store.addMember(tenant.id, user.id, data.role)
        await this.audit.record('members.joined', {
            tenantId: tenant.id,
            actorId: user.id,
            target: { type: 'user', id: user.id },
            details: { role: data.role, newAccount: !accountExists }
        })
        await this.memberJoined(tenant.id, user.id)
        // The apps of the invitation: their roles and seats (a demo never starts by itself)
        const apps = await this.appRoles.giveInvitationApps(tenant.id, user.id, invitation.invitedBy, invitation.apps)
        await this.store.deleteInvitation(tenant.id, data.invitationId)
        return { status: 'accepted' as const, tenantName: tenant.name, accountExists, apps }
    }
}
