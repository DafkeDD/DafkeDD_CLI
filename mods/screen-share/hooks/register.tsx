import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { Share } from '../types'

/*
 * A demo aid for a screen recording, not a guarantee. While it is on, what the chat draws has its e-mail addresses,
 * phone numbers, IBANs, Belgian national register and company numbers, amounts and the words you add (names) replaced
 * by ••••. Only the drawing changes (ui.render): the stored chat, what Claude reads and the files stay as they are.
 * Never session.append or session.receive: those would change the data.
 *
 * Fail-closed: when a row hook fails anywhere (reading the state, masking the props, drawing beneath), its `.catch`
 * draws the row as •••• and never as it was. Not masked: the prompt while you type it, names you did not add,
 * addresses and dates, and what another mod draws around what it passes on: hooks of installed mods nest in no fixed
 * order, and only what is drawn beneath this one in the chain reaches it (README.md lists it).
 */

export const MASK = '••••'
/** What is hidden on screen: e-mail, IBAN, Belgian national register and company number, amount, phone number. */
const PATTERNS = [
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g,
    /\b\d{2}[.]?\d{2}[.]?\d{2}[-.]?\d{3}[.]?\d{2}\b/g,
    /\b(?:BE ?)?0\d{3}[. ]?\d{3}[. ]?\d{3}\b/gi,
    /(?:[€$£]\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:EUR|USD|GBP|euro)\b)/gi,
    /(?<![\w.])\+?\d[\d ()/.-]{7,}\d(?!\w|\.\d)/g
]

const share = atom({ plugin: 'screen-share', key: 'share' } as const, { isOn: false, words: [] } as Share)

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The text as it is drawn while sharing: every pattern and every added word (as a whole word) masked. */
export function mask(text: string, words: string[] = []): string {
    if (typeof text !== 'string') return MASK
    let result = text
    for (const pattern of PATTERNS) result = result.replace(pattern, MASK)
    for (const word of words.filter(Boolean))
        result = result.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}(?![\\p{L}\\p{N}])`, 'giu'), MASK)
    return result
}

/** The same for any value a tool result holds: every string in it, the shape kept. */
export function maskDeep(value: unknown, words: string[] = []): unknown {
    if (typeof value === 'string') return mask(value, words)
    if (Array.isArray(value)) return value.map(item => maskDeep(item, words))
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskDeep(item, words)]))
    return value
}

/** A drawn tree with every text in it masked: the strings among the children, and the label of a button. */
export function maskTree<T>(node: T, words: string[] = []): T {
    if (typeof node === 'string') return mask(node, words) as T
    if (!node || typeof node !== 'object') return node
    const element = node as { props?: Record<string, unknown>; children?: unknown[] }
    const props =
        element.props && typeof element.props.label === 'string'
            ? { ...element.props, label: mask(element.props.label, words) }
            : element.props
    const children = Array.isArray(element.children) ? element.children.map(c => maskTree(c, words)) : element.children
    return { ...node, ...(props && { props }), ...(children && { children }) }
}

/** What the command does with its words: on, off, hide a word, or switch (no word). */
export function command(args: string, state: Share): { state: Share; text: string } {
    const [verb = '', ...rest] = args.trim().split(/\s+/)
    const note = ' A demo aid, not a guarantee: names only when added; the prompt you type is not masked.'
    if (verb === 'hide' && rest.length)
        return {
            state: { isOn: true, words: [...new Set([...state.words, rest.join(' ')])] },
            text: `One more word is hidden on screen. Screen share is on.${note}`
        }
    if (!['', 'on', 'off'].includes(verb) || (verb === 'hide' && !rest.length))
        return { state, text: 'Use /screen-share on, /screen-share off or /screen-share hide <name>.' }
    const isOn = verb === 'on' ? true : verb === 'off' ? false : !state.isOn
    return {
        state: { ...state, isOn },
        text: isOn ? `Screen share is on: personal data is hidden on screen.${note}` : 'Screen share is off.'
    }
}

/** Draws a row with its props masked. A failure here is not caught: the hook's `.catch(blank)` draws ••••. */
const masked = (e: any, next: (e: any) => Promise<RenderElement>, props: object) =>
    next({ ...e, props: { ...e.props, ...props } })

/** Draws what is beneath, with every text of the tree masked. A failure is left to `.catch(blank)` as well. */
const maskedTree = async (e: any, next: (e: any) => Promise<RenderElement>, words: string[]) =>
    maskTree(await next(e), words)

/** What a row is drawn as when its hook fails anywhere (state, masking, beneath): ••••, never the row as it was. */
function blank($: EngineInterface, e: any) {
    const { Text } = $.ui.resolve(e)
    return <Text>{MASK}</Text>
}

export const register: Register = on => {
    on('session.start', async ($, e, next) => {
        await $.command.register({
            name: 'screen-share',
            description: 'Hide personal data on screen while recording: on, off, or "hide <name>" (a demo aid)'
        })
        return next(e)
    })

    on('command.run', { command: 'screen-share' }, async ($, e) => {
        const result = command(e.args, await read($, share))
        await update($, share, () => result.state)
        $.ui.status(result.state.isOn ? 'screen share: data hidden' : undefined)
        return { text: result.text }
    })

    // Only what is drawn: the props of the row, every other prop passed on as it was
    on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
        const { isOn, words } = await read($, share)
        return isOn ? masked(e, next, { text: mask(e.props.text, words) }) : next(e)
    }).catch(blank)
    on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
        const { isOn, words } = await read($, share)
        return isOn ? masked(e, next, { text: mask(e.props.text, words) }) : next(e)
    }).catch(blank)
    on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
        const { isOn, words } = await read($, share)
        return isOn ? masked(e, next, { input: maskDeep(e.props.input, words) }) : next(e)
    }).catch(blank)
    on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
        const { isOn, words } = await read($, share)
        return isOn ? masked(e, next, { output: maskDeep(e.props.output, words) }) : next(e)
    }).catch(blank)
    on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
        const { isOn, words } = await read($, share)
        return isOn ? masked(e, next, { text: mask(e.props.text, words) }) : next(e)
    }).catch(blank)
    // A folded group draws paths in its count line: unfolded, each call is a ToolUse row, masked above
    on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
        const { isOn } = await read($, share)
        return isOn ? masked(e, next, { isExpanded: true }) : next(e)
    }).catch(blank)
    // The panes, the band and what is placed: the tree drawn beneath, its texts masked
    on('ui.render', { component: 'Pane' }, async ($, e, next) => {
        const { isOn, words } = await read($, share)
        return isOn ? maskedTree(e, next, words) : next(e)
    }).catch(blank)
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
        const { isOn, words } = await read($, share)
        return isOn ? maskedTree(e, next, words) : next(e)
    }).catch(blank)
    on('ui.render', { component: 'Placed' }, async ($, e, next) => {
        const { isOn, words } = await read($, share)
        return isOn ? maskedTree(e, next, words) : next(e)
    }).catch(blank)
}
