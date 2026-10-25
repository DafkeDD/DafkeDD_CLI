'use client'

import { Fragment, useRef, useState, type ReactNode } from 'react'
import { ApiFailure } from '@/lib/portal'
import { useT } from '../i18n'
import { useToast } from '../toast'
import { Icon } from '../ui'

/*
 * The messages of a ticket are a small Markdown subset: **bold**, _italic_, ~~struck~~, `code`, [text](https://…),
 * "- " and "1. " lists, and images ![name](att:<id>) that were uploaded as attachments of the ticket. The editor writes
 * it from what the user sees; RichText shows it with React elements only (never HTML), so a message cannot inject code.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SAFE_URL = /^(https?:\/\/|mailto:)/i
const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/

/** Where the images of a ticket are read: the route of the organisation or of the support team. */
export const IMAGES = {
    customer: '/api/backend/tenants/current/tickets/attachments',
    support: '/api/backend/admin/tickets/attachments'
} as const

// ================================================================ showing a message

/** One line of text with the inline marks. */
function inline(text: string, images: string, key = 'i'): ReactNode[] {
    const out: ReactNode[] = []
    let plain = ''
    let n = 0
    const flush = () => {
        if (plain) out.push(plain)
        plain = ''
    }
    const push = (node: ReactNode) => {
        flush()
        out.push(<Fragment key={`${key}-${n++}`}>{node}</Fragment>)
    }
    /** The index of the closing marker (not escaped), or -1. */
    const close = (marker: string, from: number) => {
        for (let j = from; j < text.length; j++) {
            if (text[j] === '\\') {
                j++
                continue
            }
            if (text.startsWith(marker, j)) return j
        }
        return -1
    }
    const word = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c)

    let i = 0
    while (i < text.length) {
        const c = text[i]
        const rest = text.slice(i)
        if (c === '\\' && i + 1 < text.length) {
            plain += text[i + 1]
            i += 2
            continue
        }
        // ![name](att:<id>)
        const image = /^!\[([^\]]*)\]\(att:([0-9a-f-]{36})\)/i.exec(rest)
        if (image && UUID.test(image[2])) {
            const src = `${images}/${image[2]}`
            push(
                <a href={src} target='_blank' rel='noopener noreferrer' className='rt-image'>
                    {/* eslint-disable-next-line @next/next/no-img-element -- an attachment behind the session, not a static image */}
                    <img src={src} alt={image[1].replace(/\\(.)/g, '$1')} loading='lazy' />
                </a>
            )
            i += image[0].length
            continue
        }
        // [text](https://…)
        const link = /^\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)\)/.exec(rest)
        if (link && SAFE_URL.test(link[2])) {
            push(
                <a href={link[2]} target='_blank' rel='noopener noreferrer nofollow'>
                    {inline(link[1], images, `${key}-${n}`)}
                </a>
            )
            i += link[0].length
            continue
        }
        // A bare web address
        const url = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/.exec(rest)
        if (url && !word(text[i - 1])) {
            push(
                <a href={url[0]} target='_blank' rel='noopener noreferrer nofollow'>
                    {url[0]}
                </a>
            )
            i += url[0].length
            continue
        }
        if (c === '`') {
            const end = text.indexOf('`', i + 1)
            if (end > i + 1) {
                push(<code>{text.slice(i + 1, end)}</code>)
                i = end + 1
                continue
            }
        }
        const pair = rest.startsWith('**') ? 'strong' : rest.startsWith('~~') ? 'del' : null
        if (pair) {
            const end = close(rest.slice(0, 2), i + 2)
            if (end > i + 2) {
                const Tag = pair
                push(<Tag>{inline(text.slice(i + 2, end), images, `${key}-${n}`)}</Tag>)
                i = end + 2
                continue
            }
        }
        // _italic_: not inside a word (snake_case stays as it is)
        if (c === '_' && !word(text[i - 1])) {
            let end = close('_', i + 1)
            while (end > 0 && word(text[end + 1])) end = close('_', end + 1)
            if (end > i + 1) {
                push(<em>{inline(text.slice(i + 1, end), images, `${key}-${n}`)}</em>)
                i = end + 1
                continue
            }
        }
        plain += c
        i++
    }
    flush()
    return out
}

/** A message of a ticket, with its marks, lists and images. */
export function RichText({ text, images }: { text: string; images: string }) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
    const blocks: ReactNode[] = []
    let i = 0
    while (i < lines.length) {
        const match = LIST.exec(lines[i])
        if (match) {
            const ordered = /\d/.test(match[2])
            const items: { depth: number; text: string }[] = []
            while (i < lines.length) {
                const item = LIST.exec(lines[i])
                if (!item || /\d/.test(item[2]) !== ordered) break
                items.push({ depth: Math.min(3, Math.floor(item[1].length / 2)), text: item[3] })
                i++
            }
            const List = ordered ? 'ol' : 'ul'
            blocks.push(
                <List key={blocks.length}>
                    {items.map((item, k) => (
                        <li key={k} style={item.depth ? { marginLeft: item.depth * 18 } : undefined}>
                            {inline(item.text, images, `${blocks.length}-${k}`)}
                        </li>
                    ))}
                </List>
            )
            continue
        }
        if (!lines[i].trim()) {
            i++
            continue
        }
        // A paragraph: the lines until an empty line or a list
        const start = i
        while (i < lines.length && lines[i].trim() && !LIST.test(lines[i])) i++
        const paragraph = lines.slice(start, i)
        blocks.push(
            <p key={blocks.length}>
                {paragraph.map((line, k) => (
                    <Fragment key={k}>
                        {k > 0 && <br />}
                        {inline(line, images, `${blocks.length}-${k}`)}
                    </Fragment>
                ))}
            </p>
        )
    }
    return <div className='rt'>{blocks}</div>
}

// ================================================================ the editor

/** Text as Markdown: the characters with a meaning get a backslash. */
const escape = (text: string) => text.replace(/ /g, ' ').replace(/([\\*_~`[\]!])/g, '\\$1')

/** `**` around a part, without the spaces at its ends (and per line). */
function wrap(inner: string, marker: string) {
    return inner
        .split('\n')
        .map(line => {
            const m = /^(\s*)(.*?)(\s*)$/.exec(line)
            return m && m[2] ? `${m[1]}${marker}${m[2]}${marker}${m[3]}` : line
        })
        .join('\n')
}

const BLOCKS = new Set(['DIV', 'P', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'PRE'])

function inlineMarkdown(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return escape(node.textContent ?? '')
    if (!(node instanceof HTMLElement)) return ''
    const inner = () => Array.from(node.childNodes).map(inlineMarkdown).join('')
    switch (node.tagName) {
        case 'BR':
            return '\n'
        case 'B':
        case 'STRONG':
            return wrap(inner(), '**')
        case 'I':
        case 'EM':
            return wrap(inner(), '_')
        case 'S':
        case 'STRIKE':
        case 'DEL':
            return wrap(inner(), '~~')
        case 'CODE': {
            const code = (node.textContent ?? '').replace(/`/g, "'").replace(/\n/g, ' ')
            return code ? '`' + code + '`' : ''
        }
        case 'A': {
            const href = node.getAttribute('href') ?? ''
            const text = inner()
            return SAFE_URL.test(href) && text ? `[${text}](${href.replace(/\s/g, '%20').replace(/\)/g, '%29')})` : text
        }
        case 'IMG': {
            const id = node.dataset.att
            return id && UUID.test(id) ? `![${escape(node.getAttribute('alt') ?? '')}](att:${id})` : ''
        }
        default:
            return BLOCKS.has(node.tagName) ? blockMarkdown(node).join('\n') : inner()
    }
}

/** The lines of a block: inline parts are joined, every block (a Chrome <div>) starts a new line. */
function blockMarkdown(parent: Node): string[] {
    const out: string[] = []
    let current: string | null = null
    const flush = () => {
        if (current !== null) out.push(current)
        current = null
    }
    for (const child of Array.from(parent.childNodes)) {
        if (child instanceof HTMLElement && (child.tagName === 'UL' || child.tagName === 'OL')) {
            flush()
            let number = 1
            for (const li of Array.from(child.children)) {
                const [first = '', ...more] = blockMarkdown(li)
                out.push((child.tagName === 'OL' ? `${number++}. ` : '- ') + first)
                out.push(...more.map(line => '  ' + line))
            }
        } else if (child instanceof HTMLElement && BLOCKS.has(child.tagName)) {
            flush()
            const lines = blockMarkdown(child)
            out.push(...(lines.length ? lines : ['']))
        } else if (child instanceof HTMLElement && child.tagName === 'BR') {
            out.push(current ?? '')
            current = null
        } else {
            current = (current ?? '') + inlineMarkdown(child)
        }
    }
    flush()
    return out
}

/** What the editor shows, as Markdown (at most one empty line in a row, nothing empty at the ends). */
export function toMarkdown(root: HTMLElement) {
    return blockMarkdown(root)
        .join('\n')
        .split('\n')
        .map(line => line.replace(/\s+$/, ''))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

/** The largest side of an uploaded image; bigger photos are made smaller in the browser first. */
const MAX_SIDE = 1920
/** What the API takes (2 MiB). */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024

const readDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
    })

/** A photo smaller (at most 1920 pixels, WebP or JPEG); a small image or a GIF (animation) stays as it is. */
async function shrink(file: File): Promise<Blob> {
    if (file.type === 'image/gif') return file
    const url = URL.createObjectURL(file)
    try {
        const image = new Image()
        image.src = url
        await image.decode()
        const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
        if (scale === 1 && file.size <= 1024 * 1024) return file
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(image.naturalWidth * scale)
        canvas.height = Math.round(image.naturalHeight * scale)
        canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
        const as = (type: string) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, 0.86))
        const webp = await as('image/webp')
        const blob = webp?.type === 'image/webp' ? webp : await as('image/jpeg')
        return blob && blob.size < file.size ? blob : file
    } catch {
        return file
    } finally {
        URL.revokeObjectURL(url)
    }
}

/** Uploads an image for the ticket (the API checks the type) and gives its id. */
export type Uploader = (image: { filename: string; dataBase64: string }) => Promise<{ id: string }>

type Mark = 'bold' | 'italic' | 'strikeThrough' | 'insertUnorderedList' | 'insertOrderedList'
const MARKS: { cmd: Mark; icon: string; label: string; keys?: string }[] = [
    { cmd: 'bold', icon: 'bold', label: 'bold', keys: 'Ctrl+B' },
    { cmd: 'italic', icon: 'italic', label: 'italic', keys: 'Ctrl+I' },
    { cmd: 'strikeThrough', icon: 'strike', label: 'strike' },
    { cmd: 'insertUnorderedList', icon: 'listBullet', label: 'bulletList' },
    { cmd: 'insertOrderedList', icon: 'listOrdered', label: 'numberedList' }
]

/** A button of the toolbar: it never takes the focus, so the editor keeps its selection. */
function ToolButton({
    icon,
    title,
    on,
    disabled,
    onPress
}: {
    icon: string
    title: string
    on: boolean
    disabled?: boolean
    onPress: () => void
}) {
    return (
        <button
            type='button'
            className={'rte-btn' + (on ? ' on' : '')}
            title={title}
            aria-label={title}
            aria-pressed={on}
            disabled={disabled}
            onMouseDown={e => e.preventDefault()}
            onClick={onPress}
        >
            <Icon name={icon} size={15} />
        </button>
    )
}

const exec = (command: string, value?: string) => {
    // execCommand is old but still the only editing API every browser has for contentEditable
    document.execCommand(command, false, value)
}

/**
 * A message editor: bold, italic, struck, lists, code, links and images (button, paste or drag), Ctrl+Enter sends.
 * It reports Markdown (onChange); give it a new `key` to empty it after sending.
 */
export function RichEditor({
    onChange,
    onSubmit,
    upload,
    images,
    placeholder,
    label,
    disabled,
    minHeight = 92,
    autoFocus
}: {
    onChange: (markdown: string) => void
    onSubmit?: () => void
    upload: Uploader
    images: string
    placeholder?: string
    label?: string
    disabled?: boolean
    minHeight?: number
    autoFocus?: boolean
}) {
    const t = useT('Editor')
    const push = useToast()
    const box = useRef<HTMLDivElement>(null)
    const file = useRef<HTMLInputElement>(null)
    const saved = useRef<Range | null>(null)
    const [active, setActive] = useState<Partial<Record<Mark, boolean>>>({})
    const [empty, setEmpty] = useState(true)
    const [uploading, setUploading] = useState(0)
    const [link, setLink] = useState<string | null>(null)

    const report = () => {
        if (!box.current) return
        const markdown = toMarkdown(box.current)
        setEmpty(!markdown && !box.current.querySelector('img'))
        onChange(markdown)
    }
    const refresh = () => {
        const state: Partial<Record<Mark, boolean>> = {}
        for (const m of MARKS) {
            try {
                state[m.cmd] = document.queryCommandState(m.cmd)
            } catch {
                /* not known in this browser */
            }
        }
        setActive(state)
    }
    /** Remembers where the cursor is (a button or the file dialog takes the focus away). */
    const remember = () => {
        const selection = window.getSelection()
        if (selection?.rangeCount && box.current?.contains(selection.anchorNode))
            saved.current = selection.getRangeAt(0).cloneRange()
    }
    const restore = () => {
        box.current?.focus()
        const selection = window.getSelection()
        if (saved.current && selection) {
            selection.removeAllRanges()
            selection.addRange(saved.current)
        }
    }

    const insertImages = async (files: File[]) => {
        const list = files.filter(f => f.type.startsWith('image/'))
        if (!list.length) return
        setUploading(n => n + list.length)
        for (const original of list) {
            try {
                const blob = await shrink(original)
                if (blob.size > MAX_IMAGE_BYTES) {
                    push(t('imageTooLarge', { name: original.name || 'image' }), 'alert', 'red')
                    continue
                }
                const name = (original.name || 'image').slice(0, 120)
                const { id } = await upload({ filename: name, dataBase64: await readDataUrl(blob) })
                restore()
                const img = `<img src="${images}/${id}" data-att="${id}" alt="${name.replace(/["<>&]/g, '')}">`
                exec('insertHTML', img + '&nbsp;')
                remember()
                report()
            } catch (e) {
                push(e instanceof ApiFailure ? e.message : t('imageFailed'), 'alert', 'red')
            } finally {
                setUploading(n => n - 1)
            }
        }
    }

    const applyLink = () => {
        const href = (link ?? '').trim()
        setLink(null)
        restore()
        if (!href) return
        const url = SAFE_URL.test(href) ? href : 'https://' + href
        const selection = window.getSelection()
        if (selection && !selection.isCollapsed) exec('createLink', url)
        else
            exec(
                'insertHTML',
                `<a href="${url.replace(/["<>]/g, encodeURIComponent)}">${url.replace(/[<>&]/g, '')}</a>&nbsp;`
            )
        report()
    }

    const code = () => {
        const selection = window.getSelection()
        const text = selection?.toString() ?? ''
        exec(
            'insertHTML',
            `<code>${(text || 'code').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c)}</code>&nbsp;`
        )
        report()
    }

    // The buttons of the toolbar; afterwards the active marks are read again
    const toggle = (cmd: Mark) => {
        exec(cmd)
        report()
        refresh()
    }
    const openLink = () => {
        remember()
        setLink('')
    }
    const pickImage = () => {
        remember()
        file.current?.click()
    }

    return (
        <div className={'rte' + (disabled ? ' disabled' : '')}>
            <div className='rte-bar' role='toolbar' aria-label={t('toolbar')}>
                {MARKS.map((m, k) => (
                    <Fragment key={m.cmd}>
                        {k === 3 && <span className='rte-sep' />}
                        <ToolButton
                            icon={m.icon}
                            title={m.keys ? `${t(m.label)} (${m.keys})` : t(m.label)}
                            on={!!active[m.cmd]}
                            disabled={disabled}
                            onPress={() => toggle(m.cmd)}
                        />
                    </Fragment>
                ))}
                <span className='rte-sep' />
                <ToolButton icon='code' title={t('code')} on={false} disabled={disabled} onPress={() => code()} />
                <ToolButton icon='link' title={t('link')} on={false} disabled={disabled} onPress={() => openLink()} />
                <ToolButton
                    icon='image'
                    title={t('image')}
                    on={false}
                    disabled={disabled}
                    onPress={() => pickImage()}
                />
                {uploading > 0 && (
                    <span className='rte-status'>
                        <Icon name='loader' size={13} className='spin' /> {t('uploading')}
                    </span>
                )}
                <input
                    ref={file}
                    type='file'
                    accept='image/png,image/jpeg,image/gif,image/webp'
                    multiple
                    hidden
                    onChange={e => {
                        void insertImages(Array.from(e.target.files ?? []))
                        e.target.value = ''
                    }}
                />
            </div>
            {link !== null && (
                <div className='rte-link'>
                    <input
                        className='input'
                        autoFocus
                        placeholder='https://'
                        aria-label={t('link')}
                        value={link}
                        onChange={e => setLink(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                e.preventDefault()
                                applyLink()
                            } else if (e.key === 'Escape') {
                                setLink(null)
                                restore()
                            }
                        }}
                    />
                    <button type='button' className='btn btn-secondary btn-sm' onClick={applyLink}>
                        {t('linkApply')}
                    </button>
                </div>
            )}
            <div
                ref={box}
                className='rte-area rt'
                contentEditable={!disabled}
                role='textbox'
                aria-multiline='true'
                aria-label={label}
                data-placeholder={placeholder}
                data-empty={empty}
                style={{ minHeight }}
                autoFocus={autoFocus}
                onInput={report}
                onKeyUp={() => {
                    remember()
                    refresh()
                }}
                onMouseUp={() => {
                    remember()
                    refresh()
                }}
                onBlur={remember}
                onKeyDown={e => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault()
                        onSubmit?.()
                    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
                        // No underline in a message
                        e.preventDefault()
                    }
                }}
                onPaste={e => {
                    const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'))
                    e.preventDefault()
                    if (files.length) {
                        remember()
                        void insertImages(files)
                    } else {
                        // Only the text: no colours, fonts or scripts of another page
                        exec('insertText', e.clipboardData.getData('text/plain'))
                    }
                }}
                onDragOver={e => {
                    if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
                }}
                onDrop={e => {
                    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
                    e.preventDefault()
                    if (!files.length) return
                    // The cursor where the image was dropped
                    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY)
                    if (range) saved.current = range
                    else remember()
                    void insertImages(files)
                }}
            />
            <div className='rte-foot'>
                <span>{t('hint')}</span>
                {onSubmit && (
                    <span>
                        <kbd>Ctrl</kbd> + <kbd>Enter</kbd> {t('toSend')}
                    </span>
                )}
            </div>
        </div>
    )
}
