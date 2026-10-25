/**
 * A page in the sidebar. `label` is a key of "Nav" in messages/*.json (in every language), `icon` a name of ICONS in
 * src/components/pasport/ui.tsx (the icons of the Pasport design).
 */
export type NavItem = { href: string; label: string; icon: string }

/**
 * The pages of this app at the top of the sidebar: add yours here. The account, organisation and platform pages
 * below them come from the login server and are the same in every app.
 */
export const APP_NAV: NavItem[] = [{ href: '/', label: 'home', icon: 'home' }]
