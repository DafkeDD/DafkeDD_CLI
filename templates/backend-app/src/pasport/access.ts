import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common'

/** Who calls: read from the access token of the login server (nothing is looked up). */
export interface Caller {
    /** The id of the account at the login server. */
    sub: string
    /** The organisation (tenant) the user logged in with, and the role there. Null: no organisation. */
    tenant: { id: string; name: string; role: 'user' | 'admin' } | null
    superadmin: boolean
    /** The session at the login server. */
    sid: string | null
    /** The app the token was issued to. */
    clientId: string
}

/**
 * Who may call a route (the guard checks every route):
 * - `public`: everyone, without a token
 * - `account`: any valid token, also without an organisation
 * - `member` (the default): a valid token with an organisation
 * - `admin`: the beheerder of that organisation (or a superadmin)
 */
export type AccessLevel = 'public' | 'account' | 'member' | 'admin'
export const ACCESS_KEY = 'pasport:access'
export const Access = (level: AccessLevel) => SetMetadata(ACCESS_KEY, level)
export const Public = () => Access('public')

/** The caller of this request (set by PasportGuard). */
export const CurrentCaller = createParamDecorator(
    (_data: unknown, context: ExecutionContext): Caller =>
        context.switchToHttp().getRequest<{ caller: Caller }>().caller
)
