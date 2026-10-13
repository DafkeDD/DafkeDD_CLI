import { HttpStatus, Inject, Injectable } from '@nestjs/common'
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
import { sha256 } from './crypto.js'
import { LoginLimiter } from './login-limiter.js'
import { OIDC, OidcConfig, slugify } from './oidc.config.js'
import { hashPassword } from './password.js'
import { OIDC_STORE, type OidcStore, type StoredUser, type TenantRole } from './store/oidc.store.js'

/** Pages of the frontend that the links in emails open. */
const PAGES: Record<AccountTokenKind, string> = {
    verify: '/verify-email',
    reset: '/reset-password',
    invite: '/invite'
}

const normalize = (email: string) => email.trim().toLowerCase()

/** A fingerprint of the password hash: a reset link stops working as soon as the password changed. */
const fingerprint = (user: StoredUser) => sha256(user.passwordHash).slice(0, 32)

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
        private readonly i18n: I18nService
    ) {}

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
        input: { name: string; email: string; password: string; organisation: string },
        lang: string,
        ip: string
    ) {
        if (!this.config.registrationOpen) throw new AppException('oidc.REGISTRATION_CLOSED', HttpStatus.FORBIDDEN)
        const email = normalize(input.email)
        this.limit(ip, email)
        const created = await this.store.register(
            {
                email,
                name: input.name.trim(),
                passwordHash: await hashPassword(input.password),
                emailVerified: false,
                locale: lang
            },
            { name: input.organisation.trim(), slug: slugify(input.organisation) }
        )
        if (created) {
            await this.sendVerification(created.user, lang)
        } else {
            // The address has an account already: tell its owner, not the person who filled in the form
            const existing = await this.store.findUserByEmail(email)
            if (existing)
                await this.send('exists', email, existing.locale ?? lang, {
                    name: existing.name,
                    app: this.config.appName,
                    link: this.config.appUrl + '/forgot-password'
                })
        }
        return { status: 'check-email' as const }
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

    async verifyEmail(input: { token: string }) {
        const data = openAccountToken('verify', input.token, this.key)
        const user = data ? await this.store.findUserById(data.userId) : null
        if (!data || !user || user.email.toLowerCase() !== data.email.toLowerCase()) this.invalidLink()
        await this.store.setEmailVerified(user.id)
        return { status: 'verified' as const, email: user.email }
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
        return { status: 'password-changed' as const }
    }

    // ---------------------------------------------------------------- invitations

    /** Sends an invitation for a tenant. `inviter` must be admin of that tenant or superadmin (checked by the caller). */
    async invite(
        inviter: { userId: string; name: string },
        tenant: { id: string; name: string },
        input: { email: string; role: TenantRole },
        lang: string
    ) {
        const email = normalize(input.email)
        const existing = await this.store.findUserByEmail(email)
        if (existing && (await this.store.findMemberRole(tenant.id, existing.id)))
            throw new AppException('oidc.ALREADY_MEMBER', HttpStatus.CONFLICT)
        await this.send('invite', email, existing?.locale ?? lang, {
            name: existing?.name ?? email,
            app: this.config.appName,
            tenant: tenant.name,
            inviter: inviter.name,
            role: String(this.i18n.t(`mail.ROLE_${input.role}`, { lang: existing?.locale ?? lang })),
            link: this.link(
                'invite',
                { tenantId: tenant.id, email, role: input.role, invitedBy: inviter.userId },
                OIDC.INVITATION_SECONDS
            )
        })
        return { status: 'invited' as const, email }
    }

    /** An invitation that can still be accepted: the tenant is active and the inviter may still invite. */
    private async openInvitation(token: unknown) {
        const data = openAccountToken('invite', token, this.key)
        if (!data) this.invalidLink()
        const [tenant, inviter] = await Promise.all([
            this.store.findTenant(data.tenantId),
            this.store.findUserById(data.invitedBy)
        ])
        const allowed =
            inviter?.status === 'active' &&
            (inviter.isSuperadmin || (await this.store.findMemberRole(data.tenantId, inviter.id)) === 'admin')
        if (tenant?.status !== 'active' || !inviter || !allowed) this.invalidLink()
        return { data, tenant, inviter }
    }

    async invitation(token: unknown) {
        const { data, tenant, inviter } = await this.openInvitation(token)
        const account = await this.store.findUserByEmail(data.email)
        return {
            email: data.email,
            tenantName: tenant.name,
            role: data.role,
            inviterName: inviter.name,
            accountExists: Boolean(account)
        }
    }

    /**
     * Accepts an invitation. With an account: it joins the tenant (the link proves the email address). Without one:
     * `name` and `password` create it, already verified.
     */
    async acceptInvitation(input: { token: string; name?: string; password?: string }, lang: string) {
        const { data, tenant } = await this.openInvitation(input.token)
        let user = await this.store.findUserByEmail(data.email)
        const accountExists = Boolean(user)
        if (!user) {
            if (!input.name || !input.password)
                throw new AppException('oidc.ACCOUNT_DETAILS_NEEDED', HttpStatus.BAD_REQUEST)
            user = await this.store.createUser({
                email: data.email,
                name: input.name.trim(),
                passwordHash: await hashPassword(input.password),
                emailVerified: true,
                locale: lang
            })
            if (!user) throw new AppException('errors.CONFLICT', HttpStatus.CONFLICT)
        } else {
            if (user.status !== 'active') this.invalidLink()
            await this.store.setEmailVerified(user.id)
        }
        await this.store.addMember(tenant.id, user.id, data.role)
        return { status: 'accepted' as const, tenantName: tenant.name, accountExists }
    }
}
