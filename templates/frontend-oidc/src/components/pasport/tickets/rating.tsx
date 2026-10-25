'use client'

import { useState } from 'react'
import { type Ticket, useFormat } from '@/lib/portal'
import { useT } from '../i18n'
import { Btn, Icon } from '../ui'

type Rating = NonNullable<Ticket['rating']>

/** Five stars: clickable (with a hover preview) or read-only. */
export function Stars({
    value,
    onChange,
    size = 22,
    label
}: {
    value: number
    onChange?: (score: number) => void
    size?: number
    label: (n: number) => string
}) {
    const [hover, setHover] = useState(0)
    const shown = hover || value
    if (!onChange)
        return (
            <span className='stars' role='img' aria-label={label(value)}>
                {[1, 2, 3, 4, 5].map(n => (
                    <Icon key={n} name='star' size={size} className={n <= value ? 'star on' : 'star'} />
                ))}
            </span>
        )
    return (
        <span className='stars' role='radiogroup' onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map(n => (
                <button
                    type='button'
                    key={n}
                    role='radio'
                    aria-checked={value === n}
                    aria-label={label(n)}
                    className='star-btn'
                    onMouseEnter={() => setHover(n)}
                    onFocus={() => setHover(n)}
                    onBlur={() => setHover(0)}
                    onClick={() => onChange(n)}
                >
                    <Icon name='star' size={size} className={n <= shown ? 'star on' : 'star'} />
                </button>
            ))}
        </span>
    )
}

/** A given rating: the stars, what the score means and the comment. */
export function RatingView({ rating }: { rating: Rating }) {
    const t = useT('Tickets')
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Stars value={rating.score} size={20} label={n => t('stars', { count: n })} />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-2)' }}>
                    {t('score_' + rating.score)}
                </span>
            </div>
            {rating.comment && <div className='rating-comment'>{rating.comment}</div>}
        </div>
    )
}

/** The customer rates the handling of a closed ticket, or changes the rating later. */
export function RatingForm({
    ticket,
    onSubmit
}: {
    ticket: Ticket
    onSubmit: (score: number, comment: string) => Promise<boolean>
}) {
    const t = useT('Tickets')
    const f = useFormat()
    const [editing, setEditing] = useState(!ticket.rating)
    const [score, setScore] = useState(ticket.rating?.score ?? 0)
    const [comment, setComment] = useState(ticket.rating?.comment ?? '')
    const [busy, setBusy] = useState(false)

    if (ticket.rating && !editing)
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        flexWrap: 'wrap'
                    }}
                >
                    <div className='t-eyebrow'>{t('yourRating')}</div>
                    <Btn variant='ghost' size='sm' icon='edit' onClick={() => setEditing(true)}>
                        {t('changeRating')}
                    </Btn>
                </div>
                <RatingView rating={ticket.rating} />
                <span className='hint'>{t('ratedOn', { date: f.date(ticket.rating.ratedAt) })}</span>
            </div>
        )

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
                <div className='t-eyebrow'>{t('rateTitle')}</div>
                <p style={{ marginTop: 6, fontSize: 14 }}>{t('rateText')}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Stars value={score} onChange={setScore} size={28} label={n => t('stars', { count: n })} />
                {score > 0 && (
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-2)' }}>
                        {t('score_' + score)}
                    </span>
                )}
            </div>
            <textarea
                className='textarea'
                rows={3}
                maxLength={1000}
                placeholder={t('commentPlaceholder')}
                aria-label={t('comment')}
                value={comment}
                onChange={e => setComment(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                {ticket.rating && (
                    <Btn variant='ghost' onClick={() => setEditing(false)}>
                        {t('cancel')}
                    </Btn>
                )}
                <Btn
                    variant='primary'
                    icon='star'
                    disabled={score < 1 || busy}
                    onClick={async () => {
                        setBusy(true)
                        const ok = await onSubmit(score, comment.trim())
                        setBusy(false)
                        if (ok) setEditing(false)
                    }}
                >
                    {t('sendRating')}
                </Btn>
            </div>
        </div>
    )
}

/** A compact score for the ticket list of support: a star and the number, the comment as tooltip. */
export function RatingBadge({ rating }: { rating: Ticket['rating'] }) {
    const t = useT('Tickets')
    if (!rating) return <span style={{ fontSize: 13, color: 'var(--text-3)' }}>—</span>
    const tone = rating.score >= 4 ? 'green' : rating.score === 3 ? 'amber' : 'red'
    return (
        <span
            className={`badge badge-${tone}`}
            title={rating.comment ?? undefined}
            aria-label={t('stars', { count: rating.score })}
        >
            <Icon name='star' size={12} className='star on' /> {rating.score}
        </span>
    )
}
