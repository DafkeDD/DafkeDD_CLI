'use client'

import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import {
    BUTTON,
    Heading,
    INPUT,
    LINK,
    LoginButton,
    Notice,
    OUTLINE,
    SECONDARY,
    WIDE_CARD
} from '@/components/account-ui'
import { type Answer, useBackend } from '@/lib/account'

type Interval = 'month' | 'year'
type Product = {
    code: string
    name: string
    description: string
    priceMonthCents: number
    priceYearCents: number
    currency: string
    active: boolean
}
type Discount = {
    code: string
    percentOff: number | null
    amountOffCents: number | null
    duration: 'once' | 'repeating' | 'forever'
    durationPeriods: number | null
}
type Subscription = {
    id: string
    interval: Interval
    seats: number
    status: 'pending' | 'active' | 'past_due' | 'canceled'
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
    valid: boolean
    paid: boolean
    renewalCents: number | null
    discount: Discount | null
}
type Item = {
    product: Product
    subscription: Subscription | null
    grants: { id: string; seats: number; endsAt: string | null; note: string; valid: boolean }[]
    seats: { paid: number; free: number; total: number; used: number }
    trials: { userId: string; endsAt: string; active: boolean }[]
    assignments: { userId: string; assignedAt: string; active: boolean }[]
}
type Member = { userId: string; name: string; email: string; status: 'active' | 'disabled' }
type Quote = {
    currency: string
    firstCents: number
    renewalCents: number
    baseCents: number
    discount: Discount | null
}

const SELECT =
    'h-11 rounded-xl border border-black/15 bg-transparent px-3 text-sm outline-none focus:border-[var(--accent,#6366f1)] dark:border-white/20 dark:[color-scheme:dark]'
const BADGE = 'rounded-full px-2 py-0.5 text-xs font-semibold'
const DANGER = OUTLINE + ' border-red-500 text-red-600 dark:text-red-400'

/** The checkout of the payment provider (Mollie): a full page load to another site. */
const goTo = (url: string) => window.location.assign(url)

/**
 * /licenses: the licences of the organisation, for its admins. Per product: buy seats (per month or per year, with a
 * discount code), more or fewer seats, cancel, and give seats to members or take them back. Every new member first gets
 * a trial. A superadmin (who opened this organisation) can also give free seats and extend trials.
 */
export function Licenses({ superadmin, tenantId }: { superadmin: boolean; tenantId: string }) {
    const t = useTranslations('Licenses')
    const backend = useBackend()
    const [items, setItems] = useState<Item[] | null>(null)
    const [members, setMembers] = useState<Member[]>([])
    const [problem, setProblem] = useState<'session' | 'access' | null>(null)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [busy, setBusy] = useState(false)

    const fetchAll = () => Promise.all([backend('tenants/current/licenses'), backend('tenants/current/members')])

    function show([list, people]: Answer[]) {
        if (list?.status === 401) return setProblem('session')
        if (list?.status === 403) return setProblem('access')
        if (list?.status !== 200) return setError(list?.message || t('offline'))
        setItems(list.body as unknown as Item[])
        if (people?.status === 200)
            setMembers((people.body as unknown as Member[]).filter(member => member.status === 'active'))
    }

    useEffect(() => {
        fetchAll()
            .then(show)
            .catch(() => setError(t('offline')))
        // once when the page opens
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    /** Calls the API; follows a checkout when it answers one; shows the result and loads everything again. */
    async function act(path: string, method: string, body: object | undefined, success: string) {
        setBusy(true)
        setError('')
        setNotice('')
        try {
            const result = await backend(path, method, body)
            if (result.status === 401) setProblem('session')
            else if (result.status >= 400) setError(result.message || t('offline'))
            else if (typeof result.body.checkoutUrl === 'string') return goTo(result.body.checkoutUrl)
            else setNotice(success)
            show(await fetchAll())
        } catch {
            setError(t('offline'))
        }
        setBusy(false)
    }

    if (problem === 'session')
        return (
            <section className={WIDE_CARD}>
                <Notice tone='error'>{t('sessionExpired')}</Notice>
                <LoginButton label={t('signIn')} returnTo='/licenses' />
            </section>
        )
    if (problem === 'access')
        return (
            <section className={WIDE_CARD}>
                <Notice tone='error'>{t('noAccess')}</Notice>
            </section>
        )

    return (
        <div className='flex w-full max-w-3xl flex-col gap-6'>
            <section className={WIDE_CARD}>
                <Heading title={t('title')} text={t('intro')} />
                {error && <Notice tone='error'>{error}</Notice>}
                {notice && <Notice tone='success'>{notice}</Notice>}
                {!items && <p className='text-sm opacity-70'>{t('busy')}</p>}
                {items?.length === 0 && <p className='text-sm opacity-70'>{t('noProducts')}</p>}
            </section>
            {items?.map(item => (
                <ProductCard
                    key={item.product.code}
                    item={item}
                    members={members}
                    busy={busy}
                    superadmin={superadmin}
                    tenantId={tenantId}
                    act={act}
                    setError={setError}
                />
            ))}
        </div>
    )
}

function ProductCard({
    item,
    members,
    busy,
    superadmin,
    tenantId,
    act,
    setError
}: {
    item: Item
    members: Member[]
    busy: boolean
    superadmin: boolean
    tenantId: string
    act: (path: string, method: string, body: object | undefined, success: string) => Promise<void>
    setError: (message: string) => void
}) {
    const t = useTranslations('Licenses')
    const format = useFormatter()
    const backend = useBackend()
    const { product, subscription, seats } = item
    const [interval, setInterval] = useState<Interval>('year')
    const [quote, setQuote] = useState<Quote | null>(null)
    const [confirm, setConfirm] = useState(false)
    const money = (cents: number) => format.number(cents / 100, { style: 'currency', currency: product.currency })
    const date = (value: string) => format.dateTime(new Date(value), { dateStyle: 'medium' })
    const saving = Math.round((1 - product.priceYearCents / (product.priceMonthCents * 12)) * 100)
    const base = `tenants/current/licenses`
    const paid = subscription?.valid && subscription.paid

    /** Buys, or with `check` only asks the price (with the discount code). */
    function purchase(form: HTMLFormElement, check: boolean) {
        const values = Object.fromEntries(new FormData(form))
        const body = {
            productCode: product.code,
            interval,
            seats: Number(values.seats),
            ...(String(values.discountCode ?? '').trim() ? { discountCode: String(values.discountCode).trim() } : {})
        }
        if (!check) return void act(`${base}/subscriptions`, 'POST', body, t('bought'))
        void backend(`${base}/quote`, 'POST', body)
            .then(result => {
                if (result.status === 200) setQuote(result.body as unknown as Quote)
                else {
                    setQuote(null)
                    setError(result.message)
                }
            })
            .catch(() => setError(t('offline')))
    }

    function changeSeats(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const value = Number(new FormData(event.currentTarget).get('seats'))
        void act(`${base}/subscriptions/${product.code}`, 'PATCH', { seats: value }, t('seatsChanged'))
    }

    function grant(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        const values = Object.fromEntries(new FormData(form))
        void act(
            `admin/tenants/${tenantId}/grants`,
            'POST',
            {
                productCode: product.code,
                seats: Number(values.seats),
                ...(values.endsAt ? { endsAt: new Date(String(values.endsAt)).toISOString() } : {}),
                ...(values.note ? { note: String(values.note) } : {})
            },
            t('granted')
        ).then(() => form.reset())
    }

    const status = (() => {
        if (!subscription) return null
        if (!subscription.valid) return subscription.status === 'pending' ? t('statusPending') : t('statusEnded')
        if (subscription.currentPeriodEnd === null) return t('statusFreeForever')
        const until = date(subscription.currentPeriodEnd)
        if (!subscription.paid) return t('statusFreeUntil', { date: until })
        if (subscription.cancelAtPeriodEnd) return t('statusCanceled', { date: until })
        if (subscription.status === 'past_due') return t('statusPastDue', { date: until })
        return t('statusRenews', { date: until, amount: money(subscription.renewalCents ?? 0) })
    })()

    return (
        <section className={WIDE_CARD}>
            <div className='flex flex-wrap items-start justify-between gap-3'>
                <div className='flex flex-col gap-1'>
                    <h2 className='text-xl font-bold tracking-tight'>
                        {product.name}
                        {!product.active && (
                            <span className={BADGE + ' ml-2 bg-black/10 dark:bg-white/10'}>{t('notSold')}</span>
                        )}
                    </h2>
                    {product.description && <p className='text-sm opacity-80'>{product.description}</p>}
                    <p className='text-sm opacity-70'>
                        {t('prices', { month: money(product.priceMonthCents), year: money(product.priceYearCents) })}
                        {saving > 0 && (
                            <span className={BADGE + ' ml-2 bg-green-600/10 text-green-700 dark:text-green-400'}>
                                {t('yearSaving', { percent: saving })}
                            </span>
                        )}
                    </p>
                </div>
                <div className='ml-auto text-right text-sm'>
                    <div className='text-2xl font-bold'>
                        {seats.used}/{seats.total}
                    </div>
                    <div className='text-xs opacity-70'>{t('seatsInUse', { paid: seats.paid, free: seats.free })}</div>
                </div>
            </div>

            {status && (
                <div className='flex flex-wrap items-center gap-2 text-sm'>
                    <span className={subscription?.valid ? 'font-semibold' : 'opacity-70'}>
                        {subscription?.interval === 'year' ? t('yearly') : t('monthly')} · {status}
                    </span>
                    {subscription?.discount && (
                        <span className={BADGE + ' bg-[var(--accent,#6366f1)]/10'}>
                            {t('discountApplied', { code: subscription.discount.code })}
                        </span>
                    )}
                </div>
            )}

            {product.active && !subscription?.valid && (
                <form
                    onSubmit={event => {
                        event.preventDefault()
                        purchase(event.currentTarget, false)
                    }}
                    className='flex flex-col gap-3 border-t border-black/10 pt-4 dark:border-white/10'
                >
                    <h3 className='text-base font-semibold'>{t('buyTitle')}</h3>
                    <div className='flex flex-wrap gap-2.5'>
                        <select
                            aria-label={t('interval')}
                            value={interval}
                            onChange={event => {
                                setInterval(event.target.value as Interval)
                                setQuote(null)
                            }}
                            className={SELECT}
                        >
                            <option value='year'>{t('perYear', { price: money(product.priceYearCents) })}</option>
                            <option value='month'>{t('perMonth', { price: money(product.priceMonthCents) })}</option>
                        </select>
                        <input
                            name='seats'
                            type='number'
                            min={1}
                            max={10000}
                            defaultValue={Math.max(1, seats.used - seats.free)}
                            required
                            aria-label={t('seats')}
                            className={INPUT + ' w-28'}
                            onChange={() => setQuote(null)}
                        />
                        <input
                            name='discountCode'
                            placeholder={t('discountCode')}
                            aria-label={t('discountCode')}
                            maxLength={40}
                            className={INPUT + ' w-44 uppercase'}
                            onChange={() => setQuote(null)}
                        />
                    </div>
                    {quote && (
                        <div className='text-sm'>
                            {quote.firstCents === 0
                                ? t('quoteFree')
                                : t('quote', { first: money(quote.firstCents), renewal: money(quote.renewalCents) })}
                        </div>
                    )}
                    <div className='flex flex-wrap gap-2.5'>
                        <button
                            type='button'
                            disabled={busy}
                            className={OUTLINE}
                            onClick={event => {
                                const form = event.currentTarget.form
                                if (form) purchase(form, true)
                            }}
                        >
                            {t('calculate')}
                        </button>
                        <button type='submit' disabled={busy} className={BUTTON}>
                            {t('buy')}
                        </button>
                    </div>
                    <p className='text-xs opacity-70'>{t('buyHint')}</p>
                </form>
            )}

            {paid && !subscription.cancelAtPeriodEnd && (
                <div className='flex flex-wrap items-end gap-2.5 border-t border-black/10 pt-4 dark:border-white/10'>
                    <form onSubmit={changeSeats} className='flex flex-wrap items-end gap-2.5'>
                        <label className='flex flex-col gap-1.5 text-sm font-medium'>
                            {t('paidSeats')}
                            <input
                                name='seats'
                                type='number'
                                min={1}
                                max={10000}
                                defaultValue={subscription.seats}
                                required
                                className={INPUT + ' w-28'}
                            />
                        </label>
                        <button type='submit' disabled={busy} className={BUTTON}>
                            {t('changeSeats')}
                        </button>
                    </form>
                    {confirm ? (
                        <button
                            type='button'
                            disabled={busy}
                            className={DANGER}
                            onClick={() =>
                                void act(`${base}/subscriptions/${product.code}`, 'DELETE', undefined, t('canceled'))
                            }
                        >
                            {t('cancelSure')}
                        </button>
                    ) : (
                        <button type='button' className={OUTLINE} onClick={() => setConfirm(true)}>
                            {t('cancel')}
                        </button>
                    )}
                </div>
            )}

            <div className='flex flex-col gap-2 border-t border-black/10 pt-4 dark:border-white/10'>
                <h3 className='text-base font-semibold'>{t('people')}</h3>
                <ul className='flex flex-col divide-y divide-black/10 dark:divide-white/10'>
                    {members.map(member => (
                        <MemberRow
                            key={member.userId}
                            member={member}
                            item={item}
                            busy={busy}
                            superadmin={superadmin}
                            tenantId={tenantId}
                            act={act}
                        />
                    ))}
                </ul>
            </div>

            {superadmin && (
                <div className='flex flex-col gap-3 border-t border-black/10 pt-4 dark:border-white/10'>
                    <h3 className='text-base font-semibold'>{t('freeSeats')}</h3>
                    {item.grants.length > 0 && (
                        <ul className='flex flex-col gap-1.5 text-sm'>
                            {item.grants.map(grant => (
                                <li
                                    key={grant.id}
                                    className={'flex flex-wrap items-center gap-2' + (grant.valid ? '' : ' opacity-60')}
                                >
                                    <span>
                                        {t('grantLine', { seats: grant.seats })} ·{' '}
                                        {grant.endsAt ? t('until', { date: date(grant.endsAt) }) : t('forGood')}
                                        {grant.note && ` · ${grant.note}`}
                                    </span>
                                    <button
                                        type='button'
                                        disabled={busy}
                                        className={SECONDARY}
                                        onClick={() =>
                                            void act(
                                                `admin/tenants/${tenantId}/grants/${grant.id}`,
                                                'DELETE',
                                                undefined,
                                                t('grantRevoked')
                                            )
                                        }
                                    >
                                        {t('revoke')}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <form onSubmit={grant} className='flex flex-wrap items-end gap-2.5'>
                        <input
                            name='seats'
                            type='number'
                            min={1}
                            max={10000}
                            defaultValue={1}
                            required
                            aria-label={t('seats')}
                            className={INPUT + ' w-24'}
                        />
                        <input
                            name='endsAt'
                            type='date'
                            aria-label={t('endsAt')}
                            className={INPUT + ' w-44 dark:[color-scheme:dark]'}
                        />
                        <input
                            name='note'
                            placeholder={t('note')}
                            aria-label={t('note')}
                            maxLength={200}
                            className={INPUT + ' w-44'}
                        />
                        <button type='submit' disabled={busy} className={BUTTON}>
                            {t('giveFree')}
                        </button>
                    </form>
                </div>
            )}
        </section>
    )
}

function MemberRow({
    member,
    item,
    busy,
    superadmin,
    tenantId,
    act
}: {
    member: Member
    item: Item
    busy: boolean
    superadmin: boolean
    tenantId: string
    act: (path: string, method: string, body: object | undefined, success: string) => Promise<void>
}) {
    const t = useTranslations('Licenses')
    const format = useFormatter()
    const code = item.product.code
    const seat = item.assignments.find(assignment => assignment.userId === member.userId)
    const trial = item.trials.find(entry => entry.userId === member.userId)
    const date = (value: string) => format.dateTime(new Date(value), { dateStyle: 'medium' })
    const full = item.seats.used >= item.seats.total
    const label = seat
        ? seat.active
            ? t('hasSeat')
            : t('seatNotCovered')
        : trial?.active
          ? t('trialUntil', { date: date(trial.endsAt) })
          : trial
            ? t('trialEnded')
            : t('noLicense')
    const good = seat?.active || trial?.active
    const base = `tenants/current/licenses/${code}`

    return (
        <li className='flex flex-wrap items-center gap-3 py-3'>
            <div className='flex min-w-0 flex-1 flex-col'>
                <span className='truncate text-sm font-semibold'>{member.name || member.email}</span>
                <span
                    className={
                        'truncate text-xs ' + (good ? 'font-semibold text-green-700 dark:text-green-400' : 'opacity-70')
                    }
                >
                    {label}
                </span>
            </div>
            {!trial && item.product.active && (
                <button
                    type='button'
                    disabled={busy}
                    className={SECONDARY}
                    onClick={() => void act(`${base}/trials/${member.userId}`, 'POST', {}, t('trialStarted'))}
                >
                    {t('startTrial')}
                </button>
            )}
            {superadmin && (
                <button
                    type='button'
                    disabled={busy}
                    className={SECONDARY}
                    onClick={() =>
                        void act(
                            `admin/tenants/${tenantId}/trials`,
                            'POST',
                            { productCode: code, userId: member.userId, days: 14 },
                            t('trialExtended')
                        )
                    }
                >
                    {t('extendTrial')}
                </button>
            )}
            {seat ? (
                <button
                    type='button'
                    disabled={busy}
                    className={SECONDARY}
                    onClick={() => void act(`${base}/seats/${member.userId}`, 'DELETE', undefined, t('seatTaken'))}
                >
                    {t('takeSeat')}
                </button>
            ) : (
                <button
                    type='button'
                    disabled={busy || full}
                    title={full ? t('noFreeSeat') : undefined}
                    className={SECONDARY}
                    onClick={() => void act(`${base}/seats/${member.userId}`, 'POST', {}, t('seatGiven'))}
                >
                    {t('giveSeat')}
                </button>
            )}
        </li>
    )
}

/**
 * /licenses/return?subscription=<id>: back from the checkout. Asks the API (which asks the payment provider) how the
 * payment ended, a few times while it is still open.
 */
export function LicenseReturn({ subscriptionId }: { subscriptionId: string }) {
    const t = useTranslations('Licenses')
    const backend = useBackend()
    const [state, setState] = useState<'waiting' | 'paid' | 'failed' | 'error'>('waiting')
    const tries = useRef(0)

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const check = () => {
            backend(`tenants/current/licenses/subscriptions/${encodeURIComponent(subscriptionId)}/sync`, 'POST')
                .then(result => {
                    const payment = result.status === 200 ? String(result.body.payment) : ''
                    if (payment === 'paid') return setState('paid')
                    if (['canceled', 'expired', 'failed'].includes(payment)) return setState('failed')
                    if (result.status !== 200 || ++tries.current > 10) return setState('error')
                    timer = setTimeout(check, 2000)
                })
                .catch(() => setState('error'))
        }
        check()
        return () => clearTimeout(timer)
        // once per subscription
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subscriptionId])

    return (
        <section className={WIDE_CARD}>
            <Heading title={t('returnTitle')} />
            {state === 'waiting' && <p className='text-sm opacity-70'>{t('returnWaiting')}</p>}
            {state === 'paid' && <Notice tone='success'>{t('returnPaid')}</Notice>}
            {state === 'failed' && <Notice tone='error'>{t('returnFailed')}</Notice>}
            {state === 'error' && <Notice tone='error'>{t('returnUnknown')}</Notice>}
            <Link href='/licenses' className={LINK + ' text-sm'}>
                {t('backToLicenses')}
            </Link>
        </section>
    )
}
