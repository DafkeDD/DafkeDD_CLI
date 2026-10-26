import { Suspense } from 'react'
import { ClientRedirect } from '@/components/pasport/page-state'
import { getSession } from '@/lib/session'

/** Reads the session to choose where to go: may block on the server. */
export const instant = false

/** The home page: my apps when logged in (to click through; the superadmin panel on the platform), else the login. */
export default function HomePage() {
    return (
        <Suspense fallback={null}>
            <Route />
        </Suspense>
    )
}

async function Route() {
    const session = await getSession()
    return <ClientRedirect to={!session ? '/login' : !session.tenant && session.superadmin ? '/admin' : '/apps'} />
}
