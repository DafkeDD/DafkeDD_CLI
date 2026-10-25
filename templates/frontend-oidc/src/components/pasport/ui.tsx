'use client'

import {
    Children,
    createContext,
    isValidElement,
    useContext,
    useEffect,
    useId,
    useRef,
    useState,
    type ButtonHTMLAttributes,
    type CSSProperties,
    type InputHTMLAttributes,
    type ReactElement,
    type ReactNode
} from 'react'
import type { ShownPresence } from '@/lib/portal'
import { createPortal } from 'react-dom'

/**
 * The building blocks of the Pasport design (src/styles/pasport.css): icons, buttons, fields, the select, badges, the
 * avatar and the notes. Every screen of the login server and of its apps uses them.
 */

/* ============================ ICONS (1:1 from the design) ============================ */
/** The icons of the design (name: SVG path); a page in APP_NAV (src/lib/nav.ts) names one of these. */
export const ICONS: Record<string, string> = {
    dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
    home: 'M3 10l9-7 9 7v10a2 2 0 01-2 2h-4v-7H9v7H5a2 2 0 01-2-2z',
    archive: 'M21 8v13H3V8 M1 3h22v5H1z M10 12h4',
    grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
    qrcode: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h2v2h-2z M18 14h2v2h-2z M14 18h2v2h-2z M18 18h2v2h-2z',
    compass: 'M12 22a10 10 0 100-20 10 10 0 000 20zM16.2 7.8l-2.9 6.4-6.4 2.9 2.9-6.4z',
    user: 'M20 21a8 8 0 10-16 0 M12 11a4 4 0 100-8 4 4 0 000 8',
    users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8 M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75',
    building: 'M3 21h18 M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16 M9 7h2 M13 7h2 M9 11h2 M13 11h2 M9 15h2 M13 15h2',
    check: 'M20 6L9 17l-5-5',
    checkCircle: 'M22 11.08V12a10 10 0 11-5.93-9.14 M22 4L12 14.01l-3-3',
    x: 'M18 6L6 18M6 6l12 12',
    plus: 'M12 5v14M5 12h14',
    arrowRight: 'M5 12h14M12 5l7 7-7 7',
    arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
    chevronRight: 'M9 18l6-6-6-6',
    chevronDown: 'M6 9l6 6 6-6',
    search: 'M21 21l-4.35-4.35 M11 19a8 8 0 100-16 8 8 0 000 16z',
    settings:
        'M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z',
    logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4 M16 17l5-5-5-5 M21 12H9',
    creditcard: 'M1 4h22v16H1z M1 10h22',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    shieldCheck: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4',
    idcard: 'M3 5h18v14H3z M7 10a2 2 0 104 0 2 2 0 00-4 0 M6 16c.5-1.5 2-2 3-2s2.5.5 3 2 M14 9h4 M14 13h4',
    lock: 'M5 11h14v10H5z M8 11V7a4 4 0 018 0v4',
    mail: 'M2 5h20v14H2z M2 6l10 7 10-7',
    phone: 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z',
    calendar: 'M3 5h18v16H3z M3 9h18 M8 3v4 M16 3v4',
    checklist: 'M9 6h11 M9 12h11 M9 18h11 M4 6l1 1 2-2 M4 12l1 1 2-2 M4 18l1 1 2-2',
    invoice: 'M5 3h11l3 3v15H5z M9 8h6 M9 12h6 M9 16h4',
    chart: 'M3 3v18h18 M7 14l3-3 3 3 5-6',
    chartbar: 'M3 3v18h18 M8 17V9 M13 17V5 M18 17v-6',
    database:
        'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3z M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5 M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
    box: 'M21 8l-9-5-9 5 9 5 9-5z M3 8v8l9 5 9-5V8 M12 13v8',
    server: 'M4 2h16a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2z M4 14h16a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4a2 2 0 012-2z M6 6h.01 M6 18h.01',
    ticket: 'M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 000-4z M12 6v12',
    sparkles:
        'M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z',
    euro: 'M18 7a6 6 0 00-9.6 3 M18 17a6 6 0 01-9.6-3 M4 10h8 M4 14h7',
    roster: 'M3 5h18v14H3z M3 9h18 M9 5v14 M15 5v14',
    sun: 'M12 17a5 5 0 100-10 5 5 0 000 10z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4',
    moon: 'M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z',
    trash: 'M3 6h18 M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2 M19 6l-1 14H6L5 6 M10 11v6 M14 11v6',
    edit: 'M11 4H4v16h16v-7 M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z',
    copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
    external: 'M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6 M15 3h6v6 M10 14L21 3',
    eid: 'M3 5h18v14H3z M7 9h4v6H7z M14 9h4 M14 12h4 M14 15h3',
    itsme: 'M12 2a10 10 0 100 20 10 10 0 000-20z M12 7v5l3 3',
    alert: 'M12 9v4 M12 17h.01 M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
    info: 'M12 22a10 10 0 100-20 10 10 0 000 20z M12 16v-4 M12 8h.01',
    pause: 'M6 4h4v16H6z M14 4h4v16h-4z',
    play: 'M5 3l14 9-14 9z',
    loader: 'M12 2v4 M12 18v4 M4.9 4.9l2.8 2.8 M16.3 16.3l2.8 2.8 M2 12h4 M18 12h4 M4.9 19.1l2.8-2.8 M16.3 7.7l2.8-2.8',
    filter: 'M22 3H2l8 9.5V19l4 2v-8.5z',
    key: 'M21 2l-2 2 M15 7a4 4 0 11-5.66 5.66L3 19l2 2 1-1 1 1 1-1 1 1 2-2-1-1 4.34-4.34A4 4 0 0115 7z',
    bell: 'M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.7 21a2 2 0 01-3.4 0',
    vault: 'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z M12 10a2 2 0 100 4 2 2 0 000-4z M16 12h3 M5 12h3',
    upload: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
    eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 100 6 3 3 0 000-6z',
    eyeOff: 'M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94 M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19 M1 1l22 22',
    fileKey: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M10 14a2 2 0 104 0 2 2 0 00-4 0 M12 16v3',
    globe: 'M12 22a10 10 0 100-20 10 10 0 000 20z M2 12h20 M12 2a15 15 0 010 20 15 15 0 010-20z',
    refresh: 'M23 4v6h-6 M1 20v-6h6 M3.5 9a9 9 0 0114.85-3.36L23 10 M1 14l4.65 4.36A9 9 0 0020.5 15',
    more: 'M12 13a1 1 0 100-2 1 1 0 000 2z M19 13a1 1 0 100-2 1 1 0 000 2z M5 13a1 1 0 100-2 1 1 0 000 2z',
    menu: 'M3 12h18 M3 6h18 M3 18h18',
    layers: 'M12 2l9 5-9 5-9-5 9-5z M3 12l9 5 9-5 M3 17l9 5 9-5',
    clock: 'M12 22a10 10 0 100-20 10 10 0 000 20z M12 6v6l4 2',
    pencil: 'M12 20h9 M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z',
    message: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
    atSign: 'M16 12a4 4 0 10-8 0 4 4 0 008 0z M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94',
    // Not in the design, needed for existing features (passkeys, sessions, audit, OIDC apps)
    fingerprint:
        'M12 11v3a8 8 0 01-1.5 4.7 M8 10a4 4 0 018 0v2 M5 13a7 7 0 0114 0 M3 9a11 11 0 0118 0 M16 14v1a12 12 0 01-1 4.5',
    monitor: 'M2 4h20v13H2z M8 21h8 M12 17v4',
    activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
    code: 'M16 18l6-6-6-6 M8 6l-6 6 6 6',
    bold: 'M6 4h8a4 4 0 0 1 0 8H6z M6 12h9a4 4 0 0 1 0 8H6z',
    italic: 'M19 4h-9 M14 20H5 M15 4L9 20',
    strike: 'M16 4H9a3 3 0 0 0-2.83 4 M14 12a4 4 0 0 1 0 8H6 M4 12h16',
    listBullet: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
    listOrdered: 'M10 6h11 M10 12h11 M10 18h11 M4 6h1v4 M4 10h2 M6 18H4c0-1 2-2 2-3s-1-1.5-2-1',
    link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
    image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21',
    star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
}

export function Icon({
    name,
    size = 18,
    style,
    className,
    strokeWidth = 2
}: {
    name: string
    size?: number
    style?: CSSProperties
    className?: string
    strokeWidth?: number
}) {
    const d = ICONS[name] || ICONS.box
    const isFill = name === 'play'
    return (
        <svg
            className={className}
            width={size}
            height={size}
            viewBox='0 0 24 24'
            fill={isFill ? 'currentColor' : 'none'}
            stroke={isFill ? 'none' : 'currentColor'}
            strokeWidth={strokeWidth}
            strokeLinecap='round'
            strokeLinejoin='round'
            style={style}
            aria-hidden='true'
        >
            {d.split(' M').map((seg, i) => (
                <path key={i} d={i === 0 ? seg : 'M' + seg} />
            ))}
        </svg>
    )
}

/* ============================ PRIMITIVES ============================ */
export type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export function Btn({
    variant = 'primary',
    size,
    icon,
    iconRight,
    children,
    className = '',
    type = 'button',
    ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: BtnVariant
    size?: 'sm' | 'lg'
    icon?: string
    iconRight?: string
}) {
    const cls = ['btn', `btn-${variant}`, size ? `btn-${size}` : '', !children ? 'btn-icon' : '', className]
        .filter(Boolean)
        .join(' ')
    return (
        <button type={type} className={cls} {...p}>
            {icon && <Icon name={icon} size={size === 'sm' ? 15 : 16} />}
            {children}
            {iconRight && <Icon name={iconRight} size={size === 'sm' ? 15 : 16} />}
        </button>
    )
}

/** The id of the input of a Field (its label points at it) and of its hint. */
const FieldContext = createContext<{ id: string; hintId?: string } | null>(null)

export function Field({
    label,
    hint,
    htmlFor,
    children,
    required,
    badge,
    error
}: {
    label?: ReactNode
    hint?: ReactNode
    htmlFor?: string
    children: ReactNode
    required?: boolean
    badge?: ReactNode
    /** Shows the hint in red (validation message). */
    error?: boolean
}) {
    // The label belongs to the Input inside (also without an id): screen readers read it, a click focuses the field
    const generated = useId()
    const id = htmlFor ?? generated
    const hintId = hint ? id + '-hint' : undefined
    return (
        <FieldContext.Provider value={{ id, hintId }}>
            <div className='field'>
                {label && (
                    <label className='label' htmlFor={id}>
                        {label}
                        {required && <span style={{ color: 'var(--red)' }}>*</span>}
                        {badge}
                    </label>
                )}
                {children}
                {hint && (
                    <span id={hintId} className='hint' style={error ? { color: 'var(--red)' } : undefined}>
                        {hint}
                    </span>
                )}
            </div>
        </FieldContext.Provider>
    )
}

export function Input({ icon, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { icon?: string }) {
    const field = useContext(FieldContext)
    const cls = ['input', className].filter(Boolean).join(' ')
    const props = {
        id: field?.id,
        'aria-describedby': field?.hintId,
        ...p
    }
    if (icon)
        return (
            <div className='input-icon-wrap'>
                <Icon name={icon} />
                <input className={cls} {...props} />
            </div>
        )
    return <input className={cls} {...props} />
}

/** A password field with an eye button to show or hide what was typed. */
export function PasswordInput({
    icon = 'lock',
    showLabel,
    hideLabel,
    style,
    ...p
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { icon?: string; showLabel: string; hideLabel: string }) {
    const [visible, setVisible] = useState(false)
    return (
        <div style={{ position: 'relative' }}>
            <Input icon={icon} type={visible ? 'text' : 'password'} style={{ paddingRight: 40, ...style }} {...p} />
            <button
                type='button'
                className='pw-eye'
                onClick={() => setVisible(v => !v)}
                aria-label={visible ? hideLabel : showLabel}
                aria-pressed={visible}
                title={visible ? hideLabel : showLabel}
            >
                <Icon name={visible ? 'eyeOff' : 'eye'} size={16} />
            </button>
        </div>
    )
}

export function Toggle({ on, onClick, disabled }: { on?: boolean; onClick?: () => void; disabled?: boolean }) {
    return (
        <button
            type='button'
            className='toggle'
            data-on={!!on}
            onClick={onClick}
            disabled={disabled}
            role='switch'
            aria-checked={!!on}
            style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
        />
    )
}

/* ---------- Select (custom dropdown, portal menu) ----------
   Same API as <select className="select">…<option>…</select>: `value`, `onChange(e)` with e.target.value. */
type OptionElement = ReactElement<{ value?: string | number; children?: ReactNode }>
export function Select({
    value,
    defaultValue,
    onChange,
    children,
    className = '',
    style,
    disabled,
    placeholder,
    ariaLabel
}: {
    value?: string | number
    defaultValue?: string | number
    onChange?: (e: { target: { value: string } }) => void
    children?: ReactNode
    className?: string
    style?: CSSProperties
    disabled?: boolean
    placeholder?: string
    ariaLabel?: string
}) {
    const [open, setOpen] = useState(false)
    const [coords, setCoords] = useState<{
        left: number
        width: number
        top: number | null
        bottom: number | null
        maxH: number
    } | null>(null)
    const btnRef = useRef<HTMLButtonElement>(null)
    const opts = Children.toArray(children)
        .filter((c): c is OptionElement => isValidElement(c) && c.type === 'option')
        .map(c => {
            const ch = c.props.children
            const label = Array.isArray(ch)
                ? ch.map(x => (x == null ? '' : String(x))).join('')
                : ch == null
                  ? ''
                  : String(ch)
            const val = c.props.value !== undefined ? String(c.props.value) : label
            return { value: val, label }
        })
    const controlled = value !== undefined
    const [internal, setInternal] = useState<string | undefined>(
        defaultValue !== undefined ? String(defaultValue) : undefined
    )
    const selValue = controlled ? String(value) : internal
    const current = opts.find(o => o.value === selValue)

    const place = () => {
        if (!btnRef.current) return
        const r = btnRef.current.getBoundingClientRect()
        const gap = 4
        const vh = window.innerHeight
        const wanted = Math.min(opts.length * 38 + 10, 300)
        const below = vh - r.bottom - 8
        const above = r.top - 8
        const up = below < wanted && above > below
        setCoords({
            left: r.left,
            width: r.width,
            top: up ? null : Math.round(r.bottom + gap),
            bottom: up ? Math.round(vh - r.top + gap) : null,
            maxH: Math.max(120, Math.round(up ? above : below))
        })
    }
    const toggle = () => {
        if (disabled) return
        if (!open) place()
        setOpen(o => !o)
    }
    useEffect(() => {
        if (!open) return
        const onDoc = (e: MouseEvent) => {
            const t = e.target as HTMLElement
            if (btnRef.current && !btnRef.current.contains(t) && !t.closest?.('.sel-menu')) setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation()
                setOpen(false)
            }
        }
        const reflow = () => place()
        document.addEventListener('mousedown', onDoc, true)
        document.addEventListener('keydown', onKey, true)
        window.addEventListener('resize', reflow, true)
        window.addEventListener('scroll', reflow, true)
        return () => {
            document.removeEventListener('mousedown', onDoc, true)
            document.removeEventListener('keydown', onKey, true)
            window.removeEventListener('resize', reflow, true)
            window.removeEventListener('scroll', reflow, true)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])
    const pick = (v: string) => {
        setOpen(false)
        if (!controlled) setInternal(v)
        onChange?.({ target: { value: v } })
    }

    return (
        <>
            <button
                type='button'
                ref={btnRef}
                disabled={disabled}
                onClick={toggle}
                style={style}
                aria-label={ariaLabel}
                className={
                    'select sel-trigger' +
                    (className ? ' ' + className.replace('select', '').trim() : '') +
                    (current ? '' : ' placeholder') +
                    (open ? ' open' : '')
                }
                aria-haspopup='listbox'
                aria-expanded={open}
            >
                <span>{current ? current.label : placeholder || (opts[0] && opts[0].label) || ''}</span>
            </button>
            {open &&
                coords &&
                typeof document !== 'undefined' &&
                createPortal(
                    <div
                        className='sel-menu'
                        role='listbox'
                        style={{
                            left: coords.left,
                            width: coords.width,
                            top: coords.top != null ? coords.top : 'auto',
                            bottom: coords.bottom != null ? coords.bottom : 'auto',
                            maxHeight: coords.maxH
                        }}
                    >
                        {opts.map((o, i) => {
                            const active = o.value === selValue
                            return (
                                <button
                                    key={i}
                                    type='button'
                                    role='option'
                                    aria-selected={active}
                                    className={'sel-option' + (active ? ' sel-active' : '')}
                                    onClick={() => pick(o.value)}
                                >
                                    <span>{o.label}</span>
                                    {active && (
                                        <span className='sel-check'>
                                            <Icon name='check' size={15} />
                                        </span>
                                    )}
                                </button>
                            )
                        })}
                    </div>,
                    document.body
                )}
        </>
    )
}

export type Tone = 'neutral' | 'accent' | 'green' | 'amber' | 'red' | 'blue' | 'violet'
export function Badge({
    tone = 'neutral',
    dot,
    icon,
    children,
    style,
    title
}: {
    tone?: Tone
    dot?: boolean
    icon?: string
    children: ReactNode
    style?: CSSProperties
    /** The full text when the badge is short (a tooltip). */
    title?: string
}) {
    return (
        <span className={`badge badge-${tone}`} style={style} title={title}>
            {dot && <span className='dot' />}
            {icon && <Icon name={icon} size={12} />}
            {children}
        </span>
    )
}

export function Avatar({
    name = '',
    size = 36,
    square,
    color,
    status,
    statusLabel
}: {
    name?: string
    size?: number
    square?: boolean
    color?: string | null
    /** A coloured dot for the status (available, busy, …); without it no dot. */
    status?: ShownPresence | null
    /** The name of the status (tooltip and screen readers). */
    statusLabel?: string
}) {
    const initials = name
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(s => s[0])
        .join('')
        .toUpperCase()
    const style: CSSProperties = { width: size, height: size, fontSize: size * 0.38 }
    if (color) style.background = color
    // Initials stay readable on the light surface tones
    if (color?.includes('surface')) style.color = 'var(--text-2)'
    const avatar = (
        <span className={'avatar' + (square ? ' avatar-sq' : '')} style={style}>
            {initials}
        </span>
    )
    if (!status) return avatar
    return (
        <span className='avatar-wrap' title={statusLabel}>
            {avatar}
            <span className={'presence-dot presence-' + status} role='img' aria-label={statusLabel} />
        </span>
    )
}

/** An error message from the API (several validation messages on separate lines). */
export function ErrorNote({ children }: { children: ReactNode }) {
    if (!children) return null
    return (
        <div role='alert' className='alert-error'>
            <Icon name='alert' size={15} style={{ flex: 'none', marginTop: 2 }} />
            <span>{children}</span>
        </div>
    )
}

export function OkNote({ children }: { children: ReactNode }) {
    if (!children) return null
    return (
        <div role='status' className='alert-ok'>
            <Icon name='checkCircle' size={15} style={{ flex: 'none', marginTop: 2 }} />
            <span>{children}</span>
        </div>
    )
}

/** Shimmer placeholder while data loads. */
export function Skeleton({ h = 18, w = '100%', style }: { h?: number; w?: number | string; style?: CSSProperties }) {
    return <div className='skeleton' style={{ height: h, width: w, ...style }} />
}

/** The colours of the apps in the design (used when a product has no colour of its own). */
export const APP_COLORS: Record<string, string> = {
    todo: '#0d9488',
    agenda: '#2563eb',
    facturatie: '#7c3aed',
    crm: '#db2777',
    dossier: '#ea580c',
    boekhoud: '#0891b2',
    planning: '#4f46e5',
    personeelsplanning: '#4f46e5',
    signature: '#16a34a'
}

export function appColor(app: { code?: string; color?: string | null }) {
    return app.color || (app.code ? APP_COLORS[app.code] : undefined) || 'var(--accent)'
}

export function AppIcon({
    app,
    size = 48
}: {
    app: { code?: string; icon?: string | null; color?: string | null }
    size?: number
}) {
    return (
        <span
            className='appicon'
            style={{ width: size, height: size, background: appColor(app), borderRadius: size * 0.26 }}
        >
            <Icon name={app.icon || 'box'} size={size * 0.52} />
        </span>
    )
}
