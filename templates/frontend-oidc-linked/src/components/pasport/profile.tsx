'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { ApiFailure, type Billing, type Profile as ProfileData, useApi, useData } from '@/lib/portal'
import { LoadError, Loading } from './page-state'
import { useSwitchLocale, useToast } from './toast'
import { Avatar, Badge, Btn, Field, Icon, Input, Select } from './ui'

type Form = {
    firstName: string
    lastName: string
    email: string
    phone: string
    locale: string
    company: string
    vat: string
    billingAddress: string
    billingEmail: string
}

const LOCALES = ['nl', 'fr', 'en', 'de'] as const

function toForm(p: ProfileData, b: Billing | null, locale: string): Form {
    const [first = '', ...rest] = (p.name ?? '').split(' ')
    return {
        firstName: p.firstName ?? first,
        lastName: p.lastName ?? rest.join(' '),
        email: p.email,
        phone: p.phone ?? '',
        locale: p.locale ?? locale,
        company: b?.company ?? '',
        vat: b?.vat ?? '',
        billingAddress: b?.billingAddress ?? '',
        billingEmail: b?.billingEmail ?? ''
    }
}

/**
 * The own profile (GET and PATCH /me/profile): /profile for an account of an organisation (with the billing details of
 * the organisation, its admins change them, and what the eID says) and /admin/profile for a superadmin.
 */
export function Profile({ variant = 'customer' }: { variant?: 'customer' | 'admin' }) {
    const profile = useData<ProfileData>('me/profile')
    const isCustomer = variant === 'customer'
    const billing = useData<Billing>(isCustomer && profile.data?.tenant ? 'tenants/current/billing' : null)

    if (profile.loading && !profile.data) return <Loading />
    if (profile.error && !profile.data)
        return <LoadError message={profile.error.message} onRetry={() => void profile.reload()} />
    const p = profile.data
    // The form starts from the loaded data: wait for the billing details of a customer too
    if (!p || (isCustomer && p.tenant && !billing.data && !billing.error)) return <Loading />
    return (
        <ProfileForm
            p={p}
            billing={billing.data}
            isCustomer={isCustomer}
            onProfile={profile.setData}
            onBilling={billing.setData}
        />
    )
}

function ProfileForm({
    p,
    billing,
    isCustomer,
    onProfile,
    onBilling
}: {
    p: ProfileData
    billing: Billing | null
    isCustomer: boolean
    onProfile: (next: ProfileData) => void
    onBilling: (next: Billing) => void
}) {
    const t = useTranslations('Profile')
    const languages = { nl: t('lang_nl'), fr: t('lang_fr'), en: t('lang_en'), de: t('lang_de') }
    const push = useToast()
    const api = useApi()
    const locale = useLocale()
    const switchLocale = useSwitchLocale()
    const router = useRouter()
    const [form, setForm] = useState<Form>(() => toForm(p, billing, locale))
    const [dirty, setDirty] = useState(false)
    const [busy, setBusy] = useState(false)
    const [touched, setTouched] = useState(false)

    const reset = () => {
        setForm(toForm(p, billing, locale))
        setDirty(false)
        setTouched(false)
    }
    const admin = p.tenant?.role === 'admin'
    const set = (k: keyof Form, v: string) => {
        setForm(f => ({ ...f, [k]: v }))
        setDirty(true)
    }
    const name = [form.firstName, form.lastName].filter(Boolean).join(' ') || p.name
    const emailValid = /^\S+@\S+\.\S+$/.test(form.email.trim())
    const phoneValid = !form.phone.trim() || /^\+?[\d][\d\s./-]{7,}$/.test(form.phone.trim())
    const errStyle = (bad: boolean) => (touched && bad ? { borderColor: 'var(--red)' } : undefined)

    const save = async () => {
        setTouched(true)
        if (!emailValid || !phoneValid || !form.firstName.trim()) return
        setBusy(true)
        try {
            const next = await api<ProfileData>('me/profile', 'PATCH', {
                firstName: form.firstName.trim(),
                lastName: form.lastName.trim(),
                phone: form.phone.trim(),
                locale: form.locale,
                ...(form.email.trim().toLowerCase() !== p.email.toLowerCase() ? { email: form.email.trim() } : {})
            })
            if (isCustomer && admin) {
                const b = billing
                if (
                    !b ||
                    b.company !== form.company ||
                    b.vat !== form.vat ||
                    b.billingAddress !== form.billingAddress ||
                    b.billingEmail !== form.billingEmail
                )
                    onBilling(
                        await api<Billing>('tenants/current/billing', 'PATCH', {
                            company: form.company.trim() || null,
                            vat: form.vat.trim() || null,
                            billingAddress: form.billingAddress.trim() || null,
                            billingEmail: form.billingEmail.trim() || null
                        })
                    )
            }
            onProfile(next)
            setDirty(false)
            push(
                next.pendingEmail ? t('savedConfirmEmail', { email: next.pendingEmail }) : t('saved'),
                'check',
                'green'
            )
            if (form.locale !== locale) switchLocale(form.locale)
            // The shell (server layout) shows the name of the profile: render it again with the new name
            else router.refresh()
        } catch (e) {
            push(e instanceof ApiFailure ? e.message : t('failed'), 'alert', 'red')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className='fade-in' style={{ maxWidth: isCustomer ? 760 : 720, margin: '0 auto' }}>
            <div className='page-head'>
                <div className='ph-text'>
                    <h1>{isCustomer ? t('title') : t('adminTitle')}</h1>
                    <p>{isCustomer ? t('subtitle') : t('adminSubtitle')}</p>
                </div>
            </div>

            <div className='card card-pad' style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 20 }}>
                <Avatar name={name} size={62} color={isCustomer ? null : 'var(--text)'} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: '-0.02em' }}>{name}</div>
                    <div className='t-muted' style={{ fontSize: 13.5 }}>
                        {p.email}
                    </div>
                </div>
                {!isCustomer ? (
                    <Badge tone='blue' icon='shield'>
                        {t('superadmin')}
                    </Badge>
                ) : p.eid.linked ? (
                    <Badge tone='accent' icon='shieldCheck'>
                        {t('verifiedEid')}
                    </Badge>
                ) : p.emailVerified ? (
                    <Badge tone='green' icon='check'>
                        {t('verifiedEmail')}
                    </Badge>
                ) : (
                    <Badge tone='amber' icon='alert'>
                        {t('unverified')}
                    </Badge>
                )}
            </div>

            <div
                className='card card-pad'
                style={{ display: 'flex', flexDirection: 'column', gap: 18, marginBottom: isCustomer ? 20 : 0 }}
            >
                <div className='t-eyebrow'>{isCustomer ? t('personal') : t('account')}</div>
                <div className='form-grid'>
                    <Field
                        label={t('firstName')}
                        required={!isCustomer}
                        hint={touched && !form.firstName.trim() ? t('required') : null}
                        error
                    >
                        <Input
                            value={form.firstName}
                            autoComplete='given-name'
                            onChange={e => set('firstName', e.target.value)}
                            style={errStyle(!form.firstName.trim())}
                        />
                    </Field>
                    <Field label={t('lastName')} required={!isCustomer}>
                        <Input
                            value={form.lastName}
                            autoComplete='family-name'
                            onChange={e => set('lastName', e.target.value)}
                        />
                    </Field>
                    <Field
                        label={t('email')}
                        required={!isCustomer}
                        hint={
                            touched && !emailValid
                                ? t('invalidEmail')
                                : p.pendingEmail
                                  ? t('pendingEmail', { email: p.pendingEmail })
                                  : null
                        }
                        error={touched && !emailValid}
                    >
                        <Input
                            type='email'
                            icon='mail'
                            autoComplete='email'
                            value={form.email}
                            onChange={e => set('email', e.target.value)}
                            style={errStyle(!emailValid)}
                        />
                    </Field>
                    <Field label={t('phone')} hint={touched && !phoneValid ? t('invalidPhone') : null} error>
                        <Input
                            icon='phone'
                            autoComplete='tel'
                            placeholder='+32 4xx xx xx xx'
                            value={form.phone}
                            onChange={e => set('phone', e.target.value)}
                            style={errStyle(!phoneValid)}
                        />
                    </Field>
                    <Field label={t('language')}>
                        <Select className='select' value={form.locale} onChange={e => set('locale', e.target.value)}>
                            {LOCALES.map(l => (
                                <option key={l} value={l}>
                                    {languages[l]}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    {!isCustomer && (
                        <Field label={t('role')}>
                            <Input value={t('superadmin')} disabled />
                        </Field>
                    )}
                </div>
            </div>

            {isCustomer && p.tenant && (
                <div
                    className='card card-pad'
                    style={{ display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 20 }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <div className='t-eyebrow'>{t('billing')}</div>
                        {admin ? (
                            <Badge tone='accent' icon='invoice'>
                                {t('forPayments')}
                            </Badge>
                        ) : (
                            <Badge tone='neutral' icon='lock'>
                                {t('adminCanChange')}
                            </Badge>
                        )}
                    </div>
                    <div className='form-grid'>
                        <Field label={t('company')}>
                            <Input
                                value={form.company}
                                disabled={!admin}
                                onChange={e => set('company', e.target.value)}
                                placeholder={t('companyPlaceholder')}
                            />
                        </Field>
                        <Field label={t('vat')}>
                            <Input
                                className='t-mono'
                                value={form.vat}
                                disabled={!admin}
                                onChange={e => set('vat', e.target.value)}
                                placeholder='BE 0XXX.XXX.XXX'
                            />
                        </Field>
                        <div style={{ gridColumn: '1 / -1' }}>
                            <Field label={t('billingAddress')}>
                                <Input
                                    icon='building'
                                    value={form.billingAddress}
                                    disabled={!admin}
                                    onChange={e => set('billingAddress', e.target.value)}
                                    placeholder={t('addressPlaceholder')}
                                />
                            </Field>
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                            <Field label={t('billingEmail')} hint={t('billingEmailHint')}>
                                <Input
                                    icon='mail'
                                    type='email'
                                    value={form.billingEmail}
                                    disabled={!admin}
                                    onChange={e => set('billingEmail', e.target.value)}
                                    placeholder='finance@example.com'
                                />
                            </Field>
                        </div>
                    </div>
                </div>
            )}

            {isCustomer && p.eid.linked && (
                <div className='card card-pad' style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div className='t-eyebrow'>{t('fromEid')}</div>
                        <Badge tone='neutral' icon='lock'>
                            {t('readOnly')}
                        </Badge>
                    </div>
                    <div className='form-grid'>
                        <Field
                            label={
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    {t('rrn')} <Icon name='shieldCheck' size={13} style={{ color: 'var(--accent)' }} />
                                </span>
                            }
                        >
                            <Input className='t-mono' value={p.eid.rrn ?? '—'} disabled />
                        </Field>
                        <Field label={t('address')}>
                            <Input value={p.eid.address ?? '—'} disabled />
                        </Field>
                    </div>
                    <p className='hint'>{t('eidHint')}</p>
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
                <Btn variant='ghost' disabled={!dirty || busy} onClick={reset}>
                    {t('cancel')}
                </Btn>
                <Btn variant='primary' icon='check' disabled={!dirty || busy} onClick={() => void save()}>
                    {isCustomer ? t('save') : t('saveAdmin')}
                </Btn>
            </div>
        </div>
    )
}
