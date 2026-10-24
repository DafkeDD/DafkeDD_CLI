// The Pasport design, checked (npm run check:design, also in the CI). Every rule says what to do instead.
// See .claude/design/pasport.md in the root of the project.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
const src = path.join(root, 'src')

/** Component libraries, icon sets and CSS frameworks next to the design: never in this frontend. */
const FOREIGN = [
    'react-icons',
    'lucide-react',
    '@heroicons/',
    '@fortawesome/',
    '@tabler/icons',
    '@phosphor-icons/',
    '@mui/',
    '@material-ui/',
    'antd',
    '@ant-design/',
    '@chakra-ui/',
    '@mantine/',
    'react-bootstrap',
    'bootstrap',
    'semantic-ui-react',
    '@radix-ui/themes',
    '@nextui-org/',
    '@heroui/',
    '@headlessui/react',
    'primereact',
    'flowbite-react',
    'daisyui'
]

/** The files that make the design itself: they may hold colours and are the only place for new components. */
const DESIGN = ['src/components/pasport/', 'src/components/ui', 'src/styles/']

const files = dir =>
    existsSync(dir)
        ? readdirSync(dir, { recursive: true, withFileTypes: true })
              .filter(entry => entry.isFile())
              .map(entry => path.join(entry.parentPath ?? entry.path, entry.name))
        : []
const rel = file => path.relative(root, file).split(path.sep).join('/')
const read = file => readFileSync(file, 'utf8')

const problems = []
const code = files(src).filter(file => /\.(ts|tsx|js|jsx|mjs|css)$/.test(file))

// 1. Only the components and icons of the design
const imports = /(?:from\s+|import\s*\(\s*|import\s+|@import\s+(?:url\()?)['"]([^'"]+)['"]/g
for (const file of code)
    for (const [, name] of read(file).matchAll(imports))
        if (
            FOREIGN.some(
                foreign => name === foreign.replace(/\/$/, '') || name.startsWith(foreign.replace(/\/?$/, '/'))
            )
        )
            problems.push(
                `${rel(file)}: imports ${name}. Use the components and icons of src/components/pasport (Icon, Btn, Field, ...) and the classes of src/styles/pasport.css.`
            )
const pkg = JSON.parse(read(path.join(root, 'package.json')))
for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }))
    if (FOREIGN.some(foreign => name === foreign.replace(/\/$/, '') || name.startsWith(foreign.replace(/\/?$/, '/'))))
        problems.push(
            `package.json: ${name} does not belong next to the Pasport design. Remove it (npm uninstall ${name}).`
        )

// 2. Colours come from the tokens (var(--accent), var(--text-2), ...), never written in a page or component
for (const file of code.filter(file => /\.(tsx|jsx)$/.test(file) && !DESIGN.some(part => rel(file).startsWith(part))))
    for (const match of read(file).matchAll(/(?:['"`]|:\s*)(#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()/g))
        problems.push(
            `${rel(file)}: the colour ${match[1]}. Use a token of the design: var(--accent), var(--text-2), var(--red), ...`
        )

// 3. Every page sits in the shell (AppPage) or, when it is public, in the login screen (AuthLayout)
const proxy = path.join(src, 'proxy.ts')
const publicPaths = existsSync(proxy)
    ? [...(/PUBLIC_PATHS\s*=\s*\[([^\]]*)\]/.exec(read(proxy))?.[1] ?? '').matchAll(/'([^']+)'/g)].map(
          match => match[1]
      )
    : []
if (!publicPaths.includes('/login'))
    problems.push('src/proxy.ts: PUBLIC_PATHS must exist and contain /login (every other page needs a login).')
/** The page and the components it imports from @/components (one level): the auth screen may live in a form. */
const withComponents = file => {
    const content = read(file)
    const parts = [content]
    for (const [, name] of content.matchAll(/from '@\/components\/([^']+)'/g))
        for (const ext of ['.tsx', '.ts', '/index.tsx']) {
            const target = path.join(src, 'components', name + ext)
            if (existsSync(target)) parts.push(read(target))
        }
    return parts.join('\n')
}
const pages = files(path.join(src, 'app')).filter(file => path.basename(file) === 'page.tsx')
for (const file of pages) {
    const route =
        '/' +
        path
            .relative(path.join(src, 'app'), path.dirname(file))
            .split(path.sep)
            .filter(part => !/^\[locale\]$|^\(.*\)$/.test(part))
            .join('/')
    const content = withComponents(file)
    const isPublic = publicPaths.some(pub => route === pub || route.startsWith(pub + '/'))
    if (isPublic) {
        if (!/AuthLayout|AuthPage/.test(content))
            problems.push(
                `${rel(file)}: a public page (${route}) shows the login screen of the design: AuthLayout (src/components/pasport/auth-layout.tsx).`
            )
    } else if (!/<AppPage[\s>]/.test(content)) {
        problems.push(
            `${rel(file)}: every page sits in the shell: <AppPage> (src/components/shell/app-shell.tsx). A public page belongs in PUBLIC_PATHS of src/proxy.ts.`
        )
    }
}

if (problems.length) {
    console.error(`The Pasport design (.claude/design/pasport.md): ${problems.length} problem(s)\n`)
    for (const problem of problems) console.error('- ' + problem)
    process.exit(1)
}
console.log(`The Pasport design: ${pages.length} pages, ${code.length} files OK.`)
