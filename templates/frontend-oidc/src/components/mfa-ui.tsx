'use client'

import { useState } from 'react'
import { SECONDARY } from '@/components/account-ui'

/**
 * The QR code for the authenticator app (an SVG made by the API, shown as an image: never inserted as HTML) and the
 * secret to type in by hand, in groups of four characters.
 */
export function MfaQr({
    qrSvg,
    secret,
    label,
    secretLabel
}: {
    qrSvg: string
    secret: string
    label: string
    secretLabel: string
}) {
    return (
        <div className='flex flex-col items-center gap-3'>
            <div
                role='img'
                aria-label={label}
                className='size-48 rounded-[var(--r-md)] bg-white bg-contain bg-center bg-no-repeat p-2'
                style={{
                    backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}")`,
                    backgroundOrigin: 'content-box'
                }}
            />
            <div className='flex flex-col items-center gap-1 text-center'>
                <span className='text-xs text-[var(--text-3)]'>{secretLabel}</span>
                <code className='font-mono text-sm tracking-wider break-all select-all'>
                    {secret.replace(/(.{4})/g, '$1 ').trim()}
                </code>
            </div>
        </div>
    )
}

/** Recovery codes in two columns, with a copy button (they are shown only once). */
export function RecoveryCodes({
    codes,
    copyLabel,
    copiedLabel
}: {
    codes: string[]
    copyLabel: string
    copiedLabel: string
}) {
    const [copied, setCopied] = useState(false)
    return (
        <div className='flex flex-col gap-2.5'>
            <ul className='grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-[var(--r-md)] border border-[var(--border)] px-4 py-3 font-mono text-sm'>
                {codes.map(code => (
                    <li key={code}>{code}</li>
                ))}
            </ul>
            <button
                type='button'
                className={SECONDARY + ' self-start'}
                onClick={() => {
                    void navigator.clipboard
                        ?.writeText(codes.join('\n'))
                        .then(() => setCopied(true))
                        .catch(() => undefined)
                }}
            >
                {copied ? copiedLabel : copyLabel}
            </button>
        </div>
    )
}
