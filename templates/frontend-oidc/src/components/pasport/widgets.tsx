'use client'

import {
    useEffect,
    useRef,
    useState,
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

/**
 * The design's decorative pseudo-QR (finder patterns + hashed modules). Only used where the design shows a QR as
 * illustration of a payment method; the real payment happens on the payment page of the provider.
 */
export function QrCode({ value = '', size = 104, n = 21 }: { value?: string; size?: number; n?: number }) {
    let seed = 0
    for (let i = 0; i < value.length; i++) seed = (Math.imul(seed, 31) + value.charCodeAt(i)) >>> 0
    const rng = (x: number, y: number) => {
        let h = (seed ^ Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0
        h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
        return ((h >>> 15) & 1) === 1
    }
    const corners = [
        [0, 0],
        [n - 7, 0],
        [0, n - 7]
    ]
    const inFinder = (x: number, y: number) =>
        corners.some(([cx, cy]) => x >= cx && x < cx + 7 && y >= cy && y < cy + 7)
    const cells: ReactNode[] = []
    for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
            if (inFinder(x, y)) continue
            if (rng(x, y)) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width='1' height='1' />)
        }
    return (
        <div
            style={{
                width: size,
                height: size,
                padding: 8,
                background: '#fff',
                borderRadius: 'var(--r-sm)',
                border: '1px solid var(--border)',
                flexShrink: 0
            }}
        >
            <svg
                viewBox={`-0.5 -0.5 ${n + 1} ${n + 1}`}
                width='100%'
                height='100%'
                style={{ display: 'block', color: '#0b0f14', fill: '#0b0f14' }}
                shapeRendering='crispEdges'
                aria-hidden='true'
            >
                {cells}
                {corners.map(([cx, cy]) => (
                    <g key={`f-${cx}-${cy}`}>
                        <rect
                            x={cx}
                            y={cy}
                            width='7'
                            height='7'
                            rx='1.4'
                            fill='none'
                            stroke='currentColor'
                            strokeWidth='1'
                        />
                        <rect x={cx + 2} y={cy + 2} width='3' height='3' rx='0.6' />
                    </g>
                ))}
            </svg>
        </div>
    )
}

/* ============================ CHARTS ============================ */
let sparkId = 0
export function Sparkline({
    data,
    color = 'var(--accent)',
    w = 120,
    h = 36,
    fill = true
}: {
    data: number[]
    color?: string
    w?: number
    h?: number
    fill?: boolean
}) {
    const [id] = useState(() => 'sp' + ++sparkId)
    if (data.length < 2) return <svg width={w} height={h} />
    const max = Math.max(...data)
    const min = Math.min(...data)
    const rng = max - min || 1
    const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / rng) * (h - 4) - 2])
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
    const area = line + ` L${w} ${h} L0 ${h} Z`
    return (
        <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }} aria-hidden='true'>
            {fill && (
                <>
                    <defs>
                        <linearGradient id={id} x1='0' y1='0' x2='0' y2='1'>
                            <stop offset='0%' stopColor={color} stopOpacity='0.22' />
                            <stop offset='100%' stopColor={color} stopOpacity='0' />
                        </linearGradient>
                    </defs>
                    <path d={area} fill={`url(#${id})`} />
                </>
            )}
            <path d={line} fill='none' stroke={color} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
        </svg>
    )
}

export function BarChart({
    data,
    color = 'var(--accent)',
    h = 160,
    labels
}: {
    data: number[]
    color?: string
    h?: number
    labels?: string[]
}) {
    const max = Math.max(...data, 0) || 1
    return (
        <div className='barchart' style={{ height: h }}>
            {data.map((v, i) => (
                <div className='barchart-col' key={i}>
                    <div className='barchart-bar-wrap'>
                        <div
                            className='barchart-bar'
                            style={{ height: `${(v / max) * 100}%`, background: color, animationDelay: `${i * 50}ms` }}
                            title={String(v)}
                        />
                    </div>
                    {labels && <span className='barchart-lbl'>{labels[i]}</span>}
                </div>
            ))}
        </div>
    )
}

export function LineChart({
    series,
    w = 560,
    h = 200,
    labels = [],
    format = (v: number) => String(Math.round(v))
}: {
    series: { data: number[]; color: string }[]
    w?: number
    h?: number
    labels?: string[]
    format?: (v: number) => string
}) {
    const all = series.flatMap(s => s.data)
    const max = Math.max(...all, 0) * 1.1 || 1
    const min = 0
    const rng = max - min || 1
    const px = (i: number, n: number) => 36 + (n > 1 ? (i / (n - 1)) * (w - 48) : (w - 48) / 2)
    const py = (v: number) => h - 28 - ((v - min) / rng) * (h - 48)
    const grid = [0, 0.25, 0.5, 0.75, 1]
    return (
        <svg width='100%' viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }} aria-hidden='true'>
            {grid.map((g, i) => {
                const y = h - 28 - g * (h - 48)
                return <line key={i} x1='36' x2={w - 12} y1={y} y2={y} stroke='var(--border)' strokeWidth='1' />
            })}
            {grid.map((g, i) => (
                <text key={i} x='28' y={h - 28 - g * (h - 48) + 4} textAnchor='end' fontSize='10' fill='var(--text-3)'>
                    {format(min + g * rng)}
                </text>
            ))}
            {labels.map((l, i) => (
                <text key={i} x={px(i, labels.length)} y={h - 8} textAnchor='middle' fontSize='10' fill='var(--text-3)'>
                    {l}
                </text>
            ))}
            {series.map((s, si) => {
                const line = s.data.map((v, i) => (i ? 'L' : 'M') + px(i, s.data.length) + ' ' + py(v)).join(' ')
                return (
                    <g key={si}>
                        <path
                            d={line}
                            fill='none'
                            stroke={s.color}
                            strokeWidth='2.5'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                        />
                        {s.data.map((v, i) => (
                            <circle
                                key={i}
                                cx={px(i, s.data.length)}
                                cy={py(v)}
                                r='3'
                                fill='var(--surface)'
                                stroke={s.color}
                                strokeWidth='2'
                            />
                        ))}
                    </g>
                )
            })}
        </svg>
    )
}

export function Donut({
    segments,
    size = 150,
    thickness = 22,
    totalLabel
}: {
    segments: { value: number; color: string }[]
    size?: number
    thickness?: number
    totalLabel: string
}) {
    const sum = segments.reduce((a, s) => a + s.value, 0)
    const total = sum || 1
    const r = (size - thickness) / 2
    const c = 2 * Math.PI * r
    const offsets = segments.map((_, i) => segments.slice(0, i).reduce((a, s) => a + (s.value / total) * c, 0))
    return (
        <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
            <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden='true'>
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill='none'
                    stroke='var(--surface-3)'
                    strokeWidth={thickness}
                />
                {segments.map((s, i) => {
                    const len = (s.value / total) * c
                    const el = (
                        <circle
                            key={i}
                            cx={size / 2}
                            cy={size / 2}
                            r={r}
                            fill='none'
                            stroke={s.color}
                            strokeWidth={thickness}
                            strokeDasharray={`${len} ${c - len}`}
                            strokeDashoffset={-offsets[i]}
                            strokeLinecap='butt'
                        />
                    )
                    return el
                })}
            </svg>
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}
            >
                <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)' }}>
                    {sum}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{totalLabel}</span>
            </div>
        </div>
    )
}
