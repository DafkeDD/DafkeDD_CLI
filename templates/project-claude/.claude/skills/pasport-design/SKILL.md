---
name: pasport-design
description: How to build and change everything UI in ./frontend (Next.js, next-intl, Tailwind CSS) - pages, components, forms, texts on screen, styles - always and only in the Pasport design (src/styles/pasport.css and src/components/pasport), on desktop and on the phone, with the first-login tour. Load it before any page, component, layout, form, text on screen or style, or to check that a UI change follows Pasport.
---

The frontend of this project (`./frontend`: Next.js App Router, next-intl, Tailwind CSS). Every screen that is made or
touched follows the **Pasport design**. No exceptions: **this design is the one to follow**. Not a variation of it, not
another style that "fits", not a component library: the shell, the login screens and the components that are in the
project are the design, and a new screen looks as if it was always part of them.

## Before you change anything

1. Read `.claude/design/pasport.md` (the brand book) and `.claude/design/pasport-tokens.json` (the tokens). The source
   is the Claude Design System "Pasport" (https://claude.ai/artifact/QD82mLA9dWSEgtpubjgChq).
2. Read how the design is built in this project, and copy from it:
    - `frontend/src/styles/pasport.css`: the tokens (light and dark) and every class of the design (`btn`, `card`,
      `field`, `input`, `badge`, `tbl`, `tabs`, `modal`, `page-head`, the shell, the login screens) and the phone
      layout;
    - `frontend/src/components/pasport/`: `ui.tsx` (`Icon`, `Btn`, `Field`, `Input`, `PasswordInput`, `Select`,
      `Toggle`, `Badge`, `Avatar`, `AppIcon`, `ErrorNote`, `OkNote`, `Skeleton`), `widgets.tsx` (`Modal`, `OtpInput`,
      `QrCode`, the charts), `page-state.tsx` (`Loading`, `LoadError`, `Notice`), `toast.tsx` (`useToast`,
      `ThemeToggle`, `LocaleFloat`), `auth-layout.tsx` (the login screen), `shell.tsx` (`Shell`, the rail, the topbar,
      the user's menu), `portal-shell.tsx` (`PortalShell` with the bell and the own status, `useMe`; on the login
      server `CustomerShell` and `AdminShell` with their rails), `eid-required.tsx` (`EidRequired`, `EidReminder`,
      `EidBackBanner`, `useEidStatus`), `page-state.tsx` also has `ClientRedirect`, `i18n.ts` (`useT`),
      `out-of-office.tsx` (`OutOfOfficeDialog`, `OutOfOfficeNotice`) and `tour.tsx` (`Tour`, the first-time tour). Only
      on the login server: `password-card.tsx` (`PasswordCard`) and `customer/my-apps.tsx` (`MyApps`) next to the other
      pages of `customer`, `admin` and `tickets`. Only in a linked app: `page-head.tsx` (`PageHead`: `title`, `text`,
      `actions`) and `profile.tsx`;
    - `frontend/src/lib/portal.ts`: the types of the API and `useApi` / `useData` (the calls of the pages);
    - the pages: on the login server the route groups `src/app/[locale]/(portal)` (the customer portal) and
      `src/app/[locale]/admin/(panel)` (the superadmin panel), whose `layout.tsx` draws the shell, with their
      components in `src/components/pasport/customer`, `admin` and `tickets`; in a linked app `AppPage`
      (`src/components/shell/app-shell.tsx`);
    - an existing page like the one you build (`/dashboard`, `/users`, `/support`, `/admin/tenants`).
3. Read `CLAUDE.md`.

## The Pasport rules

- **The components of the design**: those of `@/components/pasport/*` and the classes of `pasport.css`, and the shell
  (`AppPage`, or the layout of a route group of the login server). Something the design does not have yet is built from
  those classes and tokens, in `src/components/pasport`, so the next screen can use it too. Never another component
  library, icon set or emoji (an icon that is missing goes into `ICONS` of `ui.tsx`, in the same stroke style).
- **Tokens only**: colours, radii, shadows and fonts from the CSS variables (`var(--accent)`, `var(--surface)`,
  `var(--text-2)`, `var(--r-md)`, `var(--sh-sm)`, …). No hex values, no Tailwind colour classes, no new fonts. Light and
  dark must both look right.
- **One shell**: on the login server every page in the route group of the portal or the panel (its layout draws
  `CustomerShell` or `AdminShell`; a new page in the rail goes in their `nav` in `portal-shell.tsx`), in a linked app
  every page in `AppPage` with a new page in the rail through `APP_NAV` (`src/lib/nav.ts`). A linked app never gets a
  login or registration of its own: that is the login server's. The login and account screens use `AuthLayout`.
- **Protected by default**: every page needs a login. `src/proxy.ts` sends a browser without a session to `/login` (and
  back afterwards); only the pages in `PUBLIC_PATHS` are open. Add a page there only when it must be open (a sign-up, a
  public link), never to "make it work".
- **The first-login tour is a MUST**: the first time a user logs in, the app shows a guided tour of all its pages (every
  item of the rail and the main parts of each page), and again from the user menu (not for superadmins, the support
  team: the superadmin panel has no tour). A page or tab you add or change gets its step in the tour, with its texts in
  en, nl, fr and de: a page without its tour step is not done. On the login server the tour is `Tour` in
  `src/components/pasport/tour.tsx`; an app that does not have one yet (DafkeDD_CLI issue #11) lists the tour steps of
  a new page in its pull request.
- **Shape**: a page head (`page-head`, `PageHead` in a linked app) with one primary action; content in
  `card card-pad`; tables in `tbl` inside `table-wrap`; dialogs with `Modal`; no coloured left borders; status is a
  `Badge` with a word; codes and amounts in `t-mono`.
- **The phone is not optional**: every screen works at 390px wide. The rail becomes a drawer behind the menu button,
  the login panel disappears, `page-head` stacks its actions, tables scroll inside `table-wrap`, forms go to one column.
  Check it every time, not only the desktop.
- **Texts**: every text through next-intl in `frontend/messages/{en,nl,fr,de}.json` with the same keys (the
  `translator` skill); Dutch "je/jij", short, active verbs; buttons say what happens, errors say what to do. Never a
  hardcoded string on screen.
- **Accessible and responsive**: labels on every control, visible focus, keyboard reachable, 4.5:1 contrast, works at
  phone width without sideways scrolling.
- **Data**: in a linked app the API of this app through `fetch('/api/app/<path>')`, on the login server its API through
  `/api/backend/<path>` (the token is added on the server); never a token in the browser.

## How to work

Tests or checks first where they exist, then the change, then `npm run lint`, `npm run format:check`,
`npm run check:design` (the design check of the CI: every page in the shell or the login screen, only the components,
icons and colour tokens of the design) and `npm run build` in `./frontend`. A red design check is never "fixed" by
changing the check: change the screen. Look at what you built in a real browser with the Playwright MCP
(`npm run dev`, then the page) at 1440×900 **and** 390×844, in light **and** dark, and take a screenshot of each before
you say it is done; a screen that does not look like the rest of the app is not done. The browser tests of the change
follow the `e2e` skill. Document new pages and calls in `docs/` (the frontend part).

When it is built: stage it and start the checking agents (the `implement` skill); tell the reviewer, the a11y and the qa
agent what to look at.
