/**
 * Login with the Belgian eID through DafkeDD eID (https://github.com/DafkeDD/DafkeDD_EID): the library checks the token
 * on the server (@dafkedd/eid/server) and gives the frontend its React hooks (@dafkedd/eid/react). It is installed from
 * the release on GitHub. The users run the DafkeDD eID program (the bridge) on their PC.
 */
export const EID_VERSION = '0.2.0'
export const EID_PACKAGE = `@dafkedd/eid@https://github.com/DafkeDD/DafkeDD_EID/releases/download/v${EID_VERSION}/dafkedd-eid-${EID_VERSION}.tgz`
/**
 * .npmrc of the backend and the frontend when npm refuses packages from a URL (npm 12 and later: `allow-remote` is
 * `none` by default). `root` only allows the URLs in the package.json of the project itself (DafkeDD eID), so
 * `npm install` and `npm ci` keep working later on, and packages deeper in the tree still cannot use a URL.
 */
export const ALLOW_REMOTE_NPMRC =
    '# npm 12+: allow the packages with a URL in package.json (DafkeDD eID), not deeper in the tree\nallow-remote=root\n'

/**
 * Before installing DafkeDD eID: asks npm whether it fetches packages from a URL, and writes .npmrc when it refuses.
 * Older npm versions (that allow it, or do not know the setting) get no .npmrc, so they never warn about it.
 */
export async function allowEidDownload(root, exec, write) {
    // The answer is the last line: npm can print a warning before it (for example about the Node.js version)
    const output = String((await exec('npm', ['config', 'get', 'allow-remote'], { cwd: root })) ?? '')
    const value = output.trim().split(/\r?\n/).pop()?.trim() ?? ''
    if (value === 'none') await write(root, '.npmrc', ALLOW_REMOTE_NPMRC)
    return value === 'none'
}

export const EID_BRIDGE_DOWNLOAD = 'https://github.com/DafkeDD/DafkeDD_EID/releases/latest'
export const EID_BRIDGE_PORT = 47820
/** The PIN of the virtual card of `dafke-eid --mock`. */
export const EID_MOCK_PIN = '1234'
/** npm run eid:mock in the frontend: the bridge with a virtual reader and card, allowed to log in on port 3000. */
export const EID_MOCK_SCRIPT = 'dafke-eid --mock --auth-origin http://localhost:3000'
