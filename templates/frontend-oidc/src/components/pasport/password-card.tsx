'use client'

import { useState } from 'react'
import { ApiFailure, useApi, useData } from '@/lib/portal'
import { useTranslations } from 'next-intl'
import { useToast } from './toast'
import { Btn, ErrorNote, Field, PasswordInput } from './ui'

const MIN = 12

/**
 * Change the own password while logged in (POST /me/password). Asks the current password when the account has one;
 * an account that only logs in with the eID sets its first password here. Every other session ends afterwards.
 */
export function PasswordCard() {
    const t = useTranslations('Password')
    const push = useToast()
    const api = useApi()
    const eid = useData<{ hasPassword: boolean }>('me/eid')
    const hasPassword = eid.data?.hasPassword !== false
    const [form, setForm] = useState({ current: '', next: '', repeat: '' })
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }))

    const save = async () => {
        if (form.next.length < MIN) return setError(t('tooShort', { n: MIN }))
        if (form.next !== form.repeat) return setError(t('noMatch'))
        setBusy(true)
        setError('')
        try {
            const result = await api<{ endedSessions: number }>('me/password', 'POST', {
                ...(hasPassword ? { currentPassword: form.current } : {}),
                newPassword: form.next
            })
            setForm({ current: '', next: '', repeat: '' })
            push(
                result.endedSessions ? t('changedEnded', { count: result.endedSessions }) : t('changed'),
                'lock',
                'green'
            )
            void eid.reload()
        } catch (e) {
            setError(e instanceof ApiFailure ? e.message : t('failed'))
        } finally {
            setBusy(false)
        }
    }

    return (
        <form
            className='card card-pad'
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            onSubmit={e => {
                e.preventDefault()
                void save()
            }}
        >
            <div>
                <h2 className='t-h2'>{hasPassword ? t('title') : t('titleFirst')}</h2>
                <p style={{ fontSize: 14, marginTop: 6 }}>{hasPassword ? t('text') : t('textFirst')}</p>
            </div>
            {hasPassword && (
                <Field label={t('current')}>
                    <PasswordInput
                        icon='lock'
                        showLabel={t('show')}
                        hideLabel={t('hide')}
                        autoComplete='current-password'
                        maxLength={128}
                        value={form.current}
                        onChange={e => set('current', e.target.value)}
                        required
                    />
                </Field>
            )}
            <Field label={t('new')} hint={t('hint', { n: MIN })}>
                <PasswordInput
                    icon='key'
                    showLabel={t('show')}
                    hideLabel={t('hide')}
                    autoComplete='new-password'
                    minLength={MIN}
                    maxLength={128}
                    value={form.next}
                    onChange={e => set('next', e.target.value)}
                    required
                />
            </Field>
            <Field label={t('repeat')}>
                <PasswordInput
                    icon='key'
                    showLabel={t('show')}
                    hideLabel={t('hide')}
                    autoComplete='new-password'
                    minLength={MIN}
                    maxLength={128}
                    value={form.repeat}
                    onChange={e => set('repeat', e.target.value)}
                    required
                />
            </Field>
            <ErrorNote>{error}</ErrorNote>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Btn
                    type='submit'
                    icon='check'
                    disabled={busy || !form.next || !form.repeat || (hasPassword && !form.current)}
                >
                    {hasPassword ? t('save') : t('saveFirst')}
                </Btn>
            </div>
        </form>
    )
}
