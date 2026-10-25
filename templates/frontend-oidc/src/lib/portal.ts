'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { type Answer, useBackend } from '@/lib/account'

/*
 * The data of the pages in the Pasport design: the types of the API (the contract of the backend), useApi and useData
 * to call it through /api/backend (the access token is added on the server), and useFormat for money and dates.
 */
export type Role = 'user' | 'admin'
export type Profession = 'doctor' | 'staff'

export type Profile = {
    id: string
    name: string
    firstName: string | null
    lastName: string | null
    email: string
    emailVerified: boolean
    pendingEmail: string | null
    phone: string | null
    locale: string | null
    superadmin: boolean
    eid: { linked: boolean; rrn: string | null; address: string | null }
    tenant: { id: string; name: string; slug: string; role: Role; profession: Profession } | null
}

export type Billing = {
    company: string | null
    vat: string | null
    billingAddress: string | null
    billingEmail: string | null
}

export type CatalogApp = {
    code: string
    name: string
    description: string
    short: string
    icon: string
    category: string
    features: string[]
    color: string | null
    requiresVault: boolean
    /** Customers can try the app (a demo); off: no demo to ask, new members get none. */
    demoEnabled: boolean
    priceMonthCents: number
    priceYearCents: number
    currency: string
    owned: boolean
    access: boolean
    /** The own demo (trial): until when it runs, null when there is none (or it ended). */
    trialEndsAt: string | null
    /** The app has a demo and none was asked (or given) yet: "Ask a demo" is possible. */
    trialAvailable: boolean
    seatsUsed: number
    seatsTotal: number
    launchUrl: string | null
    environment: { name: string | null; region: string | null; since: string | null } | null
}

/** The status an account chooses in the menu of its avatar (like Microsoft Teams). */
export type PresenceStatus = 'available' | 'busy' | 'dnd' | 'brb' | 'away' | 'offline'
export const PRESENCES: readonly PresenceStatus[] = ['available', 'busy', 'dnd', 'brb', 'away', 'offline']
/** The status others see: the chosen one, or ooo (out of office), away (idle) or offline. */
export type ShownPresence = PresenceStatus | 'ooo'

/** The own out-of-office reply (like Outlook); active: on, and inside its period. */
export type OutOfOffice = {
    enabled: boolean
    from: string | null
    until: string | null
    /** For colleagues (the support team). */
    internalMessage: string | null
    /** For customers, on the tickets I handle. */
    externalMessage: string | null
    active: boolean
}
/** GET /me/status. */
export type OwnPresence = { status: PresenceStatus; outOfOffice: OutOfOffice }
/** Someone who is out of office right now: until when (null: until turned off) and the message for the reader. */
export type AwayNotice = { until: string | null; message: string | null }

export type Member = {
    userId: string
    name: string
    email: string
    emailVerified: boolean
    role: Role
    status: 'active' | 'disabled'
    online: boolean
    /** The status the member chose; offline while not online (or when it appears offline). */
    presence?: ShownPresence
    lastSeenAt: string | null
    profession?: Profession
    /** Only for superadmins (/admin/tenants/:id/members): the member has its Belgian eID linked. */
    eidLinked?: boolean
}
export type Invitation = {
    id: string
    email: string
    role: Role
    invitedByName: string | null
    createdAt?: string
    expiresAt: string
    /** The apps of the invitation: the roles the member gets (null: the defaults) and whether a licence comes with it. */
    apps?: { clientId: string; roles: string[] | null; seat: boolean }[]
}

/** A role of an app, defined by its developer: a key for its code and a name per language. */
export type AppRole = { key: string; names: Record<'en' | 'nl' | 'fr' | 'de', string>; default: boolean }

/** An app of GET /tenants/current/apps: what the admins can give (roles) and invite to; the client id is its code. */
export type TenantApp = {
    clientId: string
    name: string
    url: string | null
    product: string | null
    roles: AppRole[]
}

/** A member with its roles in one app (GET /tenants/current/apps/:clientId/members); assigned false: the defaults. */
export type AppRolesMember = { userId: string; roles: string[]; assigned: boolean }

export type Discount = {
    code: string
    percentOff: number | null
    amountOffCents: number | null
    productCode: string | null
    duration: 'once' | 'repeating' | 'forever'
    durationPeriods: number | null
    maxRedemptions: number | null
    redemptions: number
    expiresAt: string | null
    active: boolean
}
export type Subscription = {
    id: string
    interval: 'month' | 'year'
    seats: number
    status: 'pending' | 'active' | 'past_due' | 'canceled'
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
    valid: boolean
    paid: boolean
    renewalCents: number | null
    discount: Discount | null
    environmentName?: string | null
    region?: string | null
}
export type Product = {
    code: string
    name: string
    description: string
    priceMonthCents: number
    priceYearCents: number
    currency: string
    active: boolean
    icon?: string
    category?: string
    short?: string
    features?: string[]
    color?: string | null
    requiresVault?: boolean
    demoEnabled?: boolean
    launchUrl?: string | null
    sort?: number
}
export type LicenseItem = {
    product: Product
    subscription: Subscription | null
    grants: { id: string; seats: number; endsAt: string | null; note: string; valid: boolean }[]
    seats: { paid: number; free: number; total: number; used: number }
    trials: { userId: string; endsAt: string; active: boolean }[]
    assignments: { userId: string; assignedAt: string; active: boolean }[]
}
export type Quote = {
    currency: string
    unitCents?: number
    firstCents: number
    renewalCents: number
    baseCents: number
    discount: Discount | null
    vatPercent?: number
    firstVatCents?: number
    firstTotalCents?: number
    renewalTotalCents?: number
}

export type Invoice = {
    id: string
    number: string
    issuedAt: string
    app: string
    productCode: string | null
    period: 'month' | 'year' | null
    amountCents: number
    vatCents: number
    totalCents: number
    status: 'open' | 'paid' | 'free'
    checkoutUrl: string | null
}

export type TicketStatus = 'open' | 'in_progress' | 'answered' | 'closed'
/** outOfOffice: only in the support team (GET admin/support-team), while that superadmin is away. */
export type Person = { id: string; name: string; outOfOffice?: AwayNotice | null }
export type Ticket = {
    id: string
    number: string
    subject: string
    tenant: { id: string; name: string }
    customer: Person
    app: string | null
    appCode: string | null
    status: TicketStatus
    priority: 'normal' | 'high'
    assignee: Person | null
    /** The out-of-office reply of the one handling the ticket, while it is on (the message for the reader). */
    assigneeOutOfOffice?: AwayNotice | null
    createdAt: string
    updatedAt: string
    lastMessage?: { role: 'customer' | 'support'; text: string } | null
    /** The score (1 to 5) and comment of the customer, after closing. */
    rating?: { score: number; comment: string | null; ratedAt: string } | null
    messages?: { id: string; from: Person | null; role: 'customer' | 'support'; text: string; createdAt: string }[]
    notes?: { id: string; from: Person | null; text: string; mentions: Person[]; createdAt: string }[]
}

export type Notification = {
    id: string
    kind: string
    params: Record<string, string | number | null>
    nav: { screen: string; id?: string } | null
    createdAt: string
    read: boolean
}

export type AdminTenant = {
    id: string
    slug: string
    name: string
    status: 'active' | 'suspended'
    provisioning: boolean
    createdAt: string
    members: number
    apps: number
    plan: string
    city: string | null
    contact: { name: string | null; email: string } | null
}

export type Kpi = { value: number; deltaPct: number; spark: number[] }
export type Stats = {
    months: string[]
    kpis: { tenants: Kpi; activeUsers: Kpi; purchasedApps: Kpi; revenueMonthCents: Kpi }
    revenueCents: number[]
    signups: number[]
    appBreakdown: { code: string; name: string; color: string | null; count: number }[]
    codes: { code: string; redemptions: number }[]
    codesRedeemedTotal: number
    codesTotal: number
}

export type VaultState = {
    allowed: boolean
    cert: null | {
        filename: string
        sizeBytes: number
        uploadedAt: string
        thumbprint: string | null
        subject: string | null
        issuer: string | null
        serial: string | null
        validUntil: string | null
        passwordSaved: boolean
    }
    apps: { code: string; name: string; icon: string; color: string | null; owned: boolean }[]
}

/* ============================ FETCHING ============================ */
export class ApiFailure extends Error {
    constructor(
        public status: number,
        message: string,
        public body: Record<string, unknown>
    ) {
        super(message)
    }
}

/** Calls the API through /api/backend and returns the body, or throws an ApiFailure with the translated message. */
export function useApi() {
    const backend = useBackend()
    return useCallback(
        async <T>(path: string, method = 'GET', body?: object): Promise<T> => {
            const answer: Answer = await backend(path, method, body)
            if (answer.status >= 400)
                throw new ApiFailure(answer.status, answer.message || String(answer.status), answer.body)
            return answer.body as T
        },
        // useBackend is a new function on every render; it only depends on the language
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    )
}

/** Loads `path` (null: nothing yet) and keeps it; `reload` fetches again, `setData` changes it locally. */
export function useData<T>(path: string | null) {
    const api = useApi()
    const [nonce, setNonce] = useState(0)
    const [result, setResult] = useState<{
        path: string | null
        key: string | null
        data: T | null
        error: ApiFailure | null
    }>({
        path: null,
        key: null,
        data: null,
        error: null
    })
    const key = path === null ? null : `${path}#${nonce}`

    useEffect(() => {
        if (path === null) return
        let active = true
        api<T>(path).then(
            data => active && setResult({ path, key, data, error: null }),
            (e: unknown) =>
                active &&
                setResult(r => ({
                    path,
                    key,
                    data: r.path === path ? r.data : null,
                    error: e instanceof ApiFailure ? e : new ApiFailure(0, String(e), {})
                }))
        )
        return () => {
            active = false
        }
    }, [api, path, key])

    const setData = useCallback(
        (next: T | null | ((previous: T | null) => T | null)) =>
            setResult(r => ({
                ...r,
                data: typeof next === 'function' ? (next as (previous: T | null) => T | null)(r.data) : next
            })),
        []
    )
    const reload = useCallback(async () => setNonce(n => n + 1), [])
    const current = result.path === path
    return {
        data: current ? result.data : null,
        setData,
        error: current ? result.error : null,
        loading: path !== null && result.key !== key,
        reload
    }
}

/* ============================ FORMATTING ============================ */
const INTL_LOCALE: Record<string, string> = { nl: 'nl-BE', fr: 'fr-BE', de: 'de-BE', en: 'en-GB' }

export function useFormat() {
    const locale = INTL_LOCALE[useLocale()] ?? 'en-GB'
    const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' })
    return {
        locale,
        /** "€ 12,00" (cents in). */
        eur: (cents: number) => money.format((cents ?? 0) / 100),
        /** "12 jan 2025". */
        date: (iso: string | null | undefined) =>
            iso ? new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
        /** "12 jan, 09:14". */
        dateTime: (iso: string | null | undefined) =>
            iso
                ? new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: 'short' }) +
                  ', ' +
                  new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
                : '—',
        /** Short month name of 'YYYY-MM'. */
        month: (ym: string) => new Date(ym + '-01T12:00:00Z').toLocaleDateString(locale, { month: 'short' }),
        number: (n: number) => n.toLocaleString(locale)
    }
}

/** Whole days from now until `iso` (negative in the past). */
export function daysUntil(iso: string) {
    return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

/** The design's slug of a practice name: "Tandartspraktijk De Vos" → "tandartspraktijk-de-vos". */
export function slugify(s: string) {
    return s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32)
}

/** The host name shown for an app environment: from its launch URL, else "<slug>.pasport.be" as in the design. */
export function environmentHost(launchUrl: string | null | undefined, slug: string) {
    if (launchUrl) {
        try {
            return new URL(launchUrl).host
        } catch {
            /* not a URL */
        }
    }
    return `${slug}.pasport.be`
}

/** Something changed in the tickets (a new one, a reply, a status): lists and counters on the page load again. */
const TICKETS_EVENT = 'pp-tickets'
export function ticketsChanged() {
    window.dispatchEvent(new Event(TICKETS_EVENT))
}
export function onTicketsChanged(handler: () => void) {
    window.addEventListener(TICKETS_EVENT, handler)
    return () => window.removeEventListener(TICKETS_EVENT, handler)
}

/** The API answered 403 oidc.EID_REQUIRED (OIDC_EID_REQUIRED, no eID linked yet): useBackend tells the shell. */
export { eidRequired, onEidRequired } from '@/lib/account'
