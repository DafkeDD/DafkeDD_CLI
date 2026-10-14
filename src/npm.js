import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * npm 12 and later only run the install scripts of the packages that `allowScripts` in package.json allows, and warns
 * about every other one. None of these scripts is needed: each package ships its binaries already (as optional
 * packages per platform, or in the package itself) and the script only checks them, builds a fallback from source or
 * reports usage. So they are denied (`false`), which also keeps the output of `npm install` free of warnings.
 * Older npm versions ignore the field (and keep running the scripts, as before).
 */
export const ALLOW_SCRIPTS = {
    // DafkeDD eID (native calls to the card reader): its prebuilt binaries are in the package
    koffi: false,
    // Next.js, Tailwind and ESLint: the native binary comes as an optional package per platform
    '@parcel/watcher': false,
    '@swc/core': false,
    'unrs-resolver': false,
    esbuild: false,
    sharp: false,
    // NestJS (Swagger UI): only usage statistics
    '@scarf/scarf': false
}

/** Adds ALLOW_SCRIPTS to package.json in `root` (choices that are already there stay as they are). */
export async function denyInstallScripts(root) {
    const file = path.join(root, 'package.json')
    const pkg = JSON.parse(await fs.readFile(file, 'utf8'))
    pkg.allowScripts = { ...ALLOW_SCRIPTS, ...pkg.allowScripts }
    await fs.writeFile(file, JSON.stringify(pkg, null, 2) + '\n')
}
