import { files, sitePages, uiFiles, withApi } from './nextjs.js'

/**
 * The Pasport design of a frontend without the OpenID Connect login (a site, an API, the simple login), for `update`:
 * the files the CLI keeps current (the design itself) and the starters of a project made before every project had it
 * (its home page, the rail, the account in the topbar, the login pages), written once next to what is there.
 */

/** The files of the design that `update` keeps current, like the design files of the login server. */
export const SITE_DESIGN_FILES = [
    'scripts/check-design.mjs',
    'src/app/[locale]/layout.tsx',
    'src/components/pasport/auth-layout.tsx',
    'src/components/pasport/i18n.ts',
    'src/components/pasport/page-head.tsx',
    'src/components/pasport/page-state.tsx',
    'src/components/pasport/shell.tsx',
    'src/components/pasport/toast.tsx',
    'src/components/pasport/ui.tsx',
    'src/components/pasport/widgets.tsx',
    'src/components/shell/app-shell.tsx',
    'src/styles/pasport.css'
]

/**
 * Yours once they are there: the home page, the rail, the name (brand.ts), the account, the login pages and the status
 * card of the API.
 */
export const SITE_STARTER_FILES = [
    'src/app/[locale]/page.tsx',
    'src/lib/nav.ts',
    'src/lib/brand.ts',
    'src/components/shell/account.ts',
    'src/app/[locale]/login/page.tsx',
    'src/app/[locale]/register/page.tsx',
    'src/app/[locale]/profile/page.tsx',
    'src/components/auth-form.tsx',
    'src/components/profile.tsx',
    'src/components/auth-links.tsx',
    'src/components/api-status.tsx'
]

/** Is this a frontend without the OpenID Connect login (those have the design files of the login server)? */
export const isSite = project => Boolean(project.frontend) && project.kind !== 'pasport' && project.kind !== 'app'

/** Every file the CLI makes for the frontend of this project now (relative to ./frontend). */
export function siteFrontend(project) {
    const all = sitePages({ ...files, ...uiFiles }, { appName: project.name })
    return project.backend ? withApi(all, { port: 4000, auth: project.kind === 'login' }, { ui: true }) : all
}

/** SITE_DESIGN_FILES of this project, as `frontend/<file>` (for the manifest and `update`). */
export function siteDesignFiles(project) {
    const all = siteFrontend(project)
    return Object.fromEntries(SITE_DESIGN_FILES.map(rel => [`frontend/${rel}`, all[rel]]))
}
