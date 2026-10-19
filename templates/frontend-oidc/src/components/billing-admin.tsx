'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { BUTTON, Heading, INPUT, Notice, SECONDARY, SELECT, WIDE_CARD } from '@/components/account-ui'
import { type Answer, useBackend } from '@/lib/account'

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
    productCode: string | null
    duration: 'once' | 'repeating' | 'forever'
    durationPeriods: number | null
    maxRedemptions: number | null
    redemptions: number
    expiresAt: string | null
    active: boolean
}

/** Euros as typed ("9,99" or "9.99") to cents. */
const cents = (value: FormDataEntryValue | null) => Math.round(Number(String(value ?? '').replace(',', '.')) * 100)

/**
 * On /admin, for superadmins: the products that are sold (price per month and per year) and the discount codes
 * (a percentage, 100% is free, or an amount; once, for some periods or forever). Free seats for one organisation and
 * longer trials are given on /licenses after opening that organisation.
 */
export function BillingAdmin() {
    const t = useTranslations('Licenses')
    const format = useFormatter()
    const backend = useBackend()
    const [products, setProducts] = useState<Product[] | null>(null)
    const [discounts, setDiscounts] = useState<Discount[]>([])
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [busy, setBusy] = useState(false)
    const [kind, setKind] = useState<'percent' | 'amount'>('percent')
    const [duration, setDuration] = useState<Discount['duration']>('once')

    const fetchAll = () => Promise.all([backend('admin/products'), backend('admin/discounts')])
    function show([list, codes]: Answer[]) {
        if (list?.status !== 200) return setError(list?.message || t('offline'))
        setProducts(list.body as unknown as Product[])
        if (codes?.status === 200) setDiscounts(codes.body as unknown as Discount[])
    }

    useEffect(() => {
        fetchAll()
            .then(show)
            .catch(() => setError(t('offline')))
        // once when the page opens
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function act(path: string, method: string, body: object, success: string) {
        setBusy(true)
        setError('')
        setNotice('')
        try {
            const result = await backend(path, method, body)
            if (result.status >= 400) setError(result.message || t('offline'))
            else
                setNotice(
                    typeof result.body.code === 'string' && method === 'POST' && path.endsWith('discounts')
                        ? t('codeMade', { code: result.body.code })
                        : success
                )
            show(await fetchAll())
            return result.status < 400
        } catch {
            setError(t('offline'))
            return false
        } finally {
            setBusy(false)
        }
    }

    function createProduct(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        const values = new FormData(form)
        void act(
            'admin/products',
            'POST',
            {
                code: String(values.get('code')),
                name: String(values.get('name')),
                description: String(values.get('description') ?? ''),
                priceMonthCents: cents(values.get('month')),
                priceYearCents: cents(values.get('year'))
            },
            t('productSaved')
        ).then(ok => ok && form.reset())
    }

    function createDiscount(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        const values = new FormData(form)
        const value = String(values.get('value'))
        const optional = (name: string) =>
            String(values.get(name) ?? '').trim() ? String(values.get(name)).trim() : undefined
        void act(
            'admin/discounts',
            'POST',
            {
                code: optional('code'),
                ...(kind === 'percent' ? { percentOff: Number(value) } : { amountOffCents: cents(value) }),
                productCode: optional('product'),
                duration,
                durationPeriods: duration === 'repeating' ? Number(values.get('periods')) : undefined,
                maxRedemptions: optional('max') ? Number(optional('max')) : undefined,
                expiresAt: optional('expires') ? new Date(String(optional('expires'))).toISOString() : undefined
            },
            t('codeSaved')
        ).then(ok => ok && form.reset())
    }

    const money = (value: number, currency = 'EUR') => format.number(value / 100, { style: 'currency', currency })
    const discountText = (discount: Discount) =>
        [
            discount.percentOff !== null ? `${discount.percentOff}%` : money(discount.amountOffCents ?? 0),
            discount.duration === 'repeating'
                ? t('durationRepeatingN', { count: discount.durationPeriods ?? 0 })
                : discount.duration === 'forever'
                  ? t('durationForever')
                  : t('durationOnce'),
            discount.productCode ?? t('allProducts'),
            t('redeemed', { count: discount.redemptions, max: discount.maxRedemptions ?? '∞' }),
            discount.expiresAt
                ? t('until', { date: format.dateTime(new Date(discount.expiresAt), { dateStyle: 'medium' }) })
                : null
        ]
            .filter(Boolean)
            .join(' · ')

    return (
        <>
            <section className={WIDE_CARD}>
                <Heading title={t('productsTitle')} text={t('productsText')} />
                {error && <Notice tone='error'>{error}</Notice>}
                {notice && <Notice tone='success'>{notice}</Notice>}
                <ul className='flex flex-col divide-y divide-[var(--border)]'>
                    {products?.map(product => (
                        <li
                            key={product.code}
                            className={
                                'flex flex-wrap items-center gap-3 py-3' +
                                (product.active ? '' : ' text-[var(--text-3)]')
                            }
                        >
                            <div className='flex min-w-0 flex-1 flex-col'>
                                <span className='text-sm font-semibold'>
                                    {product.name}{' '}
                                    <span className='font-normal text-[var(--text-3)]'>({product.code})</span>
                                </span>
                                <span className='text-xs text-[var(--text-3)]'>
                                    {t('prices', {
                                        month: money(product.priceMonthCents, product.currency),
                                        year: money(product.priceYearCents, product.currency)
                                    })}
                                </span>
                            </div>
                            <button
                                type='button'
                                disabled={busy}
                                className={SECONDARY}
                                onClick={() =>
                                    void act(
                                        `admin/products/${product.code}`,
                                        'PATCH',
                                        { active: !product.active },
                                        t('productSaved')
                                    )
                                }
                            >
                                {product.active ? t('stopSelling') : t('startSelling')}
                            </button>
                        </li>
                    ))}
                </ul>
                <form onSubmit={createProduct} className='flex flex-col gap-3 border-t border-[var(--border)] pt-4'>
                    <h2 className='text-base font-semibold'>{t('newProduct')}</h2>
                    <div className='flex flex-wrap gap-2.5'>
                        <input
                            name='code'
                            required
                            pattern='[a-z0-9][a-z0-9\-]{1,62}'
                            placeholder={t('productCode')}
                            aria-label={t('productCode')}
                            className={INPUT + ' w-40'}
                        />
                        <input
                            name='name'
                            required
                            minLength={2}
                            maxLength={100}
                            placeholder={t('productName')}
                            aria-label={t('productName')}
                            className={INPUT + ' min-w-48 flex-1'}
                        />
                    </div>
                    <input
                        name='description'
                        maxLength={500}
                        placeholder={t('productDescription')}
                        aria-label={t('productDescription')}
                        className={INPUT}
                    />
                    <div className='flex flex-wrap gap-2.5'>
                        <input
                            name='month'
                            required
                            inputMode='decimal'
                            placeholder={t('priceMonth')}
                            aria-label={t('priceMonth')}
                            className={INPUT + ' w-44'}
                        />
                        <input
                            name='year'
                            required
                            inputMode='decimal'
                            placeholder={t('priceYear')}
                            aria-label={t('priceYear')}
                            className={INPUT + ' w-44'}
                        />
                        <button type='submit' disabled={busy} className={BUTTON}>
                            {t('createProduct')}
                        </button>
                    </div>
                </form>
            </section>

            <section className={WIDE_CARD}>
                <Heading title={t('discountsTitle')} text={t('discountsText')} />
                <ul className='flex flex-col divide-y divide-[var(--border)]'>
                    {discounts.map(discount => (
                        <li
                            key={discount.code}
                            className={
                                'flex flex-wrap items-center gap-3 py-3' +
                                (discount.active ? '' : ' text-[var(--text-3)]')
                            }
                        >
                            <div className='flex min-w-0 flex-1 flex-col'>
                                <span className='font-mono text-sm font-semibold'>{discount.code}</span>
                                <span className='text-xs text-[var(--text-3)]'>{discountText(discount)}</span>
                            </div>
                            <button
                                type='button'
                                disabled={busy}
                                className={SECONDARY}
                                onClick={() =>
                                    void act(
                                        `admin/discounts/${discount.code}`,
                                        'PATCH',
                                        { active: !discount.active },
                                        t('codeSaved')
                                    )
                                }
                            >
                                {discount.active ? t('switchOff') : t('switchOn')}
                            </button>
                        </li>
                    ))}
                </ul>
                <form onSubmit={createDiscount} className='flex flex-col gap-3 border-t border-[var(--border)] pt-4'>
                    <h2 className='text-base font-semibold'>{t('newCode')}</h2>
                    <div className='flex flex-wrap gap-2.5'>
                        <input
                            name='code'
                            maxLength={40}
                            placeholder={t('codeOptional')}
                            aria-label={t('codeOptional')}
                            className={INPUT + ' w-48 uppercase'}
                        />
                        <select
                            aria-label={t('discountKind')}
                            value={kind}
                            onChange={event => setKind(event.target.value as 'percent' | 'amount')}
                            className={SELECT}
                        >
                            <option value='percent'>{t('kindPercent')}</option>
                            <option value='amount'>{t('kindAmount')}</option>
                        </select>
                        <input
                            name='value'
                            required
                            inputMode='decimal'
                            placeholder={kind === 'percent' ? '100' : '5,00'}
                            aria-label={t('discountValue')}
                            className={INPUT + ' w-28'}
                        />
                    </div>
                    <div className='flex flex-wrap gap-2.5'>
                        <select name='product' aria-label={t('product')} defaultValue='' className={SELECT}>
                            <option value=''>{t('allProducts')}</option>
                            {products?.map(product => (
                                <option key={product.code} value={product.code}>
                                    {product.name}
                                </option>
                            ))}
                        </select>
                        <select
                            aria-label={t('duration')}
                            value={duration}
                            onChange={event => setDuration(event.target.value as Discount['duration'])}
                            className={SELECT}
                        >
                            <option value='once'>{t('durationOnce')}</option>
                            <option value='repeating'>{t('durationRepeating')}</option>
                            <option value='forever'>{t('durationForever')}</option>
                        </select>
                        {duration === 'repeating' && (
                            <input
                                name='periods'
                                type='number'
                                min={1}
                                max={120}
                                required
                                defaultValue={3}
                                aria-label={t('periods')}
                                className={INPUT + ' w-24'}
                            />
                        )}
                    </div>
                    <div className='flex flex-wrap gap-2.5'>
                        <input
                            name='max'
                            type='number'
                            min={1}
                            placeholder={t('maxRedemptions')}
                            aria-label={t('maxRedemptions')}
                            className={INPUT + ' w-48'}
                        />
                        <input name='expires' type='date' aria-label={t('expires')} className={INPUT + ' w-44'} />
                        <button type='submit' disabled={busy} className={BUTTON}>
                            {t('createCode')}
                        </button>
                    </div>
                    <p className='text-xs text-[var(--text-3)]'>{t('freeHint')}</p>
                </form>
            </section>
        </>
    )
}
