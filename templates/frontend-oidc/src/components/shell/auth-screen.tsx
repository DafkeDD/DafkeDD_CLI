'use client'

import { type ReactNode, useSyncExternalStore } from 'react'
import { AuthLayout, loginVariant } from '@/components/pasport/auth-layout'

/**
 * The login screen of the Pasport design (src/components/pasport/auth-layout.tsx), the same in every app: the teal
 * panel with the eID card on the left, the form on the right (only the form on a phone), the theme and the language
 * at the bottom right. `admin` (or a login started at /admin/login) gives the dark superadmin variant.
 */
export function AuthPage({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
    // The cookie of /admin/login is only known in the browser: the customer variant on the server
    const variant = useSyncExternalStore(
        () => () => undefined,
        loginVariant,
        () => 'customer' as const
    )
    return <AuthLayout variant={admin ? 'admin' : variant}>{children}</AuthLayout>
}
