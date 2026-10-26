'use client'

import { useEffect } from 'react'
import { Loading } from './page-state'

/**
 * The eID screen of the shell, step 2, in an app linked to a login server: the eID is linked on the security page of
 * that server (it shows the same screen), then the login server sends the account back here (?app=<client id>).
 */
export function EidLinkStep({
    accountUrl = '',
    app = ''
}: {
    onLinked: () => void
    accountUrl?: string
    app?: string
}) {
    useEffect(() => {
        window.location.assign(accountUrl + '/security' + (app ? '?app=' + encodeURIComponent(app) : ''))
    }, [accountUrl, app])
    return <Loading rows={1} />
}
