---
name: observability
description: Make sure problems of this project in the cloud are seen before a user calls - structured logs, error reporting, uptime checks, alerts and the budget alert of Google Cloud (Terraform in infra/terraform), and the health endpoints. Use it as /observability for a new service or endpoint that matters, after an incident, or to read what went wrong in production.
---

# Observability: see problems before a user calls

What we see of this project when it runs on Google Cloud (`infra/`; without it, say so and limit yourself to the logs
and health endpoints of the code).

## What must exist

- **Logs**: the backend logs as one JSON line per event in production (Cloud Logging reads `severity`, `message`,
  `httpRequest`, `trace`), with ids and never personal data, tokens or secrets (the privacy agent checks that).
- **Errors**: an uncaught error is logged with its stack (`AllExceptionsFilter`), so Error Reporting groups it; a 4xx
  from the user is not an error.
- **Health**: `GET /health` of the backend answers 200 only when the database answers; the frontend has a page that
  answers without a login.
- **Terraform** (`infra/terraform/monitoring.tf`): uptime checks on the backend health and the frontend (only while
  `enabled`), alert policies for the uptime and for errors in the logs (a log-based metric; add one for the latency
  when the app needs it), an e-mail notification channel (`alert_email`), and the budget alert (`billing_account`,
  `monthly_budget`; 50%, 90%, 100%). Everything follows `enabled`: no alerts on a service that is down on purpose.
- **Runbook**: `infra/README.md` says per alert what it means and what to do first.

## Reading an incident

With `gcloud logging read` and `gcloud error-reporting` (when you have access): what happened, since when, for whom,
the first error; then a `type:bug` issue with the evidence (without personal data) for the diagnose skill.

You never run the Cloud workflow yourself. When it is built: stage it and start the checking agents (the `implement`
skill); say what you changed and what an alert will now catch.
