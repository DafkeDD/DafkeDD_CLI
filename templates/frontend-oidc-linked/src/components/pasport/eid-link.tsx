'use client'

import { useEffect } from 'react'
import { Loading } from './page-state'

/**
 * The eID screen of the shell, step 2, in an app linked to a login server: the eID is linked on the security page of
 * that server (it shows the same screen), then the account comes back here.
 */
export function EidLinkStep({ accountUrl = '' }: { onLinked: () => void; accountUrl?: string }) {
    useEffect(() => {
        window.location.assign(accountUrl + '/security')
    }, [accountUrl])
    return <Loading rows={1} />
}
