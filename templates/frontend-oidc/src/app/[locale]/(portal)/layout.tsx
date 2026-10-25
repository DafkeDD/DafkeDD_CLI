import { Suspense, type ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { EidRequired } from '@/components/pasport/eid-required'
import { CustomerShell } from '@/components/pasport/portal-shell'
import { ClientRedirect, Notice } from '@/components/pasport/page-state'
import { LoginRedirect } from '@/components/shell/login-redirect'
import type { Profile } from '@/lib/portal'
import type { EidStatus } from '@/components/security'
import { getSession } from '@/lib/session'
import { serverApi } from '@/lib/server-api'

/** Every page reads the session (cookie) before it renders: navigations into the portal may block on the server. */
export const instant = false

/** The customer portal: every page inside the icon-rail shell, for logged in members of an organisation. */
export default function PortalLayout({ children }: { children: ReactNode }) {
    return (
        <Suspense fallback={null}>
            <Gate>{children}</Gate>
        </Suspense>
    )
}

async function Gate({ children }: { children: ReactNode }) {
    const session = await getSession()
    if (!session) return <LoginRedirect />
    // A superadmin on the platform (no organisation): the superadmin panel
    if (!session.tenant && session.superadmin) return <ClientRedirect to='/admin' />
    if (!session.tenant) {
        const t = await getTranslations('Portal.Shell')
        return <Notice icon='building' title={t('noAccess')} text={t('noTenant')} />
    }
    const [profile, eid] = await Promise.all([
        serverApi<Profile>(session, 'me/profile'),
        serverApi<EidStatus>(session, 'me/eid')
    ])
    // Every account must have its eID linked (OIDC_EID_REQUIRED): until it is, the eID screen instead of the portal
    if (eid?.required && !eid.linked) return <EidRequired email={session.email} />
    return (
        <CustomerShell
            user={{
                name: session.name || session.email,
                email: session.email,
                tenant: session.tenant,
                superadmin: session.superadmin,
                doctor: profile?.tenant?.profession === 'doctor' || session.superadmin,
                firstName: profile?.firstName ?? null,
                slug: profile?.tenant?.slug ?? null
            }}
        >
            {children}
        </CustomerShell>
    )
}
