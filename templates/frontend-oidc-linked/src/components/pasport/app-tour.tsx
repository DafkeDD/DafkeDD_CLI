'use client'

import { useTranslations } from 'next-intl'
import { APP_NAV } from '@/lib/nav'
import { GuidedTour, type GuidedStep } from './tour'

/**
 * The first-login tour of this app (the tour itself is GuidedTour in tour.tsx): a welcome, every page of APP_NAV (it
 * goes there and points at its page head), the notifications, the account menu and a closing step. A new page in
 * APP_NAV is a new step by itself; its text is AppTour.pages.<label> in messages/*.json, in every language
 * Shown once per account (localStorage app-tour:<sub>, the opaque id of the account: never its email address), again
 * from the user menu, never for a superadmin (the shell does not show it then).
 */
export function AppTour({ account, name }: { account: string; name: string }) {
    const t = useTranslations('AppTour')
    const nav = useTranslations('Nav')
    const first = name.split(' ')[0]
    const home = APP_NAV[0]?.href ?? '/'
    const pages: GuidedStep[] = APP_NAV.map(item => ({
        id: 'page-' + item.label,
        href: item.href,
        targets: ['.page-head'],
        title: nav(item.label),
        // A page that has no text of its own yet still gets its step
        text: t.has(`pages.${item.label}`) ? t(`pages.${item.label}`) : t('pageText', { page: nav(item.label) })
    }))
    const steps: GuidedStep[] = [
        { id: 'welcome', href: home, title: t('welcomeTitle', { name: first }), text: t('welcomeText') },
        ...pages,
        { id: 'bell', href: home, targets: ['.notif-wrap'], title: t('bellTitle'), text: t('bellText') },
        { id: 'account', href: home, targets: ['.tb-user-wrap'], title: t('accountTitle'), text: t('accountText') },
        { id: 'done', href: home, title: t('doneTitle'), text: t('doneText') }
    ]
    return (
        <GuidedTour
            steps={steps}
            storageKey={'app-tour:' + account}
            texts={{ skip: t('skip'), back: t('back'), next: t('next'), finish: t('finish') }}
            stepOf={(step, total) => t('stepOf', { step, total })}
        />
    )
}
