# Mods

Claude Code mods (plugins with a hooks module) for this project. They draw in the terminal and in the Code tab of the
desktop app, and need Claude Code 2.1.287 or later (2.1.286 on the desktop). They never replace the hooks of
`.claude/settings.json`: the git guard and the approvals of the checking agents stay there, and they also run in a cloud
session, where a mod draws nothing.

| Mod              | What it does                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checks-desk`    | A line above the prompt with every check of the staged tree and the to-do list of the session (`Tasks 3 of 7 done`, counts only), and `/checks`: a card per checking agent (running, approved, approved for an earlier tree when the commit hook may still take it, not yet). It reads the approvals the hooks write and never writes one |
| `handoff-offer`  | From 75% of the context window, offers to write the handoff (`/handoff`, `.claude/handoff.md`) and go on in a fresh chat                                                                                                                                                                                                                  |
| `screen-share`   | `/screen-share on` hides e-mail addresses, phone numbers, IBANs, Belgian national register and company numbers and amounts on screen, `/screen-share hide <name>` a name too, `/screen-share off` stops. Only the drawing changes: Claude and the stored chat keep the real data. A demo aid, not a guarantee: see below                  |
| `replay-theater` | Anthropic's sample, unchanged (Apache 2.0, see its `LICENSE` and `NOTICE`): `/replay` steps through the edits of the last turn                                                                                                                                                                                                            |
| `mods`           | `/mods`: which mods are on, and the command that switches each                                                                                                                                                                                                                                                                            |

None of them uses the network or a model, approves a tool call or changes a permission. The band above the prompt is
shared: `checks-desk` and `handoff-offer` draw their line above what the other mods draw there. `replay-theater`
(unchanged) does not: while its replay bar shows, it takes the band.

## What screen-share masks, and what not

Masked while it is on: the messages, the input and output of every tool call (a folded group of calls is unfolded so
each call is masked), the output of a command, the panes (also the pane of `replay-theater`), the band above the prompt
and what a mod places on screen.

Not masked:

- the prompt while you type it;
- names, addresses and dates of birth you did not add with `hide`: the patterns only know e-mail addresses, phone
  numbers, IBANs, Belgian national register and company numbers and amounts;
- what another mod draws around what it passes on, or in place of a row: the hooks of installed mods nest in no fixed
  order, so only what is drawn beneath `screen-share` in that chain reaches it. Our own mods draw no personal data in
  the band (`checks-desk` shows counts, never task subjects); a mod of someone else may;
- the hint under a running tool call;
- the words you added stay in the state of the mod for the session, also after `/screen-share off`.

It masks too much as well: a date or a long run of digits can look like a phone number. Check a recording before you
share it, and keep real patient or customer data out of a demo when you can.

## Install

In Claude Code, from the folder of the project:

```text
/plugin marketplace add ./mods
/plugin install checks-desk@dafkedd-mods
/reload-plugins
```

`/plugin disable <name>@dafkedd-mods` switches one off again. Check a mod with `claude plugin validate mods/<name>` and
run its tests with `claude plugin test mods/<name>`.
