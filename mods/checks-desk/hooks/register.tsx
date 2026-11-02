import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Check, CheckState, Desk, Task } from '../types'

/*
 * The checking agents and the to-do list at a glance. It only reads: the approvals the hooks write
 * (.git/claude-approvals/<kind>-<tree>, see .claude/hooks/approvals.mjs), the agents and the task tool calls of this
 * session. It never writes an approval, never runs an agent and never blocks or changes a tool call: the commit hook
 * stays the only gate. The band above the prompt is shared: what the other mods draw there stays, below this line.
 */

/** Every check, in the order of the commit hook. The first four are always needed; the others when they ran or approved. */
export const CHECKS: Check[] = [
    { kind: 'review', agent: 'reviewer' },
    { kind: 'tests', agent: 'tester' },
    { kind: 'docs', agent: 'docs' },
    { kind: 'i18n', agent: 'i18n' },
    { kind: 'security', agent: 'security' },
    { kind: 'qa', agent: 'qa' },
    { kind: 'a11y', agent: 'a11y' },
    { kind: 'privacy', agent: 'privacy' }
]
const ALWAYS = new Set(['review', 'tests', 'docs', 'i18n'])
/**
 * The checks whose approval of an earlier tree the commit hook may still take: OUT_OF_SCOPE of approvals.mjs (when
 * only files outside their scope changed since). The review, the tests, the docs check and qa always need the last tree.
 */
export const EARLIER_COUNTS = new Set(['i18n', 'security', 'a11y', 'privacy'])
/** The name of a tree (SHA-1 or SHA-256), as approvals.mjs compares them. */
const TREE = /^[0-9a-f]{40}([0-9a-f]{24})?$/
const PANE = 'checks-desk'

const desk = atom({ plugin: 'checks-desk', key: 'desk' } as const, { tree: null, checks: [] } as Desk, {
    shape: 'desk-2'
})
const tasks = atom({ plugin: 'checks-desk', key: 'tasks' } as const, [] as Task[], { shape: 'tasks-1' })

/** The mark of a check in the bar: approved, approved for an earlier tree, running, ran without approval, not run. */
export const mark = (check: CheckState) =>
    `${check.isApproved ? '✓' : check.isEarlier ? '≈' : check.isRunning ? '…' : check.hasRun ? '✗' : '·'} ${check.kind}`

/** The checks to show: the four that are always needed, and every other one that ran or approved. */
export const shown = (checks: CheckState[]) =>
    checks.filter(
        check => ALWAYS.has(check.kind) || check.isApproved || check.isEarlier || check.isRunning || check.hasRun
    )

/**
 * The line of the to-do list: how many are done and how many are in progress. Never the subjects: a subject can hold a
 * name or an e-mail address, and screen-share only masks what is drawn beneath it in the chain of hooks.
 */
export function taskLine(list: Task[]): string | null {
    if (!list.length) return null
    const done = list.filter(task => task.status === 'completed').length
    const busy = list.filter(task => task.status === 'in_progress').length
    return `Tasks ${done} of ${list.length} done${busy ? `, ${busy} in progress` : ''}`
}

/** What a check shows in its card. */
export const cardText = (check: CheckState) =>
    check.isApproved
        ? 'approved for the staged tree'
        : check.isEarlier
          ? 'approved for an earlier tree: the commit hook takes it when only files outside its scope changed since'
          : check.isRunning
            ? 'running'
            : check.hasRun
              ? 'ran, not approved for this tree: read its report'
              : 'not run yet'

/** Reads the staged tree, the approvals and the agents of this session, and redraws. */
async function refresh($: EngineInterface) {
    const tree = await $.process.run(['git', 'write-tree']).catch(() => null)
    const folder = await $.process.run(['git', 'rev-parse', '--git-path', 'claude-approvals']).catch(() => null)
    const agents = await $.agent.list().catch(() => [])
    const id = tree?.exitCode === 0 ? tree.stdout.trim() : null
    const dir = folder?.exitCode === 0 ? folder.stdout.trim() : null
    const names = dir ? (await $.fs.list(dir).catch(() => [])).map(entry => entry.name) : []
    const checks: CheckState[] = CHECKS.map(check => {
        const mine = agents.filter(agent => agent.type === check.agent)
        const isApproved = Boolean(id) && names.includes(`${check.kind}-${id}`)
        return {
            ...check,
            isApproved,
            isEarlier:
                !isApproved &&
                EARLIER_COUNTS.has(check.kind) &&
                names.some(name => name.startsWith(`${check.kind}-`) && TREE.test(name.slice(check.kind.length + 1))),
            isRunning: mine.some(agent => agent.status === 'running' || agent.status === 'pending'),
            hasRun: mine.length > 0
        }
    })
    await update($, desk, () => ({ tree: id, checks }))
}

export const register: Register = on => {
    on('session.start', async ($, e, next) => {
        await $.command.register({ name: 'checks', description: 'Show the checking agents and their approvals' })
        await refresh($)
        return next(e)
    })

    on('command.run', { command: 'checks' }, async $ => {
        await refresh($)
        await $.ui.open({ id: PANE, title: 'Checks' })
        return { text: 'The checks pane is open.' }
    })

    // A check starts or ends, or a command may have recorded an approval: read again (never changes the call)
    // A failure here never stops the agent or the command: the call goes on
    on('agent.spawn', async ($, e, next) => {
        const result = await next(e)
        await refresh($)
        return result
    }).catch(($, e, next) => next(e))
    // Not a gating event: no .catch needed, and refresh never throws into the turn
    on('turn.complete', async ($, e, next) => {
        const result = await next(e)
        await refresh($).catch(() => undefined)
        return result
    })
    on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
        const result = await next(e)
        if (/approve\.mjs|git (add|commit|reset|restore)/.test(String(e.command ?? ''))) await refresh($)
        return result
    }).catch(($, e, next) => next(e))

    // The to-do list: the task tools of the session, after the engine ran them
    on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
        const result = await next(e)
        const id = (result as { result?: { task?: { id?: string } } }).result?.task?.id
        if (id) await update($, tasks, list => [...list, { id, subject: e.subject, status: 'pending' as const }])
        return result
    }).catch(($, e, next) => next(e))
    on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
        const result = await next(e)
        const status = e.status
        await update($, tasks, list =>
            status === 'deleted'
                ? list.filter(task => task.id !== e.taskId)
                : list.map(task =>
                      task.id === e.taskId
                          ? { ...task, subject: e.subject ?? task.subject, status: status ?? task.status }
                          : task
                  )
        )
        return result
    }).catch(($, e, next) => next(e))
    on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
        const result = await next(e)
        await update($, tasks, () =>
            e.todos.map((todo, index) => ({ id: `todo-${index}`, subject: todo.content, status: todo.status }))
        )
        return result
    }).catch(($, e, next) => next(e))

    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
        const { tree, checks } = await read($, desk)
        const tasksLine = taskLine(await read($, tasks))
        const hasChecks = Boolean(tree) && checks.some(check => check.hasRun || check.isApproved || check.isEarlier)
        const below = await next(e)
        if (e.props.hasSurvey || (!hasChecks && !tasksLine)) return below
        const { Box, Button, Text } = $.ui.resolve(e)
        return (
            <Box flexDirection='column'>
                {hasChecks && (
                    <Box>
                        <Text dimColor>{`Checks ${tree?.slice(0, 7)}: `}</Text>
                        <Text>{`${shown(checks).map(mark).join('  ')} `}</Text>
                        <Button key='open' label='Details' onPress={() => $.ui.open({ id: PANE, title: 'Checks' })} />
                    </Box>
                )}
                {tasksLine && <Text dimColor>{tasksLine}</Text>}
                {below}
            </Box>
        )
    })

    on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
        const { Box, Text } = $.ui.resolve(e)
        const { tree, checks } = await read($, desk)
        return (
            <Box flexDirection='column'>
                <Text dimColor>
                    {tree ? `Staged tree ${tree.slice(0, 12)}` : 'Nothing staged in a git repository.'}
                </Text>
                {shown(checks).map(check => (
                    <Box key={check.kind} flexDirection='column' marginTop={1}>
                        <Text bold>{`${check.kind} (${check.agent})`}</Text>
                        <Text dimColor={!check.isApproved}>{cardText(check)}</Text>
                    </Box>
                ))}
            </Box>
        )
    })
}
