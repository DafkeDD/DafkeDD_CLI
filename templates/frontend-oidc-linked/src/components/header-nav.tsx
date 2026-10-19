import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { ACCOUNT_URL } from '@/lib/oidc'
import { getSession } from '@/lib/session'

const NAV = 'rounded-lg px-3 py-1.5 text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/10'

/**
 * In the header of every page, for whoever is logged in: the profile here, and the account, management and platform
 * pages on the frontend of the login server (OIDC_ACCOUNT_URL): this app is linked to that server.
 */
export async function HeaderNav() {
    const session = await getSession()
    if (!session) return null
    const t = await getTranslations('Oidc')
    return (
        <nav className='flex items-center gap-1'>
            {session.tenant?.role === 'admin' && (
                <a href={ACCOUNT_URL + '/members'} className={NAV}>
                    {t('management')}
                </a>
            )}
            {session.superadmin && (
                <a href={ACCOUNT_URL + '/admin'} className={NAV}>
                    {t('platformTitle')}
                </a>
            )}
            <a href={ACCOUNT_URL + '/security'} className={NAV}>
                {t('securityTitle')}
            </a>
            <Link href='/profile' className={NAV}>
                {t('profile')}
            </Link>
        </nav>
    )
}
