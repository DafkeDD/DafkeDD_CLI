import { Suspense, type ReactNode } from 'react'
import { AdminShell } from '@/components/pasport/portal-shell'
import { ClientRedirect } from '@/components/pasport/page-state'
import { LoginRedirect } from '@/components/shell/login-redirect'
import type { AdminTenant, Profile, Ticket } from '@/lib/portal'
import { getSession } from '@/lib/session'
import { serverApi } from '@/lib/server-api'

/** Every page reads the session (cookie) before it renders: navigations into the panel may block on the server. */
export const instant = false

/** The superadmin panel: the same shell with the dark brand mark, only for superadmins. */
export default function PanelLayout({ children }: { children: ReactNode }) {
    return (
        <Suspense fallback={null}>
            <Gate>{children}</Gate>
        </Suspense>
    )
}

async function Gate({ children }: { children: ReactNode }) {
    const session = await getSession()
    if (!session) return <LoginRedirect />
    if (!session.superadmin) return <ClientRedirect to='/dashboard' />
    const [tenants, tickets, profile] = await Promise.all([
        serverApi<AdminTenant[]>(session, 'admin/tenants'),
        serverApi<Ticket[]>(session, 'admin/tickets'),
        // The name from the profile: changed there, it shows at once (the session keeps the name of the login)
        serverApi<Profile>(session, 'me/profile')
    ])
    return (
        <AdminShell
            user={{
                name: profile?.name || session.name || session.email,
                email: session.email,
                tenant: session.tenant,
                superadmin: true,
                doctor: profile?.tenant?.profession === 'doctor'
            }}
            counts={{
                tenants: tenants ? tenants.length : null,
                openTickets: tickets ? tickets.filter(t => t.status !== 'closed').length : null
            }}
        >
            {children}
        </AdminShell>
    )
}
