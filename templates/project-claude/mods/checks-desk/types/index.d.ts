/** One check: the approval kind of .claude/hooks/approvals.mjs and the agent that records it. */
export type Check = { kind: string; agent: string }
/** What the desk shows of one check. */
export type CheckState = {
    kind: string
    agent: string
    /** An approval for the staged tree itself. */
    isApproved: boolean
    /** Only one for an earlier tree: the commit hook accepts it when what changed since is outside its scope. */
    isEarlier: boolean
    isRunning: boolean
    hasRun: boolean
}
/** The staged tree the approvals are for, and every check. */
export type Desk = { tree: string | null; checks: CheckState[] }
/** One item of the to-do list of the session (TaskCreate/TaskUpdate, or TodoWrite). */
export type Task = { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed' }

declare module 'claude-code' {
    interface PluginState {
        'checks-desk': { desk: Shaped<Desk>; tasks: Shaped<Task[]> }
    }
}
