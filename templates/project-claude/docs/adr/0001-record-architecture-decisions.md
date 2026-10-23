# 0001. Record architecture decisions

- **Status**: Accepted
- **Date**: the date this project was made

## Context

This project was made with DafkeDD_CLI and is built further by people and by Claude Code agents. Decisions that are hard
to undo (the data model, multi-tenancy, external services, hosting) must stay understandable for whoever works on it
later, without the conversation in which they were taken.

## Decision

Every such decision is written down as an ADR in `docs/adr`, from `template.md`, by the `architect` agent or by hand,
before it is built.

## Consequences

The reasons behind the code can be found; a change of course is a new ADR, so the history stays.

## Options considered

1. **ADRs in the repository**: next to the code, reviewed in the same pull requests.
2. **A wiki**: separate from the code, so it falls behind.
