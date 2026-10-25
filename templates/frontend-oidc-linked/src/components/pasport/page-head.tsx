import type { ReactNode } from 'react'

/**
 * The header of a page in the shell of the Pasport design: the title, the sentence under it, and the actions on the
 * right (under it on a phone). Every page in AppPage starts with it.
 */
export function PageHead({ title, text, actions }: { title: string; text?: ReactNode; actions?: ReactNode }) {
    return (
        <div className='page-head'>
            <div className='ph-text'>
                <h1>{title}</h1>
                {text && <p>{text}</p>}
            </div>
            {actions && <div className='page-actions'>{actions}</div>}
        </div>
    )
}
