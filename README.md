# DafkeDD_CLI

Interactieve CLI die per project een frontend installeert. Alles wordt **lokaal in het project** geïnstalleerd (in `./frontend`), nooit globaal.

## Wat wordt er geïnstalleerd?

| Frontend | Inhoud |
| --- | --- |
| Next.js | Next.js (laatste versie) + Tailwind CSS (laatste versie) + next-intl (laatste versie), in `./frontend` |

De CLI stelt vragen, daarna volgt één progressbar voor alle stappen: aanmaken, dependencies installeren, next-intl installeren en configureren, en een build-controle.

Standaard worden de talen `nl` (standaard) en `en` ingesteld, met routing via `/nl` en `/en`.

## Installeren

Vereist: [Node.js](https://nodejs.org) 20 of hoger en Git.

### Zonder installatie (aanbevolen)

Ga naar de map van je project en voer uit:

```
npx --allow-git=all github:DafkeDD/DafkeDD_CLI#main
```

> **npm 12 of nieuwer:** npm blokkeert standaard het ophalen van pakketten via git (`allow-git=none`), waardoor je de fout `EALLOWGIT` krijgt. Daarom staat `--allow-git=all` in de commando's hieronder. Op npm 11 of ouder mag je die vlag weglaten. Permanent aanzetten kan met `npm config set allow-git all`.

### Eenmalig installeren (commando `DafkeDD_CLI`)

```
npm install -g --allow-git=all github:DafkeDD/DafkeDD_CLI#main
```

Daarna in elke projectmap:

```
DafkeDD_CLI
```

Updaten kan met hetzelfde installatiecommando.

> Dit installeert alleen de CLI zelf globaal. De frontend zelf komt altijd lokaal in `./frontend` van het project.

### Versies

| Doel | Commando |
| --- | --- |
| Laatste release (`main`) | `npx --allow-git=all github:DafkeDD/DafkeDD_CLI#main` |
| Vaste versie | `npx --allow-git=all github:DafkeDD/DafkeDD_CLI#v0.2.0` |
| Ontwikkelversie (`developer`) | `npx --allow-git=all github:DafkeDD/DafkeDD_CLI` |

Is de repo privé, dan moet je op die machine ingelogd zijn bij GitHub (`gh auth login` of een SSH-sleutel). Gebruik dan eventueel `git+ssh://git@github.com/DafkeDD/DafkeDD_CLI.git#main`.

## Gebruik

1. Ga naar de map van je project.
2. Start de CLI (zie hierboven).
3. Kies de frontend (voorlopig alleen Next.js).
4. Wacht tot de progressbar klaar is.
5. Start de frontend:

```
cd frontend
npm run dev
```

Bestaat `./frontend` al, dan stopt de CLI zonder iets te verwijderen.

## Lokaal ontwikkelen

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
src/frontends/nextjs.js  # Next.js + Tailwind + next-intl
```

Een nieuwe frontend toevoegen: maak een bestand in `src/frontends/` (naar het voorbeeld van `nextjs.js`) en registreer het in `src/frontends/index.js`.

## Branches en releases

- `developer` is de standaardbranch; hier werk je op.
- Een push naar `main` maakt automatisch een nieuwe GitHub release (`.github/workflows/release.yml`).
- Het versienummer telt automatisch +1 bij het patchnummer. Wil je een hogere versie (bijvoorbeeld `0.2.0`), verhoog dan `version` in `package.json` voor je naar `main` pusht.

Release maken:

```
git switch main
git merge developer
git push
git switch developer
```

## Changelog

- **0.2.0**: één progressbar die continu doorloopt over alle stappen, geen Node-waarschuwingen (DEP0190) meer op Windows, `.npmignore` toegevoegd (geen `gitignore-fallback`-waarschuwing meer).
- **0.1.0**: eerste versie, Next.js + Tailwind CSS + next-intl in `./frontend`.
