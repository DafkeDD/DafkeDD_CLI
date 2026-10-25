'use client'

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from '@/i18n/navigation'
import { useT } from './i18n'
import { Btn, Icon } from './ui'

/*
 * The tour of the customer portal: it walks through the pages itself and puts a spotlight on what each step is about,
 * with the explanation next to it. Shown once to a new user (remembered per account in localStorage pp-tour:<email>),
 * and again from the user menu ("Tour"). The steps depend on the role: admins buy and hand out licences.
 */

const OPEN_EVENT = 'pp-tour-open'
const DONE_EVENT = 'pp-tour-done'

/** Opens the tour (the menu item of the shell). */
export function openTour() {
    window.dispatchEvent(new Event(OPEN_EVENT))
}

const key = (email: string) => 'pp-tour:' + email.toLowerCase()
function subscribeDone(onChange: () => void) {
    window.addEventListener(DONE_EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
        window.removeEventListener(DONE_EVENT, onChange)
        window.removeEventListener('storage', onChange)
    }
}
function isDone(email: string) {
    try {
        return localStorage.getItem(key(email)) === 'done'
    } catch {
        // Storage blocked: never push the tour on every page
        return true
    }
}

type Step = {
    id: string
    /** The page of the step: the tour goes there first. */
    href: string
    /** What it points at: the first selector that is on the page (none: a card in the middle). */
    targets?: string[]
}

const ADMIN: Step[] = [
    { id: 'welcome', href: '/dashboard' },
    { id: 'apps', href: '/dashboard', targets: ['.tile-grid'] },
    { id: 'bell', href: '/dashboard', targets: ['.notif-wrap'] },
    { id: 'marketplace', href: '/marketplace', targets: ['.market-grid > .market-card', '.market-grid'] },
    { id: 'demo', href: '/marketplace', targets: ['.market-grid > .market-card .market-foot', '.market-grid'] },
    { id: 'invite', href: '/users', targets: ['.page-actions', '.page-head'] },
    { id: 'seats', href: '/users', targets: ['.table-wrap', '.page-head'] },
    { id: 'invoices', href: '/invoices', targets: ['[data-tour="subscriptions"]', '.table-wrap', '.page-head'] },
    { id: 'support', href: '/support', targets: ['.page-actions', '.page-head'] },
    { id: 'account', href: '/support', targets: ['.tb-user-wrap'] },
    { id: 'done', href: '/dashboard' }
]
const MEMBER: Step[] = [
    { id: 'welcome', href: '/dashboard' },
    { id: 'apps', href: '/dashboard', targets: ['.tile-grid'] },
    { id: 'bell', href: '/dashboard', targets: ['.notif-wrap'] },
    { id: 'marketplace', href: '/marketplace', targets: ['.market-grid > .market-card', '.market-grid'] },
    { id: 'demoMember', href: '/marketplace', targets: ['.market-grid > .market-card .market-foot', '.market-grid'] },
    { id: 'support', href: '/support', targets: ['.page-actions', '.page-head'] },
    { id: 'account', href: '/support', targets: ['.tb-user-wrap'] },
    { id: 'done', href: '/dashboard' }
]

/** Room around the spotlight, and the width of the explanation. */
const PAD = 8
const TIP_W = 360
/** How long the tour waits for the element of a step (the page loads its data first). */
const WAIT_MS = 4000

type Box = { top: number; left: number; width: number; height: number }

export function Tour({ email, name, admin }: { email: string; name: string; admin: boolean }) {
    const t = useT('Tour')
    const router = useRouter()
    const pathname = usePathname()
    // Not shown during server rendering and hydration: localStorage only exists in the browser
    const done = useSyncExternalStore(
        subscribeDone,
        () => isDone(email),
        () => true
    )
    const [manual, setManual] = useState(false)
    const [index, setIndex] = useState(0)
    // The spotlight: undefined while the page and its element load, null when the step has no element
    const [box, setBox] = useState<Box | null | undefined>(undefined)
    const target = useRef<Element | null>(null)

    const steps = admin ? ADMIN : MEMBER
    const step = steps[Math.min(index, steps.length - 1)]
    const last = index >= steps.length - 1
    const open = manual || !done

    useEffect(() => {
        const start = () => {
            setIndex(0)
            setBox(undefined)
            setManual(true)
        }
        window.addEventListener(OPEN_EVENT, start)
        return () => window.removeEventListener(OPEN_EVENT, start)
    }, [])

    // To the page of the step, then wait for its element, bring it into view and follow it (scroll, resize)
    useEffect(() => {
        if (!open) return
        if (pathname !== step.href) {
            router.push(step.href)
            return
        }
        let frame = 0
        let timer: ReturnType<typeof setTimeout> | undefined
        let alive = true
        const began = Date.now()
        const measure = () => {
            const el = target.current
            if (!el || !alive) return
            const r = el.getBoundingClientRect()
            setBox({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 })
        }
        const find = () => {
            if (!alive) return
            if (!step.targets) {
                target.current = null
                setBox(null)
                return
            }
            const el = step.targets.map(s => document.querySelector(s)).find(Boolean) ?? null
            if (!el) {
                if (Date.now() - began < WAIT_MS) frame = requestAnimationFrame(find)
                else setBox(null)
                return
            }
            target.current = el
            const r = el.getBoundingClientRect()
            const visible = r.top >= 70 && r.bottom <= window.innerHeight - 20
            if (!visible) el.scrollIntoView({ block: r.height > window.innerHeight - 160 ? 'start' : 'center' })
            // After the scroll has settled
            timer = setTimeout(
                () => {
                    frame = requestAnimationFrame(measure)
                },
                visible ? 0 : 350
            )
        }
        frame = requestAnimationFrame(find)
        const follow = () => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(measure)
        }
        window.addEventListener('resize', follow)
        window.addEventListener('scroll', follow, true)
        return () => {
            alive = false
            cancelAnimationFrame(frame)
            clearTimeout(timer)
            window.removeEventListener('resize', follow)
            window.removeEventListener('scroll', follow, true)
        }
    }, [open, index, pathname, step, router])

    const go = (next: number) => {
        setBox(undefined)
        setIndex(next)
    }
    const close = () => {
        try {
            localStorage.setItem(key(email), 'done')
        } catch {
            /* storage blocked */
        }
        window.dispatchEvent(new Event(DONE_EVENT))
        setManual(false)
        setIndex(0)
        setBox(undefined)
    }
    const closeRef = useRef(close)
    useEffect(() => {
        closeRef.current = close
    })
    useEffect(() => {
        if (!open) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeRef.current()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [open])

    if (!open || box === undefined || typeof document === 'undefined')
        return open ? <div className='tour-block' /> : null

    // The explanation: under the spotlight when there is room, else above it; in the middle without one
    let tip: CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: TIP_W }
    if (box) {
        const vw = window.innerWidth
        const vh = window.innerHeight
        const width = Math.min(TIP_W, vw - 32)
        const left = Math.max(16, Math.min(box.left, vw - width - 16))
        if (vh - (box.top + box.height) > 250) tip = { left, top: box.top + box.height + 12, width }
        else if (box.top > 250) tip = { left, bottom: vh - box.top + 12, width }
        else if (vw - (box.left + box.width) > width + 32)
            tip = { left: box.left + box.width + 12, top: Math.max(16, Math.min(box.top, vh - 300)), width }
        else tip = { left, bottom: 16, width }
    }

    return createPortal(
        <div className='tour-layer' role='dialog' aria-modal='true' aria-label={t(`${step.id}Title`, { name })}>
            {/* Clicks on the page wait until the tour is closed */}
            <div className={'tour-block' + (box ? '' : ' dim')} />
            {box && <div className='tour-hole' style={box} />}
            <div className='tour-tip pop-anim' key={step.id} style={tip}>
                <div className='tour-count'>{t('stepOf', { step: index + 1, total: steps.length })}</div>
                <h3 className='t-h3'>{t(`${step.id}Title`, { name: name.split(' ')[0] })}</h3>
                <p className='tour-text'>{t(`${step.id}Text`)}</p>
                <div className='tour-dots' aria-hidden='true'>
                    {steps.map((s, i) => (
                        <span key={s.id} className={i === index ? 'on' : i < index ? 'seen' : ''} />
                    ))}
                </div>
                <div className='tour-foot'>
                    <button type='button' className='link-btn tour-skip' onClick={close}>
                        {last ? '' : t('skip')}
                    </button>
                    <div className='tour-buttons'>
                        {index > 0 && (
                            <Btn
                                variant='ghost'
                                size='sm'
                                icon='arrowLeft'
                                onClick={() => go(index - 1)}
                                aria-label={t('back')}
                                title={t('back')}
                            />
                        )}
                        {last ? (
                            <Btn size='sm' icon='check' onClick={close}>
                                {t('finish')}
                            </Btn>
                        ) : (
                            <Btn size='sm' onClick={() => go(index + 1)}>
                                {t('next')} <Icon name='arrowRight' size={15} />
                            </Btn>
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    )
}
