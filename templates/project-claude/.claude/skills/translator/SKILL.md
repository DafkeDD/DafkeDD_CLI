---
name: translator
description: How to write the texts of this project in English, Dutch, French and German - the messages of the frontend and the backend (errors, validation, mail), in the Pasport tone. Load it whenever a change adds or changes text on screen, in an email or in an error; the i18n agent checks the result.
---

The texts of this project in four languages: `frontend/messages/{en,nl,fr,de}.json` (next-intl) and
`backend/src/i18n/{en,nl,fr,de}/*.json` (nestjs-i18n: errors, validation, mail). English is the default and the
source; the change usually brings the English (or Dutch) text, and you write the others.

- Every key in all four files, the same namespace and the same placeholders (`{name}`, ICU plurals
  `{count, plural, one {…} other {…}}`), in the same order as the existing keys around it.
- Real, natural translations for Belgian users: Dutch "je/jij" (never "u"), short and active; French "vous", the words
  a Belgian practice uses; German "du". Reuse the words the app already uses for the same thing (read the existing
  messages first: "Praktijk", "Gebruikers", "Licenties").
- The Pasport tone: buttons say what happens ("Gebruiker uitnodigen"), errors say what to do, no "tenant", "seat" or
  technical words on screen, no emoji.
- Texts in emails: the subject, the greeting and the closing too; links stay as placeholders.

When they are written: stage them with the rest of the change and start the checking agents (the `implement` skill);
the i18n agent checks them. Tell it which keys you added or changed.
