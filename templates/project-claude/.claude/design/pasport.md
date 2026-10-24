# Pasport design system

The design every frontend made by or with this CLI follows, always. The source of truth is the Claude Design System
"Pasport" (https://claude.ai/artifact/QD82mLA9dWSEgtpubjgChq), synced from DafkeDD_UI (`packages/ui`, branch
`developer`); this file is a copy of its brand book, `pasport-tokens.json` of its tokens. When they differ, the design
system wins: update both copies.

Pasport is the look of the login server and of every app linked to it: one login screen, one shell (sidebar, topbar,
content), one set of components. Only the content of a page changes from app to app; never restyle them per app.

**In this project the design is built in `frontend/src/styles/pasport.css` (the tokens and every class) and
`frontend/src/components/pasport/` (the components), with the shell in `frontend/src/components/shell/`. That is the
design to follow: use those, and build anything new from those classes and tokens — on desktop and on the phone.**

## Content fundamentals

- **Language.** Every screen exists in Dutch, French, English and German. Write Dutch first: short, plain, "je" and
  "jij" (never "u"), active verbs. Examples from the portal: "Inloggen", "Account maken", "Gebruiker uitnodigen", "Nog
  geen account?".
- **Name things the way a practice does.** "Praktijk", "Gebruikers", "Licenties", "Facturen", "Support". Not "tenant",
  "client" or "seat" on screen; those words stay in the code.
- **Buttons say what happens.** "Licentie kopen", not "OK". A confirmation names the result: "De app is gemaakt."
- **Errors say what to do.** "Deze koppelcode is onbekend, al gebruikt of verlopen. Maak een nieuwe op /admin."
- **No emoji** in the interface. Status is a `Badge` with a word, never colour alone.
- **Numbers and codes** (national numbers, link codes, amounts in tables) are set in `mono`.

## Visual foundations

### Colour

- `bg` is the page, `surface` every card, the sidebar and the topbar; `surface-2` nests inside a card, `surface-3` is
  the hover ground.
- `accent` (teal) is the one brand colour: the primary `Button`, links, the active `SidebarItem`, focus, the brand mark.
  Use it sparingly; one primary action per view.
- The active sidebar item is `accent-active` text on `accent-tint` with a 3px `accent` bar on the left.
- Status: `green` success, `amber` warning, `red` danger, `blue` info, `violet` new. Each comes with a `-tint` ground
  and a `-border`; always add a word or icon.
- Charts use `chart-1` to `chart-6` in that order.
- Text: `text` for headings and body, `text-2` for secondary copy, `text-3` only for 12px+ labels that repeat something
  visible elsewhere (3.1:1 on `surface` in light).
- Both themes ship. The app sets `data-theme` on `<html>` with `ThemeProvider` (light, dark or the system setting) and
  offers a `ThemeToggle` in the topbar.

### Type

- One family: Hanken Grotesk (`--font-sans`, Google Fonts), with JetBrains Mono (`--font-mono`) for data.
- Body copy is `body` (14px / 1.6). Page titles are `h1` (26px, 650), card titles `h2` (20px), small headings `h3`
  (16px). Headings are tight: letter-spacing -0.02em, line-height 1.12.
- Section labels above a group of sidebar items or form fields are `eyebrow`: 11–12px, 650, uppercase, letter-spacing
  .08em, in `text-3`.

### Shape, depth and spacing

- Radii: `r-md` (11px) for buttons, inputs and sidebar items; `r-lg` (14px) for cards; `r-xl` (20px) for dialogs;
  `r-full` for badges and avatars.
- Cards are `surface` with a `border` hairline and `sh-sm`; hover lifts to `sh-md`. Menus `sh-lg`, dialogs `sh-xl`. No
  coloured left borders on cards.
- Spacing follows the components: 12–16px gaps in a grid of cards, 20–24px padding in a card, 48px in the login aside.
  There is no spacing scale of its own; controls scale with `data-density` (compact, regular, comfy).
- Layout: sidebar `sidebar-w` (256px; the Pasport rail collapses to 76px icons), topbar `topbar-h` (64px), content at
  most `maxw` (1160px).

### Motion

- Short and quiet: 120–280ms with the standard ease. Cards fade in 7px; menus pop from 97%. Respect
  `prefers-reduced-motion`. The Motion components of Dafke UI are optional and not part of Pasport.

## The two Pasport screens

### The login screen (`PasportLogin`)

The only login of the platform. Every linked app sends its users to the login server, which shows this screen; an app
never has a login or registration form of its own.

- `AuthLayout` (split): the teal `accent` gradient aside on the left with the brand mark, the glass eID card, a title,
  one sentence and "Versleuteld · GDPR"; the form on the right in an `AuthCard`.
- The card says which app the user logs in to: "Inloggen bij Planner".
- Order: `SsoButton` "Aanmelden met eID", `AuthDivider` "of met e-mail", e-mail and password `Field`s, the primary
  `Button`, then "Nog geen account? Account maken" in the footer. Registering always happens here, on the login server.
- The superadmin login (/admin/login) is the same screen with `asideTone="ink"` and the brand mark in `text` on
  `surface`.
- On narrow screens the aside disappears and the card fills the screen.

### The shell

Every app, the login server's own portal included, uses the same shell (`frontend/src/components/shell/`):

- The **icon rail** on the left (`.sidebar`): the shield mark with the product name and a subtitle ("Klantenportaal",
  the app's name, or "Superadmin" in the dark variant of the platform), the pages as `rail-item`s with an icon, section
  labels per organisation. Collapsed to icons by default, expanded by the button in the topbar (remembered).
- The **topbar** (`.topbar`): the menu button, the search for a page (⌘K), the notifications bell (`NotificationBell`, a
  red count of unread ones, a popover with "mark all as read"), the theme button and the user's name, the organisation
  and the `Avatar` (with the online dot) opening the menu: profile, security, language, log out. Something new to tell
  users is a kind in `backend/src/notifications/notifications.store.ts` with its texts and icon in the bell, never an
  alert of its own.
- The **content** (`.content`): a `PageHead` (title, description, one primary action), then the page.
- **On the phone** (≤ 860px) the rail is a drawer behind the menu button with a backdrop, the topbar keeps the menu
  button, the bell and the user, and the content gets smaller padding; forms and grids go to one column.
- Only the rail items and the content belong to the app. Account pages (profile, security, members, licences) live on
  the login server; an app links there.

### The login screens

The login, registration, password, email and invitation screens use `AuthLayout`: the teal panel with the eID card on
the left (dark for the superadmin login at `/admin/login`), the form on the right in `auth-card`, the theme and the
language buttons at the bottom right. On the phone only the form.

## Iconography

- The icon set of the design (`Icon` and `ICONS` in `frontend/src/components/pasport/ui.tsx`): one stroke glyph per
  name, 20px in the rail, 16–18px inline, inheriting `currentColor`. A missing icon is added there in the same style.
- The brand mark is the `shield` icon on an `accent` tile with `r-md` corners (40px, 34px small). There is no logo file:
  the name "Pasport" is set in `h3` weight 700 beside the mark.
- Never mix in another icon library or emoji.

## Using it in code

- In this project: `frontend/src/styles/pasport.css` (imported once by the root layout, after the DafkeDD UI styles) and
  the components of `frontend/src/components/pasport/`. DafkeDD_CLI generates both for the login server and for every
  linked app; `npx --allow-git=all github:DafkeDD/DafkeDD_CLI update` keeps them in step (the styles, the components,
  the shell, the protected routes and their texts; a file you changed gets the new version next to it as
  `<file>.dafkedd-new`).
- `npm run check:design` in `./frontend` (also in the CI) checks the rules a machine can check: every page in `AppPage`,
  or in the login screen (`AuthLayout`) when it is in `PUBLIC_PATHS`; no other component library, icon set or CSS
  framework; no colour written in a page or component (only the tokens). What it cannot see (spacing, the phone, both
  themes) the reviewer and qa check on screenshots.
- The DafkeDD UI components (`@/components/ui`) are installed too (the theme provider, charts); on screen the classes
  and components of Pasport come first.
