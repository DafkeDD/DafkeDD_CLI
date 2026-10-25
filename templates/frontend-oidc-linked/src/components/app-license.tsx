import { getFormatter, getTranslations } from 'next-intl/server'
import { CARD, LINK, Notice } from '@/components/account-ui'
import { ACCOUNT_URL, type License } from '@/lib/oidc'

/**
 * The licence of the user for the product this app sells, as the login server put it in the tokens: a running trial
 * (until when), a seat, a superadmin, or none. The beheerder (admin) gets a link to the licences of the organisation on
 * the login server; a member is told to ask the beheerder.
 */
export async function AppLicense({ license, admin }: { license: License; admin: boolean }) {
    const t = await getTranslations('AppLicense')
    const format = await getFormatter()
    const licenses = (
        <a href={ACCOUNT_URL + '/users'} className={LINK}>
            {t('manage')}
        </a>
    )
    if (license.status === 'none')
        return (
            <section className={CARD + ' !gap-2 !py-4'}>
                <Notice tone='error'>
                    <strong>{t('noneTitle', { product: license.product })}</strong>
                </Notice>
                <span className='text-sm text-[var(--text-2)]'>{admin ? t('noneAdmin') : t('noneMember')}</span>
                {admin && licenses}
            </section>
        )
    const text =
        license.status === 'trial'
            ? t('trial', {
                  date: license.endsAt ? format.dateTime(new Date(license.endsAt), { dateStyle: 'long' }) : '—'
              })
            : license.status === 'seat'
              ? t('seat')
              : t('superadmin')
    return (
        <section className={CARD + ' !flex-row flex-wrap items-center justify-between !gap-3 !py-4'}>
            <div className='flex flex-col gap-0.5'>
                <span className='text-xs font-semibold tracking-wide text-[var(--text-3)] uppercase'>
                    {t('title', { product: license.product })}
                </span>
                <span className='text-sm'>{text}</span>
            </div>
            {admin && license.status !== 'superadmin' && licenses}
        </section>
    )
}
