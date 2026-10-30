---
name: backup
description: Check that the data of this project can really be brought back - the Cloud SQL backups and point in time, the files bucket, the secrets (OIDC_MASTER_KEY), a restore test into a copy - and write down the result. Use it as /backup monthly (the Backup check issue), before a big migration, or after an incident.
disable-model-invocation: true
---

# Backup: can the data be brought back?

Make sure a lost database or bucket can be brought back. This check changes nothing in the app (no edit, no commit, no
push) and never touches the production data itself.

## Monthly (the issue of the workflow "Backup check")

1. The backups of Cloud SQL exist and are recent (`gcloud sql backups list --instance <name>-db`): daily, the last one
   younger than two days while the database runs.
2. **Restore test**: restore the last backup into a new, temporary instance (`gcloud sql instances clone` or a restore
   to a new instance), connect to it, count the rows of the main tables and of two organisations, check a few
   migrations (`schema_migrations`), then delete the temporary instance. Write the time it took.
3. The files bucket: versioning on, an object of last week can be read back.
4. The secrets that cannot be made again (`OIDC_MASTER_KEY` of a login server): a copy is kept outside Google Cloud
   (ask Davey to confirm; never read or print the secret itself).
5. Write the result in the issue (date, backup used, time, counts, problems) and close it, or open a `type:bug` issue
   for what failed.

## Before a risky migration

An on-demand backup (`gcloud sql backups create`) and the way back written in the pull request.

Ask Davey to run what needs rights you do not have; never use a key file. Say what you checked and the result.
