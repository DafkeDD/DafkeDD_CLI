import { getTranslations, setRequestLocale } from 'next-intl/server'
import { PageHead } from '@/components/pasport/page-head'
import { Icon } from '@/components/pasport/ui'
import { AppPage } from '@/components/shell/app-shell'

/** The home page: in the shell of the Pasport design, what this project is made of. Make it yours. */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
    setRequestLocale((await params).locale)
    const t = await getTranslations('HomePage')
    const stack = [
        { name: 'Next.js', text: t('stackNext'), icon: 'layers' },
        { name: 'Tailwind CSS', text: t('stackTailwind'), icon: 'sparkles' },
        { name: 'next-intl', text: t('stackIntl'), icon: 'globe' },
        { name: 'Pasport', text: t('stackDesign'), icon: 'shield' }
    ]
    return (
        <AppPage>
            <div className='fade-in' style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <PageHead title={t('title')} text={t('description')} />
                <div className='kpi-grid kpi-grid-4'>
                    {stack.map(item => (
                        <div key={item.name} className='card card-pad' style={{ display: 'flex', gap: 12 }}>
                            <span className='kpi-icon'>
                                <Icon name={item.icon} size={18} />
                            </span>
                            <div>
                                <div style={{ fontWeight: 650 }}>{item.name}</div>
                                <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{item.text}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </AppPage>
    )
}
