'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { SECONDARY } from '@/components/account-ui'
import { useBackend } from '@/lib/account'

/**
 * "Ask a demo" for a product the user has no licence of: a trial for themselves (POST /me/licenses/:code/trial,
 * once per product). A demo never starts by itself, also not at the first login to the app.
 */
export function AskDemo({ code }: { code: string }) {
    const t = useTranslations('Licenses')
    const backend = useBackend()
    const router = useRouter()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')

    async function ask() {
        setBusy(true)
        setError('')
        const result = await backend(`me/licenses/${encodeURIComponent(code)}/trial`, 'POST').catch(() => null)
        setBusy(false)
        if (!result) return setError(t('offline'))
        if (result.status !== 201) return setError(result.message || t('offline'))
        router.refresh()
    }

    return (
        <span className='inline-flex flex-wrap items-center gap-2'>
            <button type='button' disabled={busy} className={SECONDARY} onClick={() => void ask()}>
                {t('askDemo')}
            </button>
            {error && <span className='text-xs text-[var(--red)]'>{error}</span>}
        </span>
    )
}
