'use client'

import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { BUTTON, CARD, DANGER, INPUT, Notice } from '@/components/account-ui'

type Note = { id: string; authorId: string; text: string; createdAt: string }

/** Turns an error answer of the API (or of /api/app) into the translated message. */
async function problem(response: Response, offline: string): Promise<string> {
    const body = (await response.json().catch(() => ({}))) as { message?: string | string[]; error?: string }
    if (body.error === 'offline') return offline
    return Array.isArray(body.message) ? body.message.join('\n') : (body.message ?? offline)
}

/**
 * The notes of the organisation: the example of data of THIS app (its own API and database), per tenant. Everyone of
 * the organisation with the role editor or viewer reads them, an editor adds them (`canEdit`); only its admin removes
 * them. Through /api/app (token on the server).
 */
export function Notes({ admin, me, canEdit = true }: { admin: boolean; me: string; canEdit?: boolean }) {
    const t = useTranslations('Notes')
    const format = useFormatter()
    const [notes, setNotes] = useState<Note[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    const load = useCallback(async () => {
        const response = await fetch('/api/app/notes').catch(() => null)
        if (!response) return setError(t('offline'))
        if (!response.ok) return setError(await problem(response, t('offline')))
        setNotes((await response.json()) as Note[])
        setError(null)
    }, [t])

    useEffect(() => {
        // The first load after the page is shown; the state is set when the answer arrives
        const timer = setTimeout(() => void load(), 0)
        return () => clearTimeout(timer)
    }, [load])

    async function add(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        const text = String(new FormData(form).get('text') ?? '')
        setBusy(true)
        const response = await fetch('/api/app/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        }).catch(() => null)
        setBusy(false)
        if (!response) return setError(t('offline'))
        if (!response.ok) return setError(await problem(response, t('offline')))
        form.reset()
        await load()
    }

    async function remove(id: string) {
        const response = await fetch('/api/app/notes/' + id, { method: 'DELETE' }).catch(() => null)
        if (!response) return setError(t('offline'))
        if (!response.ok) return setError(await problem(response, t('offline')))
        await load()
    }

    return (
        <section className={CARD}>
            <div className='flex flex-col gap-1.5'>
                <h2 className='text-lg font-semibold tracking-tight'>{t('title')}</h2>
                <div className='text-sm text-[var(--text-2)]'>{t('text')}</div>
            </div>
            {!canEdit && <div className='text-sm text-[var(--text-3)]'>{t('readOnly')}</div>}
            {canEdit && (
                <form onSubmit={add} className='flex flex-wrap gap-2.5'>
                    <input
                        name='text'
                        required
                        maxLength={2000}
                        placeholder={t('placeholder')}
                        aria-label={t('placeholder')}
                        className={INPUT + ' min-w-56 flex-1'}
                    />
                    <button type='submit' disabled={busy} className={BUTTON}>
                        {t('add')}
                    </button>
                </form>
            )}
            {error && <Notice tone='error'>{error}</Notice>}
            {notes && notes.length === 0 && <div className='text-sm text-[var(--text-3)]'>{t('empty')}</div>}
            {notes && notes.length > 0 && (
                <ul className='flex flex-col divide-y divide-[var(--border)]'>
                    {notes.map(note => (
                        <li key={note.id} className='flex items-start justify-between gap-3 py-3'>
                            <div className='flex min-w-0 flex-col gap-0.5'>
                                <span className='text-sm break-words'>{note.text}</span>
                                <span className='text-xs text-[var(--text-3)]'>
                                    {note.authorId === me ? t('byYou') : t('byColleague')} ·{' '}
                                    {format.dateTime(new Date(note.createdAt), {
                                        dateStyle: 'medium',
                                        timeStyle: 'short'
                                    })}
                                </span>
                            </div>
                            {admin && (
                                <button type='button' className={DANGER} onClick={() => void remove(note.id)}>
                                    {t('remove')}
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    )
}
