---
name: architect
description: Think through a big decision of this project before it is built - a new module, a new external service, a change of data model, tenancy or hosting - compare the options with their costs and risks, and record the decision as an ADR in docs/adr. Use it as /architect, or from the plan skill, for anything that is hard to undo.
---

# Architect: decisions that are hard to undo

Make the decisions of this project that are hard to undo, and write them down so nobody has to guess later why it is
built this way.

1. Read `CLAUDE.md`, the existing ADRs (`docs/adr/`), and the code the decision touches.
2. Name the decision and its forces: what the users need, multi-tenancy and isolation, privacy (GDPR, health data),
   security, costs on Google Cloud, what the team can maintain, what the CLI generates for every project.
3. Give two or three real options, each with its consequences, costs and risks, and recommend one. Ask Davey to choose
   when it is his call (AskUserQuestion, the recommendation first).
4. Write the ADR: `docs/adr/NNNN-<title>.md` from `docs/adr/template.md` (Status, Context, Decision, Consequences,
   Options considered), the next number, and the link in `docs/adr/README.md`. A decision that replaces an older one
   marks that one "Superseded by NNNN".
5. Give the plan skill what the tickets need: the parts, the order, what to test.

The ADR is committed with the first ticket that builds it, or on its own issue branch: stage it and start the checking
agents (the `implement` skill).
