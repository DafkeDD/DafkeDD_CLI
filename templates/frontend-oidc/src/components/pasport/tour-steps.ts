/*
 * The steps of the first-login tour of the customer portal (tour.tsx), without React: the browser tests
 * (e2e/tour.spec.ts) walk the same steps. Their texts are Portal.Tour.<id>Title and <id>Text of the messages.
 */

export type TourStep = {
    id: string
    /** The page of the step: the tour goes there first. */
    href: string
    /** What it points at: the first selector that is on the page (none: a card in the middle). */
    targets?: string[]
}

const ADMIN: TourStep[] = [
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
const MEMBER: TourStep[] = [
    { id: 'welcome', href: '/dashboard' },
    { id: 'apps', href: '/dashboard', targets: ['.tile-grid'] },
    { id: 'bell', href: '/dashboard', targets: ['.notif-wrap'] },
    { id: 'marketplace', href: '/marketplace', targets: ['.market-grid > .market-card', '.market-grid'] },
    { id: 'demoMember', href: '/marketplace', targets: ['.market-grid > .market-card .market-foot', '.market-grid'] },
    { id: 'support', href: '/support', targets: ['.page-actions', '.page-head'] },
    { id: 'account', href: '/support', targets: ['.tb-user-wrap'] },
    { id: 'done', href: '/dashboard' }
]

/** The steps by role: an admin of the organisation also buys and hands out licences. */
export const TOUR_STEPS = { admin: ADMIN, member: MEMBER }
