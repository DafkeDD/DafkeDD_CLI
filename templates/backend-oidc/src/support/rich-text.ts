/**
 * The messages of a ticket are a small Markdown subset, written by the editor of the frontend: **bold**, _italic_,
 * ~~strike~~, `code`, [text](https://...), backslash escapes (\*), "- " and "1. " lists, a blank line between
 * paragraphs, and images ![name](att:<uuid>) that refer to an attachment of the organisation.
 */

/** References to attachments: ![name](att:<id>) (and a link to one). The id is checked by the service. */
const ATTACHMENT_REF = /\]\(att:([^)\s]*)\)/g
const IMAGE = /!\[[^\]\n]*\]\([^)\s]*\)/g
const LINK = /\[([^\]\n]*)\]\([^)\s]*\)/g
// An escaped punctuation character is hidden in the Unicode Private Use Area while the markup is removed
const ESCAPED = /\\([!-/:-@[-`{-~])/g
const HIDDEN = /[\uE021-\uE07E]/g
const hide = (char: string) => String.fromCharCode(0xe000 + char.charCodeAt(0))

/** The ids of the attachments the text refers to, each once. */
export function attachmentRefs(markdown: string): string[] {
    const text = markdown.replace(ESCAPED, (_match, char: string) => hide(char))
    return [...new Set([...text.matchAll(ATTACHMENT_REF)].map(match => match[1] ?? ''))]
}

/**
 * The text without its markup (notifications, the last message in the lists): an image becomes 🖼, a link its text;
 * **, __, ~~ and backticks go, _italic_ is italic; list markers stay; escapes are undone. Blank lines become one line
 * break, spaces at the ends of the lines go.
 */
export function plainText(markdown: string): string {
    return markdown
        .replace(ESCAPED, (_match, char: string) => hide(char))
        .replace(IMAGE, '🖼')
        .replace(LINK, '$1')
        .replace(/\*\*|__|~~|`/g, '')
        .replace(/(^|[^\p{L}\p{N}])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}])/gmu, '$1$2')
        .replace(HIDDEN, char => String.fromCharCode(char.charCodeAt(0) - 0xe000))
        .split('\n')
        .map(line => line.trim())
        .filter(line => line !== '')
        .join('\n')
}

/** The plain text, at most `max` characters (never half an emoji). */
export function preview(markdown: string, max: number): string {
    const text = plainText(markdown)
    if (text.length <= max) return text
    const cut = text.slice(0, max)
    return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut
}
