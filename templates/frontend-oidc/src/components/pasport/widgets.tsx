'use client'

import {
    useEffect,
    useRef,
    useSyncExternalStore,
    type ClipboardEvent,
    type ChangeEvent,
    type KeyboardEvent,
    type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { Btn } from './ui'

/* ============================ MODAL ============================ */
export function Modal({
    open,
    onClose,
    title,
    children,
    footer,
    width = 480
}: {
    open: boolean
    onClose?: () => void
    title?: ReactNode
    children: ReactNode
    footer?: ReactNode
    width?: number
}) {
    // false on the server and during hydration, true in the browser: the portal needs document.body
    const mounted = useSyncExternalStore(
        () => () => undefined,
        () => true,
        () => false
    )
    useEffect(() => {
        if (!open) return
        const h = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose?.()
        window.addEventListener('keydown', h)
        return () => window.removeEventListener('keydown', h)
    }, [open, onClose])
    if (!open || !mounted) return null
    // Portal to <body>: the fixed overlay covers the whole viewport whatever transformed ancestor (.fade-in) there is
    return createPortal(
        <div className='modal-overlay' onMouseDown={onClose}>
            <div className='modal-blur' />
            <div
                className='modal'
                role='dialog'
                aria-modal='true'
                style={{ width }}
                onMouseDown={e => e.stopPropagation()}
            >
                {title && (
                    <div className='modal-head'>
                        <h3 className='t-h2'>{title}</h3>
                        <Btn variant='ghost' size='sm' icon='x' onClick={onClose} aria-label='×' />
                    </div>
                )}
                <div className='modal-body'>{children}</div>
                {footer && <div className='modal-foot'>{footer}</div>}
            </div>
        </div>,
        document.body
    )
}

/* ============================ ONE-TIME CODE (6 digits, auto-advance + paste) ============================ */
export function OtpInput({
    length = 6,
    value,
    setValue,
    onComplete,
    error,
    autoFocus,
    label
}: {
    length?: number
    value: string
    setValue: (v: string) => void
    onComplete?: (v: string) => void
    error?: boolean
    autoFocus?: boolean
    /** Accessible name of each box: receives the 1-based position. */
    label?: (n: number) => string
}) {
    const refs = useRef<(HTMLInputElement | null)[]>([])
    useEffect(() => {
        if (autoFocus) refs.current[0]?.focus()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    const chars = Array.from({ length }, (_, i) => value[i] || '')
    const change = (i: number, e: ChangeEvent<HTMLInputElement>) => {
        const d = e.target.value.replace(/\D/g, '').slice(-1)
        const arr = chars.slice()
        arr[i] = d
        const joined = arr.join('')
        setValue(joined)
        if (d && i < length - 1) refs.current[i + 1]?.focus()
        if (arr.every(c => c)) onComplete?.(joined)
    }
    const keyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace' && !chars[i] && i > 0) refs.current[i - 1]?.focus()
        if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus()
        if (e.key === 'ArrowRight' && i < length - 1) refs.current[i + 1]?.focus()
    }
    const paste = (e: ClipboardEvent) => {
        const txt = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, length)
        if (!txt) return
        e.preventDefault()
        setValue(txt)
        refs.current[Math.min(txt.length, length - 1)]?.focus()
        if (txt.length === length) onComplete?.(txt)
    }
    return (
        <div className={'otp-row' + (error ? ' error' : '')} onPaste={paste}>
            {chars.map((c, i) => (
                <input
                    key={i}
                    ref={el => {
                        refs.current[i] = el
                    }}
                    className='otp-box'
                    inputMode='numeric'
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    maxLength={1}
                    value={c}
                    onChange={e => change(i, e)}
                    onKeyDown={e => keyDown(i, e)}
                    aria-label={label ? label(i + 1) : String(i + 1)}
                />
            ))}
        </div>
    )
}

/* ============================ QR CODES ============================ */
/** A real QR code: the SVG made by the API, shown as an image (never inserted as HTML), in the design's white frame. */
export function QrSvg({ svg, size = 132, label }: { svg: string; size?: number; label: string }) {
    return (
        <div
            role='img'
            aria-label={label}
            className='qr-frame'
            style={{
                width: size,
                height: size,
                backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
            }}
        />
    )
}
