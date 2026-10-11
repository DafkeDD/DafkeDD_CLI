# DafkeDD_CLI

Interactieve CLI die per project een frontend installeert. Alles wordt **lokaal in het project** geïnstalleerd (in
`./frontend`), nooit globaal.

## Wat wordt er geïnstalleerd?

| Frontend | Inhoud                                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js  | Next.js (laatste versie) + Tailwind CSS (laatste versie) + next-intl (laatste versie) + react-icons + Prettier, in `./frontend`. Optioneel met [DafkeDD UI](https://github.com/DafkeDD/DafkeDD_UI) |

De CLI stelt vragen, daarna volgt één progressbar voor alle stappen: aanmaken, dependencies installeren, next-intl,
react-icons en Prettier installeren, DafkeDD UI ophalen en installeren, Prettier configureren en een build-controle.

### DafkeDD UI

De CLI vraagt of je [DafkeDD UI](https://github.com/DafkeDD/DafkeDD_UI) wilt installeren:

- **Alle componenten**: voert `dafke-ui init` en `dafke-ui add --all` uit in `./frontend`. Het voorbeeld gebruikt dan
  het thema en de componenten van DafkeDD UI (`ThemeProvider`, `Card`, `Badge`, `Button` en `Select`).
- **Enkel de basis (init)**: alleen config, tokens en helpers. Daarna voeg je zelf componenten toe. Het voorbeeld is dan
  een eenvoudige versie met Tailwind.
- **Nee**: niets.

De componenten komen in `frontend/src/components/ui` (`dafke-ui.json` en `dafke-ui.lock.json` staan in `frontend`) en
`ui.css` wordt geladen in `src/app/globals.css`. De UI-repo (branch `developer`) wordt tijdelijk opgehaald met
`git clone` en daarna opgeruimd; er wordt niets globaal geïnstalleerd (geen `npm link`). Vereist daarom Git.

### react-icons

[react-icons](https://react-icons.github.io/react-icons/) staat als dependency in `frontend`. Gebruik:
`import { FaReact } from 'react-icons/fa'` en dan `<FaReact />`. Importeer altijd uit de submap van de set
(`react-icons/fa`, `react-icons/lu`, ...), dan bundelt Next enkel de iconen die je gebruikt.

### Taal en thema

Rechtsboven staan twee dropdowns (componenten in `src/components`):

- **Taal** (`locale-switcher.tsx`): wisselt tussen English, Nederlands, Français en Deutsch zonder dat de URL verandert.
  De keuze blijft bewaard.
- **Thema** (`theme-switcher.tsx`): **Licht**, **Donker** of **Systeem** (volgt het besturingssysteem). De keuze blijft
  bewaard in `localStorage` en wordt gezet vóór het schilderen, dus zonder flits.

Het thema staat als `data-theme="light|dark"` op `<html>`. Dat is dezelfde schakelaar als die van DafkeDD UI, en
Tailwind's `dark:`-klassen volgen hem ook. Bij een taalwissel zet Next de attributen van `<html>` terug;
`theme-script.tsx` past het opgeslagen thema dan meteen opnieuw toe, zodat het thema niet terugspringt. Met DafkeDD UI
zijn de dropdowns de `Select` van de bibliotheek en gebruikt het thema de `ThemeProvider` (opslagsleutel `lui-theme`).
Een taal toevoegen kan in `src/i18n/routing.ts`, met een bijhorend bestand `messages/<taal>.json` (altijd alle teksten
vertalen).

### Prettier

Prettier en `prettier-plugin-tailwindcss` worden als devDependency geïnstalleerd, met `.prettierrc` (4 spaties, geen
puntkomma's, enkele quotes, `printWidth` 120, `proseWrap: always`) en `.prettierignore`. De scripts `npm run format` en
`npm run format:check` zijn toegevoegd en het project wordt meteen geformatteerd. De map `src/components/ui` wordt
bewust niet geformatteerd, zodat `dafke-ui update` je bestanden niet als "zelf aangepast" ziet. `AGENTS.md` en
`next-env.d.ts` staan ook in `.prettierignore`, want Next.js herschrijft ze zelf.

Er worden vier talen ingesteld: **Engels (`en`, standaard)**, Nederlands (`nl`), Frans (`fr`) en Duits (`de`). Alle
teksten bestaan in alle vier de talen (`messages/en.json`, `nl.json`, `fr.json`, `de.json`). De taal staat niet in de
URL: je surft naar `http://localhost:3000/`, de taal komt uit de keuze van de gebruiker (cookie), anders uit de
browsertaal, en anders is het Engels.

## Installeren

Vereist: [Node.js](https://nodejs.org) 20 of hoger en Git.

### Zonder installatie (aanbevolen)

Ga naar de map van je project en voer uit (haalt de branch `developer` op, de standaardbranch):

```
npx --allow-git=all github:DafkeDD/DafkeDD_CLI
```

> **npm 12 of nieuwer:** npm blokkeert standaard het ophalen van pakketten via git (`allow-git=none`), waardoor je de
> fout `EALLOWGIT` krijgt. Daarom staat `--allow-git=all` in de commando's hieronder. Op npm 11 of ouder mag je die vlag
> weglaten. Permanent aanzetten kan met `npm config set allow-git all`.

### Eenmalig installeren (commando `DafkeDD_CLI`)

```
npm install -g --allow-git=all github:DafkeDD/DafkeDD_CLI
```

Daarna in elke projectmap:

```
DafkeDD_CLI
```

Updaten kan met hetzelfde installatiecommando.

> Dit installeert alleen de CLI zelf globaal. De frontend zelf komt altijd lokaal in `./frontend` van het project.

### Versies

| Doel                                     | Commando                                                |
| ---------------------------------------- | ------------------------------------------------------- |
| Ontwikkelversie (`developer`, standaard) | `npx --allow-git=all github:DafkeDD/DafkeDD_CLI`        |
| Laatste release (`main`)                 | `npx --allow-git=all github:DafkeDD/DafkeDD_CLI#main`   |
| Vaste versie                             | `npx --allow-git=all github:DafkeDD/DafkeDD_CLI#v0.2.0` |

Is de repo privé, dan moet je op die machine ingelogd zijn bij GitHub (`gh auth login` of een SSH-sleutel). Gebruik dan
eventueel `git+ssh://git@github.com/DafkeDD/DafkeDD_CLI.git`.

## Gebruik

1. Ga naar de map van je project.
2. Start de CLI (zie hierboven).
3. Kies de frontend (voorlopig alleen Next.js) en beantwoord de vragen daarover (zoals DafkeDD UI).
4. Als laatste: de vraag of je het project meteen naar een repo wilt pushen. Zo ja: het platform (voorlopig alleen
   GitHub), de naam van de repo (de CLI controleert of die naam al bestaat) en private of public.
5. Wacht tot de progressbar klaar is. Als je koos om te pushen, staat je project (met `./frontend`) daarna als eerste
   commit op GitHub.
6. Start de frontend:

```
cd frontend
npm run dev
```

Bestaat `./frontend` al, dan stopt de CLI zonder iets te verwijderen.

### Repo pushen (GitHub)

De CLI doet `git init` in de projectmap, maakt een eerste commit en maakt met de [GitHub CLI](https://cli.github.com)
(`gh`) de repo aan en pusht. Daarvoor moet `gh` geïnstalleerd zijn en moet je ingelogd zijn (`gh auth login`).

## Lokaal ontwikkelen

Prettier staat ook in deze repo (zelfde `.prettierrc` als in de frontend, ook voor de latere backend): `npm install`,
daarna `npm run format` of `npm run format:check`.

```
git clone https://github.com/DafkeDD/DafkeDD_CLI.git
cd DafkeDD_CLI
npm install
node bin/cli.js
```

Optioneel `npm link` om het commando `DafkeDD_CLI` lokaal te gebruiken.

### Structuur

```
bin/cli.js               # startpunt
src/index.js             # vragen en flow
src/progress.js          # één progressbar voor alle stappen
src/runner.js            # commando's stil uitvoeren
src/frontends/index.js   # lijst van beschikbare frontends
src/frontends/nextjs.js  # Next.js + Tailwind + next-intl + Prettier + DafkeDD UI
```

Een nieuwe frontend toevoegen: maak een bestand in `src/frontends/` (naar het voorbeeld van `nextjs.js`) en registreer
het in `src/frontends/index.js`.

## Branches en releases

- `developer` is de standaardbranch; hier werk je op.
- Een push naar `main` maakt automatisch een nieuwe GitHub release (`.github/workflows/release.yml`).
- Het versienummer telt automatisch +1 bij het patchnummer. Wil je een hogere versie (bijvoorbeeld `0.2.0`), verhoog dan
  `version` in `package.json` voor je naar `main` pusht.

Release maken:

```
git switch main
git merge developer
git push
git switch developer
```

## Changelog

- **0.10.0**: de CLI vraagt of je meteen wilt pushen (alleen dan volgen platform, naam en zichtbaarheid) en controleert
  of de repo-naam al bestaat; DafkeDD UI komt van de branch `developer`; Prettier (met `.prettierrc`) staat nu ook in
  deze CLI-repo (`npm run format`, `npm run format:check`).
- **0.9.0**: taal- en themakeuze staan nu samen in één zwevende pill onderaan (opent naar boven, ook op mobiel); header
  toont enkel het logo.
- **0.8.1**: volgorde van de vragen: eerst de frontend (en DafkeDD UI), pas als laatste de GitHub-vragen.
- **0.8.0**: moderner en cleaner voorbeeldpagina met DafkeDD UI (hero, logo, taal/thema-pillen, kaartjes met de stack en
  react-icons); werkt in licht en donker en op mobiel.
- **0.7.0**: eerste vraag is nu de repo-naam, daarna het platform (alleen GitHub) en private/public; na de installatie
  wordt het project gepusht naar GitHub.
- **0.6.0**: react-icons wordt mee geïnstalleerd in de frontend.
- **0.5.0**: vier talen (Engels standaard, Nederlands, Frans, Duits), het thema springt niet meer terug bij een
  taalwissel, en het voorbeeld gebruikt thema en componenten van DafkeDD UI (bij "alle componenten"). `AGENTS.md` en
  `next-env.d.ts` worden niet meer door Prettier gecontroleerd.
- **0.4.0**: geen taalprefix meer in de URL (`/nl` weg), dropdowns voor taal en thema (licht, donker, systeem), en de
  Tailwind-koppeling van Next.js blijft behouden (de `@theme`-fout in `globals.css` is opgelost: `next.config.ts` wordt
  niet meer overschreven maar aangevuld).
- **0.3.0**: optionele installatie van DafkeDD UI (vraag in de CLI), Prettier met eigen `.prettierrc` en scripts
  `format` / `format:check`.
- **0.2.0**: versienummer bij het opstarten, één progressbar die continu doorloopt over alle stappen, geen
  Node-waarschuwingen (DEP0190) meer op Windows, `.npmignore` toegevoegd (geen `gitignore-fallback`-waarschuwing meer).
- **0.1.0**: eerste versie, Next.js + Tailwind CSS + next-intl in `./frontend`.
