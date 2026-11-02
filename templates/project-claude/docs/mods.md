# Claude Code mods

The mods of this project live in [`mods/`](../mods/README.md): a marketplace (`dafkedd-mods`) of Claude Code plugins
that draw in the terminal and in the Code tab of the desktop app. This page says what they may do and why; the README
there has the install steps and what each mod does.

## What a mod may do

- **Draw and read, never decide.** A mod draws a line above the prompt, a pane or a masked row, and reads git, the
  approval files and the agents of the session. It never approves, denies or changes a tool call: the git guard and the
  approvals of the checking agents stay in the hooks of `.claude/settings.json`, which also run in a cloud session where
  a mod draws nothing. A change to a mod needs the security agent too: a mod runs in every session and sees every tool
  call and every drawn row.
- **No network, no model.** None of the mods calls `$.net`, `$.model` or `fetch`; `test/mods.test.js` of DafkeDD_CLI
  checks it, and lists every engine call each mod may make.
- **Shared band.** `checks-desk` and `handoff-offer` draw what the other mods draw above the prompt too, below their own
  line. `replay-theater` (Anthropic's sample, unchanged) takes the band while its replay bar shows.

## The mods

| Mod              | Why                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `checks-desk`    | See which checking agent still has to approve the staged tree, and how far the to-do list is    |
| `handoff-offer`  | Write the handoff before the chat is full, so a fresh chat goes on with everything that matters |
| `screen-share`   | A demo aid that hides personal data on screen while recording; not a guarantee (see the README) |
| `replay-theater` | Anthropic's sample (Apache 2.0, unchanged): step through the edits of the last turn             |
| `mods`           | See which mods are on and the command that switches each (a mod cannot switch plugins itself)   |

## Checking a mod

```text
claude plugin validate mods/<name>
claude plugin test mods/<name>
```

`update` of DafkeDD_CLI keeps `mods/` and this page up to date, and never overwrites a file you changed.
