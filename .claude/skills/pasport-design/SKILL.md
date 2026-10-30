---
name: pasport-design
description: How to build and change everything UI of DafkeDD_CLI - the Next.js frontends it generates (templates/frontend-oidc*, templates/frontend-site, src/frontends) - always and only in the Pasport design (pasport.css and components/pasport), on desktop and phone, with the first-login tour. Load it before any page, component, layout, form, text on screen or style, or to check that a UI change follows Pasport.
---

The frontends that DafkeDD_CLI generates (Next.js App Router, next-intl, Tailwind CSS). Every screen that is made or
touched follows the **Pasport design**. That rule has no exceptions: **this design is the one to follow**, as it is
built in the templates (and in `D:\test`, the reference project), not a variation of it.

## Before you change anything

1. Read `templates/project-claude/.claude/design/pasport.md` (the brand book) and `templates/project-claude/.claude/design/pasport-tokens.json` (the tokens). The source
   of truth is the Claude Design System "Pasport" (https://claude.ai/artifact/QD82mLA9dWSEgtpubjgChq), synced from
   DafkeDD_UI. When the copy here looks out of date, say so instead of guessing.
2. Read how the design is built: `templates/frontend-oidc/src/styles/pasport.css` (tokens and every class, the phone
   layout), `templates/frontend-oidc/src/components/pasport/` (`ui.tsx`, `widgets.tsx`, `page-head.tsx`,
   `page-state.tsx`, `toast.tsx`, `auth-layout.tsx`), `templates/frontend-oidc/src/components/shell/` (the shell),
   `account-ui.tsx` (the shared classes of the account pages), and an existing page that is like the one you build.
3. Read `CLAUDE.md` for the rules of the repository.

## The Pasport rules

- **The first-login tour is a MUST.** Every app shows a guided tour of all its pages the first time a user logs in (and
  again from the user menu; not for superadmins, the support team: the superadmin panel has no tour). A page or tab you
  add or change gets its step in the tour, with its texts in en, nl, fr and de; a page without its step is not done.
  The customer portal of the login server has it (`Tour` in `templates/frontend-oidc/src/components/pasport/tour.tsx`,
  on `GuidedTour`), and so has a linked app (`AppTour` in `templates/frontend-oidc-linked/src/components/pasport/app-tour.tsx`:
  every page of `APP_NAV` is a step, its text `AppTour.pages.<label>`). A site, an API frontend and the simple login
  have none: a new page of those lists its tour steps in its pull request.
- **The components of the design.** `@/components/pasport/*` (`Btn`, `Field`, `Input`, `Select`, `Badge`, `Avatar`,
  `Modal`, `PageHead`, `AuthLayout`, `Icon`, …), the classes of `pasport.css` (`card`, `tbl`, `tabs`, `page-head`, …)
  and the shell (`AppPage`). Something new is built from those classes and tokens, in `components/pasport`. Never
  another component library, icon set or emoji.
- **Tokens only.** Colours, radii, shadows and fonts come from the CSS variables of the tokens (`var(--accent)`,
  `var(--surface)`, `var(--text-2)`, `var(--r-md)`, `var(--sh-sm)`, …). No hex values, no Tailwind colour classes
  (`bg-blue-500`), no new fonts. Both themes (light and dark) must look right: never assume a white background.
- **One shell.** Every page of an app sits in `AppPage` (rail, topbar, content up to `maxw`). Only `APP_NAV` and the
  content belong to an app. A linked app never gets its own login or registration: it sends people to the login server.
- **Protected by default.** Every page needs a login (`src/proxy.ts`); only `PUBLIC_PATHS` are open.
- **Layout and shape.** A `PageHead` with one primary action; cards are `surface` with a `border` hairline, `r-lg` and
  `sh-sm`; dialogs `r-xl` and `sh-xl`; no coloured left borders; status is a `Badge` with a word, never colour alone.
  Codes, numbers and amounts in `mono`.
- **Texts.** Every text through next-intl (`useTranslations` / `getTranslations`), in en, nl, fr and de, with the same
  keys. Dutch is "je" and "jij", short, active verbs; buttons say what happens; errors say what to do. Never a hardcoded
  string on screen.
- **Accessible.** Labels on every control, focus visible (`accent` ring), keyboard reachable, contrast 4.5:1 for text
  (`text-3` only for 12px+ repeated labels), `prefers-reduced-motion` respected.
- **Responsive.** It works at phone width (390px): the rail is a drawer, forms and grids go to one column, tables scroll
  inside `table-wrap`, nothing scrolls sideways. Look at it at 1440 and 390 pixels, light and dark.

## How to work

- Tests first, in `test/*.test.js` (the generated files contain what matters, every language has the keys), then the
  change. Generated code that runs gets checked by `npm run verify` (the tester agent does that).
- Documentation: `src/frontends/docs.js` for every new way the frontend calls an API, README and changelog.
- Prettier formats every file you edit (the hook does it); keep the style of the files around you.
- When it is built: stage it and start the checking agents (the `implement` skill); tell the reviewer what to look at.
