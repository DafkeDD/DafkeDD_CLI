'use client'

import { useState } from 'react'
import { ApiFailure, type AwayNotice, type OutOfOffice, type OwnPresence, useApi, useFormat } from '@/lib/portal'
import { useT } from './i18n'
import { useToast } from './toast'
import { Btn, Field, Icon, Input, Toggle } from './ui'
import { Modal } from './widgets'

/** An ISO moment as the value of <input type="datetime-local"> (local time), and back. */
function toLocal(iso: string | null) {
    if (!iso) return ''
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocal = (value: string) => (value ? new Date(value).toISOString() : null)

/** "Afwezigheidsbericht" (like Outlook): on or off, an optional period, a message for colleagues and one for customers. */
export function OutOfOfficeDialog({
    open,
    value,
    onClose,
    onSaved
}: {
    open: boolean
    value: OutOfOffice | null
    onClose: () => void
    onSaved: (next: OwnPresence) => void
}) {
    const t = useT('Presence')
    return (
        <Modal open={open} onClose={onClose} title={t('oooMenu')} width={540}>
            {/* A fresh form every time it opens: it starts from what is saved */}
            {open && <OutOfOfficeForm value={value} onClose={onClose} onSaved={onSaved} />}
        </Modal>
    )
}

function OutOfOfficeForm({
    value,
    onClose,
    onSaved
}: {
    value: OutOfOffice | null
    onClose: () => void
    onSaved: (next: OwnPresence) => void
}) {
    const t = useT('Presence')
    const api = useApi()
    const push = useToast()
    const [enabled, setEnabled] = useState(value?.enabled ?? true)
    const [from, setFrom] = useState(toLocal(value?.from ?? null))
    const [until, setUntil] = useState(toLocal(value?.until ?? null))
    const [internal, setInternal] = useState(value?.internalMessage ?? '')
    const [external, setExternal] = useState(value?.externalMessage ?? '')
    const [busy, setBusy] = useState(false)
    const datesWrong = Boolean(from && until && new Date(until).getTime() <= new Date(from).getTime())

    const save = async () => {
        if (datesWrong || busy) return
        setBusy(true)
        try {
            const next = await api<OwnPresence>('me/out-of-office', 'PUT', {
                enabled,
                from: fromLocal(from),
                until: fromLocal(until),
                internalMessage: internal.trim() || null,
                externalMessage: external.trim() || null
            })
            onSaved(next)
            push(enabled ? t('oooSaved') : t('oooTurnedOff'), 'check', 'green')
            onClose()
        } catch (e) {
            push(e instanceof ApiFailure ? e.message : t('oooFailed'), 'alert', 'red')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p className='hint' style={{ margin: 0 }}>
                {t('oooIntro')}
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <Toggle on={enabled} onClick={() => setEnabled(on => !on)} />
                <span style={{ fontWeight: 600, fontSize: 14 }}>{t('oooEnabled')}</span>
            </label>
            <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                    <Field label={t('oooFrom')} htmlFor='ooo-from'>
                        <Input
                            id='ooo-from'
                            type='datetime-local'
                            value={from}
                            onChange={e => setFrom(e.target.value)}
                            disabled={!enabled}
                        />
                    </Field>
                    <Field label={t('oooUntil')} htmlFor='ooo-until' error={datesWrong}>
                        <Input
                            id='ooo-until'
                            type='datetime-local'
                            value={until}
                            onChange={e => setUntil(e.target.value)}
                            disabled={!enabled}
                        />
                    </Field>
                </div>
                <div className='hint' style={{ marginTop: 6, color: datesWrong ? 'var(--red)' : undefined }}>
                    {datesWrong ? t('oooDates') : t('oooPeriodHint')}
                </div>
            </div>
            <Field label={t('oooInternal')} htmlFor='ooo-internal'>
                <textarea
                    id='ooo-internal'
                    className='textarea'
                    rows={3}
                    maxLength={1000}
                    placeholder={t('oooInternalPh')}
                    value={internal}
                    onChange={e => setInternal(e.target.value)}
                    disabled={!enabled}
                />
            </Field>
            <Field label={t('oooExternal')} htmlFor='ooo-external'>
                <textarea
                    id='ooo-external'
                    className='textarea'
                    rows={3}
                    maxLength={1000}
                    placeholder={t('oooExternalPh')}
                    value={external}
                    onChange={e => setExternal(e.target.value)}
                    disabled={!enabled}
                />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Btn variant='secondary' onClick={onClose}>
                    {t('oooCancel')}
                </Btn>
                <Btn variant='primary' icon='check' disabled={busy || datesWrong} onClick={() => void save()}>
                    {t('oooSave')}
                </Btn>
            </div>
        </div>
    )
}

/** "Davey is afwezig tot ma 27 okt." with the message for the reader (colleagues or customers). */
export function OutOfOfficeNotice({ name, notice }: { name: string; notice: AwayNotice }) {
    const t = useT('Presence')
    const f = useFormat()
    return (
        <div className='ooo-notice' role='status'>
            <span className='presence-dot-inline presence-ooo' style={{ marginTop: 4 }} />
            <div style={{ minWidth: 0 }}>
                <strong>
                    {notice.until
                        ? t('oooNoticeUntil', { name, date: f.dateTime(notice.until) })
                        : t('oooNotice', { name })}
                </strong>
                {notice.message && <div className='ooo-notice-msg'>{notice.message}</div>}
            </div>
            <Icon name='calendar' size={15} style={{ marginLeft: 'auto', flex: 'none', color: 'var(--violet)' }} />
        </div>
    )
}
