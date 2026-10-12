// Activates the git hooks in ./.githooks (pre-push runs tests + format check).
// Runs automatically after `npm install` (the "postinstall" script; not "prepare", because that would make npx install the dev dependencies too). It does nothing when this is not a git
// checkout, e.g. when the package is installed through npx or as a dependency.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

if (existsSync('.git') && existsSync('.githooks')) {
    spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' })
}
