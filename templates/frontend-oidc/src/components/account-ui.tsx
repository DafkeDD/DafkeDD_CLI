import { type InputHTMLAttributes, type ReactNode, useId } from 'react'

/**
 * Small building blocks for the account pages (login, registration, password, invitation, members, licences,
 * platform), in the Pasport design: the classes of src/styles/pasport.css (btn, card, field, alert-…) and fields with
 * its tokens. New screens use the components of src/components/pasport (Btn, Field, Input, Badge, …) directly.
 */
/** A form or step on the login screen (AuthLayout): the screen itself is the card. */
export const AUTH = 'flex w-full flex-col gap-4 text-left'
/** The title and the sentence under it on the login screen. */
export const AUTH_TITLE = 't-h1 auth-title'
export const AUTH_TEXT = 'text-sm leading-relaxed text-[var(--text-2)]'
/** A card on a page in the shell (AppPage). */
export const CARD = 'card card-pad flex w-full flex-col gap-5 text-left'
export const WIDE_CARD = CARD
/**
 * The look of the field of the design (.input), as utilities: a page can still set the width (w-40) or the height,
 * which the class itself would not allow.
 */
const FIELD =
    'rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--text-3)] hover:border-[var(--text-3)] focus:border-[var(--accent)] focus:shadow-[var(--ring)] disabled:bg-[var(--surface-3)]'
export const INPUT = 'h-[42px] w-full px-[13px] text-sm ' + FIELD
export const SELECT = 'h-[42px] px-3 text-sm ' + FIELD
export const SMALL_SELECT = 'h-[34px] px-2.5 text-[13px] ' + FIELD
export const TEXTAREA = 'min-h-20 w-full px-[13px] py-2.5 font-mono text-xs ' + FIELD
export const BUTTON = 'btn btn-primary'
export const SECONDARY = 'btn btn-secondary btn-sm'
/** A second choice next to BUTTON, as big (for example "Log in with eID"). */
export const OUTLINE = 'btn btn-secondary'
/** A destructive action next to SECONDARY (remove, revoke). */
export const DANGER = 'btn btn-danger-soft btn-sm'
/** A choice in a row of SECONDARY buttons that is on (aria-pressed or the current filter). */
export const TOGGLE =
    SECONDARY +
    ' aria-pressed:border-[var(--accent-border)]! aria-pressed:bg-[var(--accent-tint)]! aria-pressed:text-[var(--accent-active)]!'
export const LINK = 'cursor-pointer font-semibold text-[var(--accent-hover)] underline-offset-2 hover:underline'

export function Heading({ title, text }: { title: string; text?: ReactNode }) {
    return (
        <div className='flex flex-col gap-1.5'>
            <h2 className='t-h2'>{title}</h2>
            {text && <p style={{ fontSize: 14 }}>{text}</p>}
        </div>
    )
}

/** The title of a step on the login screen (AuthPage), with the sentence under it. */
export function AuthHeading({ title, text }: { title: string; text?: ReactNode }) {
    return (
        <div className='flex flex-col gap-1.5'>
            <h1 className={AUTH_TITLE}>{title}</h1>
            {text && <p className={AUTH_TEXT}>{text}</p>}
        </div>
    )
}

export function Field({
    label,
    hint,
    ...input
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
    const id = useId()
    // The hint is not part of the label, but described by it (screen readers read it after the label)
    return (
        <div className='field'>
            <label htmlFor={id} className='label'>
                {label}
            </label>
            <input id={id} className='input' aria-describedby={hint ? id + '-hint' : undefined} {...input} />
            {hint && (
                <span id={id + '-hint'} className='hint'>
                    {hint}
                </span>
            )}
        </div>
    )
}

/** An error or success message. A div, not a p: the design gives every p its own colour. */
export function Notice({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
    return tone === 'error' ? (
        <div role='alert' className='alert-error'>
            {children}
        </div>
    ) : (
        <div role='status' className='alert-ok'>
            {children}
        </div>
    )
}

/** The page around an account screen in the shell: the content area already has its padding. */
export function Page({ children }: { children: ReactNode }) {
    return <div className='fade-in'>{children}</div>
}

/** "Log in" as a form: /api/auth/login is a route handler that needs a full page load. */
export function LoginButton({
    label,
    returnTo,
    outline = false
}: {
    label: string
    returnTo?: string
    /** A second choice (OUTLINE) next to a primary button. */
    outline?: boolean
}) {
    return (
        <form action='/api/auth/login' method='get' className='flex flex-col'>
            {returnTo && <input type='hidden' name='returnTo' value={returnTo} />}
            <button type='submit' className={outline ? OUTLINE : BUTTON}>
                {label}
            </button>
        </form>
    )
}

/** "Log in" that looks like a link. */
export function LoginLink({ label }: { label: string }) {
    return (
        <form action='/api/auth/login' method='get' className='inline'>
            <button type='submit' className={LINK}>
                {label}
            </button>
        </form>
    )
}

/** The translated name of a role ("Admin", "Beheerder", ...). */
export const roleLabel = (t: (key: 'role_admin' | 'role_user') => string, role: string) =>
    role === 'admin' ? t('role_admin') : t('role_user')
