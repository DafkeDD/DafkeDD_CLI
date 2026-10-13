import { type InputHTMLAttributes, type ReactNode, useId } from 'react'

/**
 * Small building blocks for the account pages (login, registration, password, invitation, members, platform). Plain
 * Tailwind with the colour variables of the theme, so they work with and without the DafkeDD UI components.
 */
export const CARD =
    'flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-black/10 bg-black/[.03] p-6 text-left dark:border-white/15 dark:bg-white/[.04]'
export const WIDE_CARD =
    'flex w-full max-w-3xl flex-col gap-5 rounded-2xl border border-black/10 bg-black/[.03] p-6 text-left dark:border-white/15 dark:bg-white/[.04]'
export const INPUT =
    'h-11 w-full rounded-xl border border-black/15 bg-transparent px-3.5 text-sm outline-none focus:border-[var(--accent,#6366f1)] dark:border-white/20'
export const BUTTON =
    'inline-flex h-11 items-center justify-center rounded-xl bg-[var(--accent,#171717)] px-5 text-sm font-semibold text-[var(--accent-fg,#ffffff)] disabled:opacity-60 dark:bg-[var(--accent,#ededed)] dark:text-[var(--accent-fg,#0a0a0a)]'
export const SECONDARY =
    'inline-flex h-9 items-center justify-center rounded-lg border border-black/15 px-3 text-xs font-semibold hover:border-[var(--accent,#6366f1)] disabled:opacity-60 dark:border-white/20'
export const LINK = 'font-semibold underline underline-offset-2'

export function Page({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
    return (
        <main
            className={`flex flex-1 flex-col items-center px-6 pt-10 pb-28 ${wide ? 'justify-start' : 'justify-center'}`}
        >
            {children}
        </main>
    )
}

export function Heading({ title, text }: { title: string; text?: ReactNode }) {
    return (
        <div className='flex flex-col gap-1.5'>
            <h1 className='text-2xl font-bold tracking-tight'>{title}</h1>
            {text && <p className='text-sm opacity-80'>{text}</p>}
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
        <div className='flex flex-col gap-1.5 text-sm font-medium'>
            <label htmlFor={id}>{label}</label>
            <input id={id} className={INPUT} aria-describedby={hint ? id + '-hint' : undefined} {...input} />
            {hint && (
                <span id={id + '-hint'} className='text-xs font-normal opacity-70'>
                    {hint}
                </span>
            )}
        </div>
    )
}

/** An error or success message. A div, not a p: the DafkeDD UI theme gives every p its own colour. */
export function Notice({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
    return tone === 'error' ? (
        <div role='alert' className='text-sm whitespace-pre-line text-red-600 dark:text-red-400'>
            {children}
        </div>
    ) : (
        <div role='status' className='text-sm text-green-700 dark:text-green-400'>
            {children}
        </div>
    )
}

/** "Log in" as a form: /api/auth/login is a route handler that needs a full page load. */
export function LoginButton({ label, returnTo }: { label: string; returnTo?: string }) {
    return (
        <form action='/api/auth/login' method='get' className='flex flex-col'>
            {returnTo && <input type='hidden' name='returnTo' value={returnTo} />}
            <button type='submit' className={BUTTON}>
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
