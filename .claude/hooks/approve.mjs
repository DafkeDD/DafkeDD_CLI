#!/usr/bin/env node
// node .claude/hooks/approve.mjs review|tests
// Run by the reviewer agent (after REVIEW: APPROVED) and the tester agent (after TESTS: GREEN), never by the agent that
// made the change. It approves exactly what is staged now; any later change needs a new review and test run.
import { approve } from './approvals.mjs'

const kind = process.argv[2]
try {
    const tree = approve(process.cwd(), kind)
    console.log(`${kind} approved for the staged tree ${tree.slice(0, 12)}`)
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
}
