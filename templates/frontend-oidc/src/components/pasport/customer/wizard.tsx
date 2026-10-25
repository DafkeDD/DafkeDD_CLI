'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/i18n/navigation'
import {
    ApiFailure,
    daysUntil,
    type Billing,
    type CatalogApp,
    environmentHost,
    type Invoice,
    type LicenseItem,
    type Member,
    type Quote,
    useApi,
    useData,
    useFormat
} from '@/lib/portal'
import { useMe } from '../portal-shell'
import { useT } from '../i18n'
import { LoadError, Loading, Notice } from '../page-state'
import { useToast } from '../toast'
import { AppIcon, Badge, Btn, ErrorNote, Field, Icon, Input, Select } from '../ui'
import { QrCode } from '../widgets'

const REGIONS = ['eu-west-1', 'eu-west-3', 'eu-central-1'] as const

function Stepper({ step, labels }: { step: number; labels: string[] }) {
    return (
        <div className='wizard-stepper'>
            {labels.map((lbl, i) => {
                const cls = i < step ? 'done' : i === step ? 'active' : ''
                return (
                    <div style={{ display: 'contents' }} key={i}>
                        <div className={`wstep ${cls}`}>
                            <div className='wstep-num'>{i < step ? <Icon name='check' size={15} /> : i + 1}</div>
                            <div className='wstep-lbl'>{lbl}</div>
                        </div>
                        {i < labels.length - 1 && <div className={`wstep-line ${i < step ? 'done' : ''}`} />}
                    </div>
                )
            })}
        </div>
    )
}

/** The purchase wizard (/wizard?app=<code>), and the result after the checkout (/wizard?subscription=<id>). */
export function PurchaseWizard() {
    const params = useSearchParams()
    const subscription = params.get('subscription')
    if (subscription) return <Provisioning subscriptionId={subscription} />
    return <Purchase appCode={params.get('app') ?? ''} />
}

function Purchase({ appCode }: { appCode: string }) {
    const t = useT('Wizard')
    const f = useFormat()
    const router = useRouter()
    const api = useApi()
    const me = useMe()
    const catalog = useData<CatalogApp[]>('tenants/current/catalog')
    const billing = useData<Billing>('tenants/current/billing')
    const members = useData<Member[]>(me.tenant?.role === 'admin' ? 'tenants/current/members' : null)
    const [step, setStep] = useState(0)
    const push = useToast()
    const [asking, setAsking] = useState(false)
    const [practice, setPractice] = useState(me.tenant?.name ?? '')
    const [region, setRegion] = useState<string>(REGIONS[0])
    const [seats, setSeats] = useState<number | null>(null)
    const [pay, setPay] = useState<'card' | 'qr'>('card')
    const [code, setCode] = useState('')
    const [quote, setQuote] = useState<Quote | null>(null)
    const [codeState, setCodeState] = useState<'none' | 'applied' | 'error'>('none')
    const [codeError, setCodeError] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')

    const app = catalog.data?.find(a => a.code === appCode)
    const activeMembers = members.data?.filter(m => m.status === 'active').length ?? 1
    const seatCount = seats ?? Math.max(1, activeMembers)
    const host = environmentHost(app?.launchUrl ?? null, me.slug ?? 'praktijk')

    // The price for the chosen seats (and code): asked again when the seats change
    const quoteFor = async (discountCode?: string) =>
        api<Quote>('tenants/current/licenses/quote', 'POST', {
            productCode: appCode,
            interval: 'month',
            seats: seatCount,
            ...(discountCode ? { discountCode } : {})
        })
    useEffect(() => {
        if (!app || app.owned) return
        quoteFor()
            .then(q => {
                setQuote(q)
                setCodeState('none')
            })
            .catch(() => setQuote(null))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [app?.code, seatCount])

    if (me.tenant?.role !== 'admin') return <Notice title={t('adminOnlyTitle')} text={t('adminOnlyText')} />
    if (catalog.loading && !catalog.data) return <Loading />
    if (catalog.error && !catalog.data)
        return <LoadError message={catalog.error.message} onRetry={() => void catalog.reload()} />
    if (!app) return <Notice icon='box' title={t('notFound')} />
    if (app.owned)
        return (
            <Notice icon='checkCircle' title={t('alreadyOwnedTitle', { app: app.name })} text={t('alreadyOwnedText')} />
        )

    const base = app.priceMonthCents * seatCount
    const applied = codeState === 'applied' && quote?.discount ? quote : null
    const pct =
        applied && applied.discount
            ? (applied.discount.percentOff ??
              Math.round((1 - applied.firstCents / Math.max(1, applied.baseCents)) * 100))
            : 0
    const finalCents = quote ? quote.firstCents : base
    const isFree = finalCents <= 0

    const applyCode = async () => {
        setError('')
        try {
            const q = await quoteFor(code.trim().toUpperCase())
            setQuote(q)
            setCodeError('')
            setCodeState(q.discount ? 'applied' : 'error')
        } catch (e) {
            setCodeError(e instanceof ApiFailure ? e.message : '')
            setCodeState('error')
        }
    }

    const askDemo = async () => {
        setAsking(true)
        try {
            const demo = await api<{ endsAt: string }>(`me/licenses/${encodeURIComponent(app.code)}/trial`, 'POST')
            push(t('demoStarted', { app: app.name, date: f.date(demo.endsAt) }), 'sparkles', 'green')
            router.push('/dashboard')
        } catch (e) {
            push(e instanceof ApiFailure ? e.message : t('failed'), 'alert', 'red')
            setAsking(false)
            void catalog.reload()
        }
    }

    const confirm = async () => {
        setBusy(true)
        setError('')
        try {
            const result = await api<{ status: string; checkoutUrl: string | null; subscriptionId: string }>(
                'tenants/current/licenses/subscriptions',
                'POST',
                {
                    productCode: app.code,
                    interval: 'month',
                    seats: seatCount,
                    environmentName: practice.trim(),
                    region,
                    method: pay,
                    ...(applied ? { discountCode: code.trim().toUpperCase() } : {})
                }
            )
            if (result.checkoutUrl) window.location.assign(result.checkoutUrl)
            else router.push(`/wizard?subscription=${encodeURIComponent(result.subscriptionId)}`)
        } catch (e) {
            setError(e instanceof ApiFailure ? e.message : t('failed'))
            setBusy(false)
        }
    }

    const next = () => setStep(s => Math.min(s + 1, 3))
    const back = () => setStep(s => Math.max(s - 1, 0))
    const labels = [t('stepDetail'), t('stepEnvironment'), t('stepPayment'), t('stepConfirm'), t('stepDone')]

    return (
        <div className='fade-in'>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <Btn
                    variant='ghost'
                    size='sm'
                    icon='arrowLeft'
                    onClick={step === 0 ? () => router.push('/marketplace') : back}
                >
                    {step === 0 ? t('backToMarket') : t('previous')}
                </Btn>
            </div>
            <Stepper step={step} labels={labels} />

            {step === 0 && (
                <div className='wizard-panel fade-in'>
                    <div className='card card-pad' style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                        <AppIcon app={app} size={68} />
                        <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                <h1 style={{ fontSize: 24 }}>{app.name}</h1>
                                {app.category && <Badge tone='neutral'>{app.category}</Badge>}
                                {app.requiresVault && (
                                    <Badge tone='accent' icon='vault'>
                                        {t('vaultRequired')}
                                    </Badge>
                                )}
                            </div>
                            <p style={{ marginTop: 10, fontSize: 15 }}>{app.description || app.short}</p>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 18, marginTop: 18 }}>
                        <div className='card card-pad'>
                            <div className='t-eyebrow' style={{ marginBottom: 14 }}>
                                {t('features')}
                            </div>
                            <div style={{ display: 'grid', gap: 11 }}>
                                {app.features.map(feature => (
                                    <div
                                        key={feature}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 11,
                                            fontSize: 14.5,
                                            color: 'var(--text)'
                                        }}
                                    >
                                        <span
                                            style={{
                                                width: 22,
                                                height: 22,
                                                borderRadius: 999,
                                                background: 'var(--accent-tint)',
                                                color: 'var(--accent)',
                                                display: 'grid',
                                                placeItems: 'center',
                                                flex: 'none'
                                            }}
                                        >
                                            <Icon name='check' size={13} />
                                        </span>
                                        {feature}
                                    </div>
                                ))}
                                {app.features.length === 0 && <p className='hint'>{app.short}</p>}
                            </div>
                        </div>
                        <div
                            className='card card-pad'
                            style={{ display: 'flex', flexDirection: 'column', gap: 16, height: 'fit-content' }}
                        >
                            <div>
                                <div className='t-muted' style={{ fontSize: 13 }}>
                                    {t('pricePerMonth')}
                                </div>
                                <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.03em', marginTop: 4 }}>
                                    {f.eur(app.priceMonthCents)}
                                </div>
                                <div className='hint'>{t('exclVat')}</div>
                            </div>
                            <div className='divider' />
                            <div style={{ display: 'grid', gap: 9, fontSize: 13.5, color: 'var(--text-2)' }}>
                                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <Icon name='database' size={15} style={{ color: 'var(--accent)' }} />{' '}
                                    {t('isolated')}
                                </span>
                                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <Icon name='shieldCheck' size={15} style={{ color: 'var(--accent)' }} /> {t('gdpr')}
                                </span>
                                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <Icon name='refresh' size={15} style={{ color: 'var(--accent)' }} /> {t('instant')}
                                </span>
                            </div>
                            <Btn
                                variant='primary'
                                size='lg'
                                className='btn-block'
                                iconRight='arrowRight'
                                onClick={next}
                            >
                                {t('start')}
                            </Btn>
                            {/* First try it: a demo of 14 days for me, once per app */}
                            {app.trialEndsAt ? (
                                <div className='hint' style={{ textAlign: 'center' }}>
                                    <Icon name='sparkles' size={13} />{' '}
                                    {t('demoRunning', { count: Math.max(0, daysUntil(app.trialEndsAt)) })}
                                </div>
                            ) : app.trialAvailable ? (
                                <Btn
                                    variant='secondary'
                                    className='btn-block'
                                    icon='sparkles'
                                    disabled={asking}
                                    onClick={() => void askDemo()}
                                >
                                    {t('askDemo')}
                                </Btn>
                            ) : (
                                <div className='hint' style={{ textAlign: 'center' }}>
                                    {t('demoUsed')}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {step === 1 && (
                <div className='wizard-panel fade-in' style={{ maxWidth: 580 }}>
                    <div className='card card-pad' style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                        <div>
                            <h2 className='t-h2'>{t('envTitle')}</h2>
                            <p style={{ marginTop: 6 }}>
                                {t('envText')} <strong style={{ color: 'var(--text)' }}>{app.name}</strong>.
                            </p>
                        </div>
                        <Field label={t('practiceName')} hint={t('practiceHint')}>
                            <Input
                                placeholder={t('practicePlaceholder')}
                                value={practice}
                                onChange={e => setPractice(e.target.value)}
                                autoFocus
                            />
                        </Field>
                        <div>
                            <div className='label' style={{ marginBottom: 7 }}>
                                {t('envUrl')}
                            </div>
                            <div className='input-group'>
                                <input
                                    className='input t-mono'
                                    style={{ color: 'var(--accent)', fontWeight: 600 }}
                                    value={host.split('.')[0]}
                                    readOnly
                                    aria-label={t('envUrl')}
                                />
                                <span className='input-addon'>.{host.split('.').slice(1).join('.')}</span>
                            </div>
                            <p className='hint' style={{ marginTop: 7, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Icon name='globe' size={13} /> {t('envAvailable')}{' '}
                                <span className='t-mono' style={{ color: 'var(--text-2)' }}>
                                    {host}
                                </span>
                            </p>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                            <Field label={t('region')}>
                                <Select className='select' value={region} onChange={e => setRegion(e.target.value)}>
                                    {REGIONS.map(r => (
                                        <option key={r} value={r}>
                                            {t('region_' + r.replace(/-/g, '_'))}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                            <Field label={t('seats')} hint={t('seatsHint')}>
                                <Input
                                    type='number'
                                    min={1}
                                    max={500}
                                    value={seatCount}
                                    onChange={e => setSeats(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
                                />
                            </Field>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                            <Btn variant='primary' iconRight='arrowRight' disabled={!practice.trim()} onClick={next}>
                                {t('toPayment')}
                            </Btn>
                        </div>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div className='wizard-panel fade-in' style={{ maxWidth: 580 }}>
                    <div className='card card-pad' style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                        <div>
                            <h2 className='t-h2'>{t('payTitle')}</h2>
                            <p style={{ marginTop: 6 }}>{t('payText')}</p>
                        </div>

                        <div>
                            <div className='label' style={{ marginBottom: 8 }}>
                                {t('code')}
                            </div>
                            <div className='input-group'>
                                <input
                                    className='input t-mono'
                                    placeholder={t('codePlaceholder')}
                                    aria-label={t('code')}
                                    value={code}
                                    onChange={e => {
                                        setCode(e.target.value)
                                        if (codeState !== 'none') {
                                            setCodeState('none')
                                            void quoteFor()
                                                .then(setQuote)
                                                .catch(() => undefined)
                                        }
                                    }}
                                    onKeyDown={e => e.key === 'Enter' && code.trim() && void applyCode()}
                                    style={{ textTransform: 'uppercase' }}
                                />
                                <button
                                    type='button'
                                    className='btn btn-secondary'
                                    style={{ borderRadius: '0 var(--r-sm) var(--r-sm) 0', borderLeft: 'none' }}
                                    onClick={() => void applyCode()}
                                    disabled={!code.trim()}
                                >
                                    {t('apply')}
                                </button>
                            </div>
                            {applied && isFree && (
                                <div className='badge badge-green' style={{ marginTop: 10 }}>
                                    <Icon name='sparkles' size={12} /> {t('codeFree')}
                                </div>
                            )}
                            {applied && !isFree && (
                                <div className='badge badge-accent' style={{ marginTop: 10 }}>
                                    <Icon name='check' size={12} />{' '}
                                    {pct > 0
                                        ? t('codePct', { pct })
                                        : t('codeAmount', { amount: f.eur(base - finalCents) })}
                                </div>
                            )}
                            {codeState === 'error' && (
                                <div className='badge badge-red' style={{ marginTop: 10 }}>
                                    <Icon name='x' size={12} /> {codeError || t('codeInvalid')}
                                </div>
                            )}
                        </div>

                        {!isFree && (
                            <div className='fade-in'>
                                <div className='label' style={{ marginBottom: 8 }}>
                                    {t('method')}
                                </div>
                                <div style={{ display: 'grid', gap: 10 }}>
                                    {(
                                        [
                                            {
                                                k: 'card',
                                                ic: 'creditcard',
                                                title: t('methodCard'),
                                                sub: t('methodCardSub')
                                            },
                                            { k: 'qr', ic: 'qrcode', title: t('methodQr'), sub: t('methodQrSub') }
                                        ] as const
                                    ).map(m => (
                                        <button
                                            type='button'
                                            key={m.k}
                                            className='step-row'
                                            style={{
                                                cursor: 'pointer',
                                                borderColor: pay === m.k ? 'var(--accent)' : 'var(--border)',
                                                background: pay === m.k ? 'var(--accent-tint)' : 'var(--surface)',
                                                textAlign: 'left',
                                                width: '100%'
                                            }}
                                            onClick={() => setPay(m.k)}
                                            aria-pressed={pay === m.k}
                                        >
                                            <div
                                                className='step-ic'
                                                style={{
                                                    background: pay === m.k ? 'var(--accent)' : 'var(--surface-3)',
                                                    color: pay === m.k ? '#fff' : 'var(--text-3)'
                                                }}
                                            >
                                                <Icon name={m.ic} size={16} />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <div className='step-txt'>{m.title}</div>
                                                <div className='step-sub'>{m.sub}</div>
                                            </div>
                                            <div
                                                style={{
                                                    width: 18,
                                                    height: 18,
                                                    borderRadius: 999,
                                                    border:
                                                        '2px solid ' +
                                                        (pay === m.k ? 'var(--accent)' : 'var(--border-strong)'),
                                                    display: 'grid',
                                                    placeItems: 'center'
                                                }}
                                            >
                                                {pay === m.k && (
                                                    <div
                                                        style={{
                                                            width: 8,
                                                            height: 8,
                                                            borderRadius: 999,
                                                            background: 'var(--accent)'
                                                        }}
                                                    />
                                                )}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                                {pay === 'card' && (
                                    <div
                                        className='fade-in'
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 12,
                                            marginTop: 14,
                                            padding: 14,
                                            border: '1px solid var(--border)',
                                            borderRadius: 'var(--r-sm)',
                                            background: 'var(--surface-2)'
                                        }}
                                    >
                                        <Icon name='lock' size={18} style={{ color: 'var(--accent)', flex: 'none' }} />
                                        <div className='step-sub' style={{ fontSize: 13 }}>
                                            {t('cardRedirect')}
                                        </div>
                                    </div>
                                )}
                                {pay === 'qr' && (
                                    <div
                                        className='fade-in'
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 18,
                                            marginTop: 14,
                                            padding: 16,
                                            border: '1px solid var(--border)',
                                            borderRadius: 'var(--r-sm)',
                                            background: 'var(--surface-2)'
                                        }}
                                    >
                                        <QrCode value={host} size={104} />
                                        <div style={{ flex: 1 }}>
                                            <div className='step-txt' style={{ marginBottom: 4 }}>
                                                {t('qrTitle')}
                                            </div>
                                            <div className='step-sub'>
                                                {t('qrText', { amount: f.eur(quote?.firstTotalCents ?? finalCents) })}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className='card' style={{ background: 'var(--surface-2)', padding: 16 }}>
                            <div className='summary-row' style={{ padding: '6px 0' }}>
                                <span className='sr-label'>
                                    {seatCount > 1
                                        ? t('lineSeats', { app: app.name, seats: seatCount })
                                        : t('line', { app: app.name })}
                                </span>
                                <span className='sr-value'>{f.eur(base)}</span>
                            </div>
                            {applied && base - finalCents > 0 && (
                                <div className='summary-row' style={{ padding: '6px 0' }}>
                                    <span className='sr-label' style={{ color: 'var(--green)' }}>
                                        {t('discountLine', { code: applied.discount?.code ?? code.toUpperCase(), pct })}
                                    </span>
                                    <span className='sr-value' style={{ color: 'var(--green)' }}>
                                        −{f.eur(base - finalCents)}
                                    </span>
                                </div>
                            )}
                            {!!quote?.firstVatCents && (
                                <div className='summary-row' style={{ padding: '6px 0' }}>
                                    <span className='sr-label'>{t('vatLine', { pct: quote.vatPercent ?? 21 })}</span>
                                    <span className='sr-value'>{f.eur(quote.firstVatCents)}</span>
                                </div>
                            )}
                            <div
                                className='summary-row'
                                style={{ padding: '10px 0 4px', borderTop: '1px solid var(--border)' }}
                            >
                                <span className='sr-label' style={{ fontWeight: 600, color: 'var(--text)' }}>
                                    {t('toPay')}
                                </span>
                                <span className='sr-value' style={{ fontSize: 18 }}>
                                    {f.eur(Math.max(0, quote?.firstTotalCents ?? finalCents))}
                                </span>
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                            <Btn variant='primary' iconRight='arrowRight' onClick={next}>
                                {isFree ? t('activateFree') : t('continue')}
                            </Btn>
                        </div>
                    </div>
                </div>
            )}

            {step === 3 && (
                <div className='wizard-panel fade-in' style={{ maxWidth: 560 }}>
                    <div className='card card-pad' style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <h2 className='t-h2' style={{ marginBottom: 8 }}>
                            {t('confirmTitle')}
                        </h2>
                        <div className='summary-row'>
                            <span className='sr-label'>{t('app')}</span>
                            <span className='sr-value' style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <AppIcon app={app} size={24} /> {app.name}
                            </span>
                        </div>
                        <div className='summary-row'>
                            <span className='sr-label'>{t('practiceName')}</span>
                            <span className='sr-value'>{practice}</span>
                        </div>
                        <div className='summary-row'>
                            <span className='sr-label'>{t('envUrl')}</span>
                            <span className='sr-value t-mono' style={{ color: 'var(--accent)' }}>
                                {host}
                            </span>
                        </div>
                        <div className='summary-row'>
                            <span className='sr-label'>{t('region')}</span>
                            <span className='sr-value'>{t('region_' + region.replace(/-/g, '_'))}</span>
                        </div>
                        <div className='summary-row'>
                            <span className='sr-label'>{t('seats')}</span>
                            <span className='sr-value'>{seatCount}</span>
                        </div>
                        <div className='summary-row'>
                            <span className='sr-label'>{t('price')}</span>
                            <span className='sr-value'>
                                {isFree ? (
                                    <span className='badge badge-green'>
                                        <Icon name='sparkles' size={12} /> {t('freeVia', { code: code.toUpperCase() })}
                                    </span>
                                ) : (
                                    f.eur(finalCents) + ' ' + t('perMonth') + ' · ' + t('exclVatShort')
                                )}
                            </span>
                        </div>
                        <div className='summary-row'>
                            <span className='sr-label'>{t('invoiceTo')}</span>
                            <span className='sr-value' style={{ fontWeight: 500 }}>
                                {billing.data?.billingEmail || me.email}
                                {(billing.data?.company || billing.data?.vat) && (
                                    <div
                                        style={{
                                            fontSize: 12,
                                            color: 'var(--text-3)',
                                            fontFamily: 'var(--mono)',
                                            fontWeight: 400
                                        }}
                                    >
                                        {[billing.data?.company, billing.data?.vat].filter(Boolean).join(' · ')}
                                    </div>
                                )}
                            </span>
                        </div>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                marginTop: 6,
                                fontSize: 12.5,
                                color: 'var(--text-3)'
                            }}
                        >
                            <Icon name='info' size={14} /> {t('invoiceNote')}
                        </div>
                        {error && (
                            <div style={{ marginTop: 12 }}>
                                <ErrorNote>{error}</ErrorNote>
                            </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
                            <Btn variant='ghost' onClick={back} disabled={busy}>
                                {t('adjust')}
                            </Btn>
                            <Btn variant='primary' icon='check' onClick={() => void confirm()} disabled={busy}>
                                {busy ? t('busy') : t('confirm')}
                            </Btn>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

/** Step 5: back from the checkout (or activated for free). Checks the payment while the environment is "created". */
function Provisioning({ subscriptionId }: { subscriptionId: string }) {
    const t = useT('Wizard')
    const router = useRouter()
    const api = useApi()
    const me = useMe()
    const [phase, setPhase] = useState(0)
    const [payment, setPayment] = useState<'waiting' | 'paid' | 'failed' | 'error'>('waiting')
    const [item, setItem] = useState<LicenseItem | null>(null)
    const [catalogApp, setCatalogApp] = useState<CatalogApp | null>(null)
    const [invoice, setInvoice] = useState<Invoice | null>(null)
    const tries = useRef(0)

    useEffect(() => {
        const timers = [
            setTimeout(() => setPhase(1), 1100),
            setTimeout(() => setPhase(2), 2400),
            setTimeout(() => setPhase(3), 3700)
        ]
        return () => timers.forEach(clearTimeout)
    }, [])

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const check = () => {
            api<{ payment: string }>(
                `tenants/current/licenses/subscriptions/${encodeURIComponent(subscriptionId)}/sync`,
                'POST'
            )
                .then(result => {
                    const p = String(result.payment)
                    if (p === 'paid' || p === 'none' || p === 'free') return setPayment('paid')
                    if (['canceled', 'expired', 'failed'].includes(p)) return setPayment('failed')
                    if (++tries.current > 10) return setPayment('error')
                    timer = setTimeout(check, 2000)
                })
                .catch(() => setPayment('error'))
        }
        check()
        return () => clearTimeout(timer)
        // once per subscription
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subscriptionId])

    // What was bought, and its invoice
    useEffect(() => {
        if (payment !== 'paid') return
        void (async () => {
            const items = await api<LicenseItem[]>('tenants/current/licenses')
            const bought = items.find(i => i.subscription?.id === subscriptionId) ?? null
            // The buyer gets one of the seats (nothing changes when they have one, or when all are in use)
            if (bought)
                await api(`tenants/current/licenses/${encodeURIComponent(bought.product.code)}/seat`, 'POST').catch(
                    () => undefined
                )
            const [catalog, invoices] = await Promise.all([
                api<CatalogApp[]>('tenants/current/catalog'),
                api<Invoice[]>('tenants/current/invoices').catch(() => [] as Invoice[])
            ])
            setItem(bought)
            setCatalogApp(catalog.find(a => a.code === bought?.product.code) ?? null)
            setInvoice(invoices.find(i => i.productCode === bought?.product.code) ?? null)
        })().catch(() => undefined)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [payment])

    const done = phase >= 3 && payment === 'paid'
    const appName = item?.product.name ?? catalogApp?.name ?? ''
    const host = environmentHost(catalogApp?.launchUrl ?? null, me.slug ?? 'praktijk')
    const isFree = invoice?.status === 'free'

    if (payment === 'failed' || payment === 'error')
        return (
            <div className='wizard-panel fade-in' style={{ maxWidth: 460, textAlign: 'center', paddingTop: 30 }}>
                <div className='card card-pad' style={{ padding: '40px 32px' }}>
                    <Icon name='alert' size={34} style={{ color: 'var(--red)' }} />
                    <h2 className='t-h2' style={{ marginTop: 14 }}>
                        {payment === 'failed' ? t('payFailed') : t('payUnknown')}
                    </h2>
                    <p style={{ marginTop: 8 }}>{payment === 'failed' ? t('payFailedText') : t('payUnknownText')}</p>
                    <Btn variant='secondary' style={{ marginTop: 20 }} onClick={() => router.push('/marketplace')}>
                        {t('backToMarket')}
                    </Btn>
                </div>
            </div>
        )

    return (
        <div className='wizard-panel fade-in' style={{ maxWidth: 460, textAlign: 'center', paddingTop: 30 }}>
            {!done ? (
                <div className='card card-pad' style={{ padding: '40px 32px' }}>
                    <div
                        style={{
                            width: 64,
                            height: 64,
                            margin: '0 auto 22px',
                            borderRadius: 999,
                            background: 'var(--accent-tint)',
                            color: 'var(--accent)',
                            display: 'grid',
                            placeItems: 'center'
                        }}
                    >
                        <Icon name='loader' size={30} className='spin' />
                    </div>
                    <h2 className='t-h2'>{t('provisioning')}</h2>
                    <div className='step-list' style={{ marginTop: 22, textAlign: 'left' }}>
                        {[t('provEnv'), t('provDb'), t('provApp')].map((label, i) => {
                            const st = i < phase ? 'done' : i === phase ? 'active' : 'pending'
                            return (
                                <div className={`step-row ${st}`} key={label}>
                                    <div className='step-ic'>
                                        {st === 'done' ? (
                                            <Icon name='check' size={15} />
                                        ) : (
                                            <Icon
                                                name={st === 'active' ? 'loader' : 'clock'}
                                                size={15}
                                                className={st === 'active' ? 'spin' : ''}
                                            />
                                        )}
                                    </div>
                                    <div className='step-txt'>{label}</div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            ) : (
                <div className='card card-pad pop-in' style={{ padding: '44px 32px' }}>
                    <div className='success-burst'>
                        <Icon name='check' size={44} strokeWidth={2.4} />
                    </div>
                    <h1 style={{ fontSize: 24, marginTop: 24 }}>{t('ready')}</h1>
                    <p style={{ marginTop: 10, fontSize: 15 }}>
                        {t('readyText', {
                            app: appName,
                            practice: item?.subscription?.environmentName || me.tenant?.name || ''
                        })}
                    </p>
                    <div
                        className='card'
                        style={{
                            background: 'var(--surface-2)',
                            padding: '12px 14px',
                            marginTop: 20,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 8
                        }}
                    >
                        <Icon name='globe' size={15} style={{ color: 'var(--accent)' }} />
                        <span className='t-mono' style={{ fontSize: 13.5, color: 'var(--text)' }}>
                            {host}
                        </span>
                    </div>
                    {invoice && (
                        <div
                            className='card'
                            style={{
                                background: isFree ? 'var(--violet-tint)' : 'var(--green-tint)',
                                border:
                                    '1px solid ' +
                                    (isFree
                                        ? 'color-mix(in srgb, var(--violet) 25%, transparent)'
                                        : 'var(--green-border)'),
                                padding: '12px 14px',
                                marginTop: 10,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 11,
                                textAlign: 'left'
                            }}
                        >
                            <Icon
                                name='invoice'
                                size={18}
                                style={{ color: isFree ? 'var(--violet)' : 'var(--green)', flex: 'none' }}
                            />
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
                                    {isFree
                                        ? t('invoiceFree', { number: invoice.number })
                                        : t('invoiceSent', { number: invoice.number })}
                                </div>
                            </div>
                            <a
                                className='btn btn-ghost btn-sm'
                                href={`/api/backend/tenants/current/invoices/${encodeURIComponent(invoice.id)}/pdf`}
                                target='_blank'
                                rel='noopener noreferrer'
                            >
                                <Icon name='external' size={14} /> PDF
                            </a>
                        </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 24 }}>
                        {catalogApp?.launchUrl && (
                            <a
                                className='btn btn-primary btn-lg btn-block'
                                href={catalogApp.launchUrl}
                                target='_blank'
                                rel='noopener noreferrer'
                            >
                                {t('openApp', { app: appName })} <Icon name='external' size={16} />
                            </a>
                        )}
                        <Btn variant='ghost' onClick={() => router.push('/dashboard')}>
                            {t('toDashboard')}
                        </Btn>
                    </div>
                </div>
            )}
        </div>
    )
}
