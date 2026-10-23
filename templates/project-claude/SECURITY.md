# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately on GitHub: **Security → Report a
vulnerability** of this repository (private vulnerability reporting). Describe what you found, how to reproduce it and
what someone could do with it. You get an answer within a few working days, and you hear when it is fixed.

## Supported versions

Only the latest release (the branch `main`) gets security fixes.

## What is in place

- Every pull request is checked for secrets (gitleaks), known vulnerabilities in the dependencies (`npm audit`) and,
  where GitHub offers it, code scanning (CodeQL). Dependabot proposes updates every week.
- The `security` agent of Claude Code reviews every change that touches login, sessions, tokens, permissions, input or
  data of organisations before it is committed.
