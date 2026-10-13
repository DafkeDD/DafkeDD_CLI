import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { Presence } from '@/components/presence'
import { getSession } from '@/lib/session'

const NAV = 'rounded-lg px-3 py-1.5 text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/10'

/**
 * In the header of every page: "Management" for admins (members of the organisation) and "Platform" for superadmins.
 * For everyone who is logged in it also sends the heartbeat that shows them as online.
 */
export async function HeaderNav() {
    const session = await getSession()
    if (!session) return null
    const t = await getTranslations('Oidc')
    return (
        <nav className='flex items-center gap-1'>
            <Presence />
            {session.tenant.role === 'admin' && (
                <Link href='/members' className={NAV}>
                    {t('management')}
                </Link>
            )}
            {session.superadmin && (
                <Link href='/admin' className={NAV}>
                    {t('platformTitle')}
                </Link>
            )}
            <Link href='/profile' className={NAV}>
                {t('profile')}
            </Link>
        </nav>
    )
}
