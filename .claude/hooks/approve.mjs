#!/usr/bin/env node
// node .claude/hooks/approve.mjs review|tests
// Run by the reviewer agent (after REVIEW: APPROVED) and the tester agent (after TESTS: GREEN), never by the agent that
// made the change. It approves what is staged now; a later change needs the review and the tests again (an approval of
// i18n, security, a11y or privacy still counts when only markdown outside CLAUDE.md and .claude/ changed: OUT_OF_SCOPE
// in approvals.mjs).
import { approve } from './approvals.mjs'

const kind = process.argv[2]
try {
    const tree = approve(process.cwd(), kind)
    console.log(`${kind} approved for the staged tree ${tree.slice(0, 12)}`)
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
}
