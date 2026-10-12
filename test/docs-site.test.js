import test from 'node:test'
import assert from 'node:assert/strict'
import { docsSite, renderDoc } from '../src/docs-site.js'

test('renderDoc lists the h2 headings with unique, document-prefixed ids', () => {
    const { html, headings } = renderDoc('# Title\n\n## First part\n\ntext\n\n## Second part', { id: 'api' })
    assert.deepEqual(
        headings.map(h => h.anchor),
        ['api--first-part', 'api--second-part']
    )
    assert.match(html, /<h2 id="api--first-part">First part<\/h2>/)
})

test('code blocks get a copy button and are escaped', () => {
    const { html } = renderDoc('```bash\necho "<b>"\n```', { id: 'x' })
    assert.match(html, /class="copy"/)
    assert.match(html, /echo &quot;&lt;b&gt;&quot;/)
})

test('raw HTML in the markdown is escaped, not executed', () => {
    const { html } = renderDoc('<script>alert(1)</script>', { id: 'x' })
    assert.doesNotMatch(html, /<script>alert/)
})

test('links between documents stay inside the page, external links open in a new tab', () => {
    const { html } = renderDoc('[API](api.md) and [site](https://example.com)', { id: 'x', links: { 'api.md': 'api' } })
    assert.match(html, /href="#api"/)
    assert.match(html, /href="https:\/\/example.com" target="_blank" rel="noopener"/)
})

test('docsSite builds one page with a sidebar entry per document and works offline', () => {
    const html = docsSite(
        [
            { id: 'index', title: 'Overview', markdown: '# Hi' },
            { id: 'api', title: 'Backend', markdown: '# API\n\n## Endpoints' }
        ],
        { swagger: 'http://localhost:4000/docs' }
    )
    assert.match(html, /^<!doctype html>/)
    assert.match(html, /data-doc="api" href="#api"/)
    assert.match(html, /href="#api--endpoints"/)
    assert.match(html, /Swagger/)
    assert.match(html, /prefers-color-scheme:dark/)
    assert.doesNotMatch(html, /<script src=|<link /)
})
