/**
 * Turns the markdown documentation into ONE self-contained web page (docs/index.html): no server, no build step and
 * no dependencies in the generated project. Open the file in a browser. It has a sidebar, a table of contents per
 * document, light/dark mode (follows the system) and copy buttons on the code blocks.
 */
import { Marked } from 'marked'

const escapeHtml = text =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const slug = text =>
    text
        .toLowerCase()
        .replace(/<[^>]+>/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')

/** Renders one markdown document. Returns its HTML and its headings (for the table of contents). */
export function renderDoc(markdown, { id, links = {} } = {}) {
    const headings = []
    const marked = new Marked({
        renderer: {
            // Headings get an id (prefixed with the document) so they can be linked and listed
            heading({ tokens, depth }) {
                const text = this.parser.parseInline(tokens)
                const anchor = `${id}--${slug(text)}`
                if (depth === 2) headings.push({ anchor, text: text.replace(/<[^>]+>/g, '') })
                return `<h${depth} id="${anchor}">${text}</h${depth}>\n`
            },
            // Links to other documents ("api.md") become links inside this page; raw HTML in markdown is escaped
            link({ href, tokens }) {
                const target = links[href] ? `#${links[href]}` : href
                const external = /^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ''
                return `<a href="${escapeHtml(target)}"${external}>${this.parser.parseInline(tokens)}</a>`
            },
            html: ({ text }) => escapeHtml(text),
            code({ text, lang }) {
                return `<div class="code"><button type="button" class="copy">Copy</button><pre><code class="lang-${escapeHtml(lang ?? '')}">${escapeHtml(text)}</code></pre></div>\n`
            }
        }
    })
    return { html: marked.parse(markdown), headings }
}

const CSS = `
:root{--bg:#fff;--fg:#171717;--muted:#6b7280;--line:#e5e7eb;--panel:#f6f7f9;--accent:#4f46e5;--code:#0f172a;--code-fg:#e2e8f0}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0f;--fg:#ededed;--muted:#9ca3af;--line:#26262e;--panel:#14141a;--accent:#818cf8}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.layout{display:grid;grid-template-columns:270px minmax(0,1fr);min-height:100vh}
nav{position:sticky;top:0;height:100vh;overflow:auto;padding:24px 18px;border-right:1px solid var(--line);background:var(--panel)}
nav .brand{font-weight:700;font-size:1.05rem;margin:0 0 18px;padding:0 10px}
nav a{display:block;padding:6px 10px;border-radius:8px;color:var(--fg);text-decoration:none;font-size:.93rem}
nav a:hover{background:var(--line)}
nav a.doc{font-weight:600;margin-top:10px}nav a.doc.active{color:var(--accent)}
nav .toc{display:none;margin:2px 0 6px 8px;border-left:1px solid var(--line)}
nav .toc.open{display:block}nav .toc a{color:var(--muted);padding:4px 10px}
nav .ext{margin-top:18px;border-top:1px solid var(--line);padding-top:12px}
main{padding:40px clamp(18px,5vw,64px) 96px;max-width:920px;width:100%}
section{display:none}section.active{display:block}
h1{font-size:2rem;line-height:1.2;margin:0 0 .8em}
h2{font-size:1.45rem;margin:2.2em 0 .6em;padding-top:.6em;border-top:1px solid var(--line)}
h3{font-size:1.15rem;margin:1.8em 0 .4em}
a{color:var(--accent)}
code{font:.88em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--panel);border:1px solid var(--line);padding:.1em .38em;border-radius:6px}
.code{position:relative;margin:1em 0}
.code pre{margin:0;padding:16px;overflow:auto;background:var(--code);color:var(--code-fg);border-radius:12px}
.code pre code{background:none;border:0;padding:0;color:inherit;font-size:.86rem}
.copy{position:absolute;top:8px;right:8px;border:1px solid #334155;background:#1e293b;color:#cbd5e1;border-radius:8px;padding:3px 10px;font-size:.75rem;cursor:pointer}
table{border-collapse:collapse;width:100%;margin:1em 0;display:block;overflow:auto}
th,td{border:1px solid var(--line);padding:8px 12px;text-align:left;vertical-align:top}th{background:var(--panel)}
blockquote{margin:1em 0;padding:.2em 1em;border-left:4px solid var(--accent);background:var(--panel);border-radius:0 8px 8px 0}
@media (max-width:820px){.layout{grid-template-columns:1fr}nav{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}}
`

const SCRIPT = `
const docs=[...document.querySelectorAll('section')];
function show(){
  const hash=location.hash.slice(1);
  const id=(docs.find(s=>s.id===hash)||docs.find(s=>hash.startsWith(s.id+'--'))||docs[0]).id;
  docs.forEach(s=>s.classList.toggle('active',s.id===id));
  document.querySelectorAll('nav a.doc').forEach(a=>a.classList.toggle('active',a.dataset.doc===id));
  document.querySelectorAll('nav .toc').forEach(t=>t.classList.toggle('open',t.dataset.doc===id));
  if(hash&&hash!==id){const el=document.getElementById(hash);if(el)el.scrollIntoView()}else window.scrollTo(0,0);
}
addEventListener('hashchange',show);show();
document.addEventListener('click',e=>{
  const b=e.target.closest('.copy');if(!b)return;
  navigator.clipboard.writeText(b.nextElementSibling.textContent).then(()=>{b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1500)});
});
`

/**
 * Builds the page. `pages` is `[{ id, title, markdown }]` (the first one is shown first); `swagger` is an optional
 * link to the live API documentation.
 */
export function docsSite(pages, { title = 'Documentation', swagger = null } = {}) {
    const links = Object.fromEntries(pages.map(page => [`${page.id}.md`, page.id]))
    const rendered = pages.map(page => ({ ...page, ...renderDoc(page.markdown, { id: page.id, links }) }))
    const nav = rendered
        .map(
            page =>
                `<a class="doc" data-doc="${page.id}" href="#${page.id}">${escapeHtml(page.title)}</a>` +
                `<div class="toc" data-doc="${page.id}">${page.headings
                    .map(h => `<a href="#${h.anchor}">${h.text}</a>`)
                    .join('')}</div>`
        )
        .join('')
    const sections = rendered.map(page => `<section id="${page.id}">${page.html}</section>`).join('\n')
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="layout">
<nav><p class="brand">${escapeHtml(title)}</p>${nav}${
        swagger
            ? `<div class="ext"><a href="${escapeHtml(swagger)}" target="_blank" rel="noopener">API (Swagger) ↗</a></div>`
            : ''
    }</nav>
<main>
${sections}
</main>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`
}
