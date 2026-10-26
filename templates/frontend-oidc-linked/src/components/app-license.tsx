import { getFormatter, getNow, getTranslations } from 'next-intl/server'
import { AskDemo } from '@/components/ask-demo'
import { CARD, LINK, Notice } from '@/components/account-ui'
import { APP_NAME } from '@/lib/brand'
import { ACCOUNT_URL, type License } from '@/lib/oidc'

const DAY = 24 * 60 * 60 * 1000

/**
 * The licence of the user for the product this app sells, as the login server put it in the tokens: a running demo
 * (how many days are left, until when), a seat, a superadmin, or none. Without one: start a demo here (once per
 * product), the apps of the portal, and for the beheerder (admin) the users of the organisation (seats); a member is
 * told to ask the beheerder.
 */
export async function AppLicense({ license, admin }: { license: License; admin: boolean }) {
    const t = await getTranslations('AppLicense')
    const format = await getFormatter()
    const now = await getNow()
    // The name of this app (the product code is what the login server sells)
    const product = APP_NAME ?? license.product
    const users = (
        <a href={ACCOUNT_URL + '/users'} className={LINK}>
            {t('manage')}
        </a>
    )
    if (license.status === 'none')
        return (
            <section className={CARD + ' !gap-3 !py-4'}>
                <Notice tone='error'>
                    <strong>{t('noneTitle', { product })}</strong>
                </Notice>
                <span className='text-sm text-[var(--text-2)]'>{admin ? t('noneAdmin') : t('noneMember')}</span>
                <div className='flex flex-wrap items-center gap-3'>
                    <AskDemo code={license.product} />
                    <a href={ACCOUNT_URL + '/marketplace'} className={LINK}>
                        {t('portal')}
                    </a>
                    {admin && users}
                </div>
            </section>
        )
    const days = license.endsAt ? Math.max(0, Math.ceil((license.endsAt - now.getTime()) / DAY)) : null
    const text =
        license.status === 'trial'
            ? t('trial', {
                  days: days ?? 0,
                  date: license.endsAt ? format.dateTime(new Date(license.endsAt), { dateStyle: 'long' }) : '—'
              })
            : license.status === 'seat'
              ? t('seat')
              : t('superadmin')
    return (
        <section className={CARD + ' !flex-row flex-wrap items-center justify-between !gap-3 !py-4'}>
            <div className='flex flex-col gap-0.5'>
                <span className='text-xs font-semibold tracking-wide text-[var(--text-3)] uppercase'>
                    {t('title', { product })}
                </span>
                <span className='text-sm'>{text}</span>
            </div>
            {license.status === 'trial' && (
                <a href={ACCOUNT_URL + '/marketplace'} className={LINK}>
                    {t('buy')}
                </a>
            )}
            {admin && license.status === 'seat' && users}
        </section>
    )
}

/** A licence, but no role in this app (the beheerder gave none): what to do instead of an error of the API. */
export async function NoRoles({ admin }: { admin: boolean }) {
    const t = await getTranslations('AppLicense')
    return (
        <section className={CARD + ' !gap-2 !py-4'}>
            <Notice tone='error'>
                <strong>{t('noRolesTitle')}</strong>
            </Notice>
            <span className='text-sm text-[var(--text-2)]'>{admin ? t('noRolesAdmin') : t('noRolesMember')}</span>
            {admin && (
                <a href={ACCOUNT_URL + '/users'} className={LINK}>
                    {t('manage')}
                </a>
            )}
        </section>
    )
}
