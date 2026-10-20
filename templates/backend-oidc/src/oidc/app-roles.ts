import type { AppRole } from './store/oidc.store.js'

/** The key of a role: what the code of the app checks (a-z, 0-9 and -, 2 to 40 characters, starting with a letter). */
export const ROLE_KEY = /^[a-z][a-z0-9-]{1,39}$/
/** At most this many roles per app. */
export const MAX_ROLES = 20
const LANGUAGES = ['en', 'nl', 'fr', 'de'] as const

/**
 * The roles of an app as its developer defines them (config/app-roles.json of the app, or "roles" in the clients file),
 * checked: unique keys, a name in every language (at most 60 characters). Throws an Error with the reason.
 */
export function parseRoles(value: unknown): AppRole[] {
    if (value === undefined || value === null) return []
    if (!Array.isArray(value)) throw new Error('roles must be a list')
    if (value.length > MAX_ROLES) throw new Error(`at most ${MAX_ROLES} roles`)
    const seen = new Set<string>()
    return value.map((raw: unknown) => {
        const role = (raw ?? {}) as { key?: unknown; names?: Record<string, unknown>; default?: unknown }
        if (typeof role.key !== 'string' || !ROLE_KEY.test(role.key))
            throw new Error(`the role key "${String(role.key)}" is not valid (a-z, 0-9 and -, 2 to 40 characters)`)
        if (seen.has(role.key)) throw new Error(`the role key "${role.key}" is used twice`)
        seen.add(role.key)
        const names = {} as AppRole['names']
        for (const language of LANGUAGES) {
            const name = role.names?.[language]
            if (typeof name !== 'string' || !name.trim() || name.length > 60)
                throw new Error(`the role "${role.key}" needs a name in ${language} (at most 60 characters)`)
            names[language] = name.trim()
        }
        return { key: role.key, names, default: role.default === true }
    })
}

/**
 * The roles of a member in an app: the ones an admin gave (only those the app still defines), or else the default
 * roles of the app.
 */
export function effectiveRoles(defined: AppRole[], given: string[] | null): string[] {
    const keys = new Set(defined.map(role => role.key))
    if (given === null) return defined.filter(role => role.default).map(role => role.key)
    return given.filter(key => keys.has(key))
}
