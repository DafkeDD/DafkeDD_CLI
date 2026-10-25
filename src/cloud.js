import { confirm } from '@inquirer/prompts'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Google Cloud for a generated project (optional, the CLI asks): Terraform in infra/terraform, a Dockerfile per part,
 * and the GitHub workflow "Cloud" (.github/workflows/cloud.yml), a button on GitHub with four actions:
 * - plan: what would change;
 * - deploy: build the images, push them and start everything;
 * - up: start everything again with the last images;
 * - down: stop everything that costs while it runs (Cloud Run services removed, Cloud SQL stopped); the data, the
 *   images and the secrets stay, so up brings it back as it was.
 * Cloud Run scales to zero by itself when nobody uses the app; down also stops the database.
 */
export const INFRA_DIR = 'infra'
export const TERRAFORM_DIR = 'infra/terraform'
export const DEFAULT_REGION = 'europe-west1'
/** Terraform of the workflow (an exact version, at least two weeks old). */
export const TERRAFORM_VERSION = '1.9.8'
export const NODE_IMAGE = 'node:24-alpine'

/** The question: ready for Google Cloud? */
export async function askCloud({ prompts = { confirm } } = {}) {
    return prompts.confirm({
        message:
            'Klaar zetten voor Google Cloud? (Terraform, Dockerfiles en een GitHub-knop om de app aan en uit te zetten)',
        default: true
    })
}

/** A name Google Cloud accepts for services and instances: lowercase, digits and -, starting with a letter. */
export const cloudName = name => {
    const clean = String(name)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/^([^a-z])/, 'app-$1')
        .slice(0, 20)
        .replace(/-+$/, '')
    return clean || 'app'
}

const hcl = value => JSON.stringify(value)

/** The environment of the backend on Cloud Run, per kind of project (the rest comes from var.backend_env). */
function backendEnv(project) {
    const env = {
        NODE_ENV: '"production"',
        CORS_ORIGIN: 'local.frontend_url',
        // Cloud Run is one proxy in front of the API (the X-Forwarded-For of the user)
        TRUST_PROXY: '"1"'
    }
    if (project.database)
        Object.assign(env, {
            DATABASE_HOST: '"/cloudsql/${google_sql_database_instance.db.connection_name}"',
            DATABASE_PORT: '"5432"',
            DATABASE_USER: 'google_sql_user.app.name',
            DATABASE_NAME: 'google_sql_database.app.name'
        })
    if (project.kind === 'pasport')
        Object.assign(env, {
            OIDC_ISSUER: '"${local.backend_url}/oidc"',
            OIDC_AUDIENCE: 'local.backend_url',
            OIDC_LOGIN_UI_URL: '"${local.frontend_url}/login"',
            APP_URL: 'local.frontend_url',
            PUBLIC_API_URL: 'local.backend_url',
            // The clients with the addresses on Cloud Run (made from config/oidc-clients.json by the workflow)
            OIDC_CLIENTS_FILE: '"config/oidc-clients.cloud.json"',
            OIDC_EID: '"on"',
            // Every account must have its eID linked: on or off (var.eid_required)
            OIDC_EID_REQUIRED: 'var.eid_required',
            // The superadmin made at the first start (the hash of its password: BACKEND_SECRETS)
            OIDC_BOOTSTRAP_ADMIN_EMAIL: 'var.admin_email',
            APP_NAME: hcl(project.name),
            // The invoices: the VAT on top of the prices and who sends them (empty: the default)
            BILLING_VAT_PERCENT: 'var.vat_percent == "" ? "21" : var.vat_percent',
            INVOICE_SELLER_NAME: `var.invoice_seller_name == "" ? ${hcl(project.name)} : var.invoice_seller_name`,
            INVOICE_SELLER_ADDRESS: 'var.invoice_seller_address',
            INVOICE_SELLER_VAT: 'var.invoice_seller_vat',
            INVOICE_SELLER_EMAIL: 'var.invoice_seller_email',
            INVOICE_SELLER_IBAN: 'var.invoice_seller_iban'
        })
    if (project.kind === 'app')
        Object.assign(env, {
            OIDC_ISSUER: 'var.login_issuer',
            OIDC_AUDIENCE: 'var.login_api_url',
            OIDC_CLIENT_IDS: hcl(project.link?.clientId ?? project.name),
            OIDC_PRODUCT: hcl(project.link?.product ?? ''),
            TENANT_ISOLATION: hcl(project.modules?.isolation ?? 'rls'),
            ...(project.modules?.files
                ? { FILES_DRIVER: '"gcs"', GCS_BUCKET: 'google_storage_bucket.files[0].name', GCS_PREFIX: '""' }
                : {})
        })
    return env
}

/** The environment of the frontend on Cloud Run (the NEXT_PUBLIC_ ones are built into the image by the workflow). */
function frontendEnv(project) {
    const env = { NODE_ENV: '"production"', APP_URL: 'local.frontend_url' }
    if (project.kind === 'pasport')
        Object.assign(env, { OIDC_ISSUER: '"${local.backend_url}/oidc"', OIDC_CLIENT_ID: '"frontend"' })
    if (project.kind === 'app')
        Object.assign(env, {
            OIDC_ISSUER: 'var.login_issuer',
            OIDC_CLIENT_ID: hcl(project.link?.clientId ?? project.name),
            OIDC_ACCOUNT_URL: 'var.login_account_url'
        })
    return env
}

const block = (entries, indent = '    ') =>
    Object.entries(entries)
        .map(([key, value]) => `${indent}${key} = ${value}`)
        .join('\n')

/** infra/terraform/versions.tf */
export const versionsTf = name => `terraform {
  required_version = ">= 1.9"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  # The state lives in a private bucket (made once by infra/bootstrap.sh); the workflow passes its name:
  # terraform init -backend-config="bucket=<project>-tfstate"
  backend "gcs" {
    prefix = "${name}"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
`

/** infra/terraform/variables.tf */
export function variablesTf(project, name) {
    return `variable "project_id" {
  description = "The Google Cloud project"
  type        = string
}

variable "region" {
  description = "The region of everything (an EU region keeps the data in the EU)"
  type        = string
  default     = "${DEFAULT_REGION}"
}

variable "name" {
  description = "The prefix of every resource"
  type        = string
  default     = "${name}"
}

variable "enabled" {
  description = "true: the app runs. false: the Cloud Run services are removed and Cloud SQL is stopped; the data, images and secrets stay"
  type        = bool
  default     = true
}

variable "backend_image" {
  description = "The image of the backend (set by the workflow)"
  type        = string
  default     = ""
}

variable "frontend_image" {
  description = "The image of the frontend (set by the workflow)"
  type        = string
  default     = ""
}

variable "frontend_domain" {
  description = "An own domain for the frontend (app.example.com), verified in Google Search Console; empty: the run.app address"
  type        = string
  default     = ""
}

variable "backend_domain" {
  description = "An own domain for the backend (api.example.com), on the same parent domain as the frontend; empty: run.app"
  type        = string
  default     = ""
}

variable "alert_email" {
  description = "Where the alerts go (uptime, errors, budget); empty: no alerts"
  type        = string
  default     = ""
}

variable "billing_account" {
  description = "The billing account (XXXXXX-XXXXXX-XXXXXX) for the budget alert; empty: no budget"
  type        = string
  default     = ""
}

variable "monthly_budget" {
  description = "The monthly budget in euro for the budget alert (50%, 90%, 100%)"
  type        = number
  default     = 50
}

variable "max_instances" {
  description = "The most instances of each service (Cloud Run starts from zero)"
  type        = number
  default     = 2
}
${
    project.database
        ? `
variable "db_tier" {
  description = "The machine of Cloud SQL (db-f1-micro is the smallest; it only costs while it runs)"
  type        = string
  default     = "db-f1-micro"
}

variable "preview" {
  description = "true: a preview of a pull request (.github/workflows/preview.yml)"
  type        = bool
  default     = false
}

variable "db_deletion_protection" {
  description = "Protects the database against terraform destroy"
  type        = bool
  default     = true
}
`
        : ''
}${
        project.modules?.files
            ? `
variable "force_destroy" {
  description = "true: terraform destroy also removes the files bucket with its files (only for a preview)"
  type        = bool
  default     = false
}
`
            : ''
    }${
        project.kind === 'pasport'
            ? `
variable "admin_email" {
  description = "The superadmin made at the first start (its password hash: OIDC_BOOTSTRAP_ADMIN_PASSWORD_HASH in BACKEND_SECRETS)"
  type        = string
}

variable "eid_required" {
  description = "Every account must have its Belgian eID linked (OIDC_EID_REQUIRED): on or off"
  type        = string
  default     = "off"
}

variable "vat_percent" {
  description = "The VAT added to every payment and shown on the invoices (BILLING_VAT_PERCENT); empty: 21"
  type        = string
  default     = "21"
}

variable "invoice_seller_name" {
  description = "Who sends the invoices (INVOICE_SELLER_NAME); empty: the name of the project"
  type        = string
  default     = ""
}

variable "invoice_seller_address" {
  description = "The address of the seller on the invoices, lines separated by | (INVOICE_SELLER_ADDRESS)"
  type        = string
  default     = ""
}

variable "invoice_seller_vat" {
  description = "The VAT number of the seller on the invoices (INVOICE_SELLER_VAT)"
  type        = string
  default     = ""
}

variable "invoice_seller_email" {
  description = "The email address of the seller on the invoices (INVOICE_SELLER_EMAIL)"
  type        = string
  default     = ""
}

variable "invoice_seller_iban" {
  description = "The IBAN for a bank transfer on the invoices (INVOICE_SELLER_IBAN)"
  type        = string
  default     = ""
}
`
            : ''
    }${
        project.kind === 'app'
            ? `
variable "login_issuer" {
  description = "The issuer of the Pasport login server in production (https://…/oidc)"
  type        = string
}

variable "login_api_url" {
  description = "The API of the Pasport login server in production (the aud of its access tokens)"
  type        = string
}

variable "login_account_url" {
  description = "The frontend of the Pasport login server in production (account pages)"
  type        = string
}
`
            : ''
    }
variable "backend_env" {
  description = "More settings of the backend (the .env of ./backend without secrets), such as SMTP_HOST or MAIL_FROM"
  type        = map(string)
  default     = {}
}

variable "frontend_env" {
  description = "More settings of the frontend"
  type        = map(string)
  default     = {}
}

variable "backend_secrets" {
  description = "Secrets of the backend (SMTP_PASSWORD, MOLLIE_API_KEY, ...): the GitHub secret BACKEND_SECRETS as JSON"
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "frontend_secrets" {
  description = "Secrets of the frontend (OIDC_CLIENT_SECRET, ...): the GitHub secret FRONTEND_SECRETS as JSON"
  type        = map(string)
  default     = {}
  sensitive   = true
}
`
}

/** infra/terraform/main.tf */
export function mainTf(project) {
    const backend = project.backend
    const frontend = project.frontend
    const generatedBackendSecrets = [
        ...(project.database ? ['    DATABASE_PASSWORD = random_password.db.result'] : []),
        ...(project.kind === 'pasport'
            ? [
                  '    # Encrypts the signing keys: never changes (keep a copy, see infra/README.md)',
                  '    OIDC_MASTER_KEY = random_id.master_key.hex'
              ]
            : []),
        ...(project.kind === 'login'
            ? ['    # Signs the tokens of the login', '    JWT_SECRET = random_id.jwt.hex']
            : [])
    ]
    const apis = [
        'run.googleapis.com',
        'artifactregistry.googleapis.com',
        'secretmanager.googleapis.com',
        'iam.googleapis.com',
        'monitoring.googleapis.com',
        'logging.googleapis.com',
        'billingbudgets.googleapis.com',
        ...(project.database ? ['sqladmin.googleapis.com'] : []),
        ...(project.modules?.files ? ['storage.googleapis.com'] : [])
    ]
    const service = (part, envLocal) => `
resource "google_service_account" "${part}" {
  account_id   = "\${var.name}-${part}"
  display_name = "${part} of \${var.name} (Cloud Run)"
  depends_on   = [google_project_service.apis]
}

resource "google_secret_manager_secret" "${part}" {
  for_each  = toset(nonsensitive(keys(local.${part}_secrets)))
  secret_id = "\${var.name}-${part}-\${lower(replace(each.key, "_", "-"))}"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "${part}" {
  for_each    = google_secret_manager_secret.${part}
  secret      = each.value.id
  secret_data = local.${part}_secrets[each.key]
}

resource "google_secret_manager_secret_iam_member" "${part}" {
  for_each  = google_secret_manager_secret.${part}
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:\${google_service_account.${part}.email}"
}

resource "google_cloud_run_v2_service" "${part}" {
  count               = var.enabled ? 1 : 0
  name                = local.${part}_service
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.${part}.email
    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }
${
    part === 'backend' && project.database
        ? `    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.db.connection_name]
      }
    }
`
        : ''
}    containers {
      image = var.${part}_image
      ports {
        container_port = 8080
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "${part === 'backend' ? '512Mi' : '1Gi'}"
        }
        # Only CPU while a request runs: the cheapest way
        cpu_idle = true
      }
      dynamic "env" {
        for_each = merge(local.${envLocal}, var.${part}_env)
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = google_secret_manager_secret.${part}
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret_id
              version = "latest"
            }
          }
        }
      }
${
    part === 'backend' && project.database
        ? `      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
`
        : ''
}    }
  }

  depends_on = [google_secret_manager_secret_version.${part}, google_secret_manager_secret_iam_member.${part}]
}

# The own domain, when there is one (DNS: the records shown in the console after the first apply)
resource "google_cloud_run_domain_mapping" "${part}" {
  count    = var.enabled && var.${part}_domain != "" ? 1 : 0
  name     = var.${part}_domain
  location = var.region
  metadata {
    namespace = var.project_id
  }
  spec {
    route_name = google_cloud_run_v2_service.${part}[0].name
  }
}

# Everyone may call it: the app checks who is logged in itself
resource "google_cloud_run_v2_service_iam_member" "${part}_public" {
  count    = var.enabled ? 1 : 0
  name     = google_cloud_run_v2_service.${part}[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
`
    return `data "google_project" "this" {}

locals {
  backend_service  = "\${var.name}-backend"
  frontend_service = "\${var.name}-frontend"
  # The addresses of Cloud Run are known in advance (https://<service>-<project number>.<region>.run.app), so the
  # frontend and the backend can point at each other without a cycle
  run_domain   = "\${data.google_project.this.number}.\${var.region}.run.app"
  # With an own domain (frontend_domain, backend_domain) those are the addresses
  backend_url  = var.backend_domain != "" ? "https://\${var.backend_domain}" : "https://\${local.backend_service}-\${local.run_domain}"
  frontend_url = var.frontend_domain != "" ? "https://\${var.frontend_domain}" : "https://\${local.frontend_service}-\${local.run_domain}"

${backend ? `  backend_env = {\n${block(backendEnv(project))}\n  }\n  backend_secrets = merge({\n${generatedBackendSecrets.join('\n')}\n  }, var.backend_secrets)\n` : ''}${frontend ? `  frontend_env = {\n${block(frontendEnv(project))}\n  }\n  frontend_secrets = merge({\n    # Encrypts the session cookie\n    AUTH_SECRET = random_id.auth_secret.hex\n  }, var.frontend_secrets)\n` : ''}}

resource "google_project_service" "apis" {
  for_each           = toset(${hcl(apis)})
  service            = each.value
  disable_on_destroy = false
}

# The images of the app (pushed by the workflow)
resource "google_artifact_registry_repository" "app" {
  repository_id = var.name
  location      = var.region
  format        = "DOCKER"
  cleanup_policies {
    id     = "keep-the-last-10"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }
  cleanup_policies {
    id     = "delete-older"
    action = "DELETE"
    condition {
      older_than = "2592000s"
    }
  }
  depends_on = [google_project_service.apis]
}
${frontend ? '\nresource "random_id" "auth_secret" {\n  byte_length = 32\n}\n' : ''}${project.kind === 'pasport' ? '\nresource "random_id" "master_key" {\n  byte_length = 32\n}\n' : ''}${project.kind === 'login' ? '\nresource "random_id" "jwt" {\n  byte_length = 32\n}\n' : ''}${
        project.database
            ? `
resource "random_id" "preview_db" {
  byte_length = 2
}

# PostgreSQL. With enabled = false it is stopped (activation_policy NEVER): only the disk is paid for.
resource "google_sql_database_instance" "db" {
  # A preview gets a name of its own every time: Google Cloud keeps a deleted name for a week
  name                = var.preview ? "\${var.name}-db-\${random_id.preview_db.hex}" : "\${var.name}-db"
  database_version    = "POSTGRES_17"
  region              = var.region
  deletion_protection = var.db_deletion_protection

  settings {
    tier              = var.db_tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    activation_policy = var.enabled ? "ALWAYS" : "NEVER"
    disk_size         = 10
    disk_autoresize   = true
    backup_configuration {
      enabled    = true
      start_time = "02:00"
    }
    ip_configuration {
      # No authorized networks: only Cloud Run (through the Cloud SQL connector) gets in
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }
  }
  depends_on = [google_project_service.apis]
}

# ABANDON: terraform destroy (a preview) removes the instance, and with it the database and the user; dropping them
# one by one fails on the tables the user owns
resource "google_sql_database" "app" {
  name            = ${hcl(project.database)}
  instance        = google_sql_database_instance.db.name
  deletion_policy = "ABANDON"
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_sql_user" "app" {
  name            = "app"
  instance        = google_sql_database_instance.db.name
  password        = random_password.db.result
  deletion_policy = "ABANDON"
}

resource "google_project_iam_member" "backend_sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:\${google_service_account.backend.email}"
}
`
            : ''
    }${
        project.modules?.files
            ? `
# The files of the organisations (FILES_DRIVER=gcs): private, in the region of the app
resource "google_storage_bucket" "files" {
  count                       = 1
  name                        = "\${var.project_id}-\${var.name}-files"
  # Only a preview may be removed with its files (force_destroy); production keeps them
  force_destroy               = var.force_destroy
  location                    = upper(var.region)
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  versioning {
    enabled = true
  }
  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "backend_files" {
  bucket = google_storage_bucket.files[0].name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:\${google_service_account.backend.email}"
}
`
            : ''
    }${backend ? service('backend', 'backend_env') : ''}${frontend ? service('frontend', 'frontend_env') : ''}`
}

/** infra/terraform/outputs.tf */
export const outputsTf =
    project => `${project.frontend ? 'output "frontend_url" {\n  value = local.frontend_url\n}\n\n' : ''}${project.backend ? 'output "backend_url" {\n  value = local.backend_url\n}\n\n' : ''}output "enabled" {
  value = var.enabled
}
${project.backend ? '\n# The images that run (the workflow goes back to them when a new deploy does not answer)\noutput "backend_image" {\n  value = var.backend_image\n}\n' : ''}${project.frontend ? '\noutput "frontend_image" {\n  value = var.frontend_image\n}\n' : ''}
output "registry" {
  value = "\${var.region}-docker.pkg.dev/\${var.project_id}/\${google_artifact_registry_repository.app.repository_id}"
}
${project.database ? '\noutput "database_connection" {\n  value = google_sql_database_instance.db.connection_name\n}\n' : ''}`

/** infra/terraform/terraform.tfvars.example: for a run on your own computer (the workflow sets these itself). */
export const tfvarsExample = (project, name) =>
    [
        '# Copy to terraform.tfvars for a run on your own computer (never commit terraform.tfvars).',
        'project_id = "my-project"',
        `region     = "${DEFAULT_REGION}"`,
        `name       = "${name}"`,
        'enabled    = true',
        ...(project.kind === 'pasport'
            ? [
                  'admin_email = "admin@example.com"',
                  '# The invoices: the VAT and who sends them (empty: 21 and the name of the project)',
                  'vat_percent            = "21"',
                  'invoice_seller_name    = ""',
                  'invoice_seller_address = "Dorpsstraat 2|2000 Antwerpen"',
                  'invoice_seller_vat     = "BE0123456789"',
                  'invoice_seller_email   = "billing@example.com"',
                  'invoice_seller_iban    = ""'
              ]
            : []),
        ...(project.kind === 'app'
            ? [
                  'login_issuer      = "https://login.example.com/oidc"',
                  'login_api_url     = "https://login-api.example.com"',
                  'login_account_url = "https://login.example.com"'
              ]
            : []),
        'backend_env = {',
        '  SMTP_HOST = "smtp.example.com"',
        '  SMTP_PORT = "587"',
        '  MAIL_FROM = "App <no-reply@example.com>"',
        '}',
        ''
    ].join('\n')

/** backend/Dockerfile: the NestJS API as a small image for Cloud Run (port from PORT, 8080 there). */
export const backendDockerfile =
    project => `# The API on Cloud Run (built by .github/workflows/cloud.yml). Cloud Run sets PORT (8080).
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc* ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
${project.kind === 'pasport' || project.kind === 'app' ? 'COPY --from=build --chown=node:node /app/config ./config\n' : ''}USER node
EXPOSE 8080
CMD ["node", "dist/main"]
`

/** frontend/Dockerfile: the Next.js frontend; the NEXT_PUBLIC_ settings are built in (passed by the workflow). */
export const frontendDockerfile =
    project => `# The frontend on Cloud Run (built by .github/workflows/cloud.yml). Cloud Run sets PORT (8080).
FROM ${NODE_IMAGE} AS build
WORKDIR /app
${project.backend ? 'ARG NEXT_PUBLIC_API_URL\nENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL\n' : ''}${project.kind === 'app' ? 'ARG NEXT_PUBLIC_PASPORT_API_URL\nENV NEXT_PUBLIC_PASPORT_API_URL=$NEXT_PUBLIC_PASPORT_API_URL\n' : ''}ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json .npmrc* ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE}
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 8080
CMD ["sh", "-c", "npx next start -p \${PORT:-8080}"]
`

export const DOCKERIGNORE = [
    'node_modules',
    '.next',
    'dist',
    'coverage',
    '.env',
    '.env.*',
    '!.env.example',
    'storage',
    '*.log',
    ''
].join('\n')

/** The commands that build and push the images ($REGISTRY, $TAG, $FRONTEND_URL and $BACKEND_URL are set before). */
function imageCommands(project) {
    const images = []
    if (project.backend)
        images.push(
            ...(project.kind === 'pasport'
                ? [
                      '                  # The clients of the login server with the addresses on Cloud Run',
                      '                  sed "s#http://localhost:3000#$FRONTEND_URL#g" ../../backend/config/oidc-clients.json > ../../backend/config/oidc-clients.cloud.json'
                  ]
                : []),
            '                  docker build -t "$REGISTRY/backend:$TAG" -t "$REGISTRY/backend:latest" ../../backend',
            '                  docker push --all-tags "$REGISTRY/backend"'
        )
    if (project.frontend)
        images.push(
            [
                '                  docker build -t "$REGISTRY/frontend:$TAG" -t "$REGISTRY/frontend:latest"',
                ...(project.backend ? ['--build-arg NEXT_PUBLIC_API_URL="$BACKEND_URL"'] : []),
                ...(project.kind === 'app' ? ['--build-arg NEXT_PUBLIC_PASPORT_API_URL="$TF_VAR_login_api_url"'] : []),
                '../../frontend'
            ].join(' '),
            '                  docker push --all-tags "$REGISTRY/frontend"'
        )
    return images.join('\n')
}

const imageVars = project =>
    [
        ...(project.backend ? ['-var "backend_image=$REGISTRY/backend:$TAG"'] : []),
        ...(project.frontend ? ['-var "frontend_image=$REGISTRY/frontend:$TAG"'] : [])
    ].join(' ')

/** The env of the jobs: the GitHub variables and secrets as Terraform variables. */
function workflowEnv(project, { preview = false } = {}) {
    const lines = [
        "            TF_IN_AUTOMATION: '1'",
        '            TF_VAR_project_id: ${{ vars.GCP_PROJECT_ID }}',
        '            TF_VAR_region: ${{ vars.GCP_REGION }}',
        // A preview never gets the secrets of production (a live payment key, the mail login): PREVIEW_* of its own
        `            TF_VAR_backend_secrets: \${{ secrets.${preview ? 'PREVIEW_' : ''}BACKEND_SECRETS || '{}' }}`,
        `            TF_VAR_frontend_secrets: \${{ secrets.${preview ? 'PREVIEW_' : ''}FRONTEND_SECRETS || '{}' }}`
    ]
    if (preview)
        lines.push(
            '            # A preview: its own secrets, no alerts, no budget, no own domains, and it may be removed with its data',
            "            TF_VAR_preview: 'true'",
            "            TF_VAR_alert_email: ''",
            "            TF_VAR_billing_account: ''",
            ...(project.database ? ["            TF_VAR_db_deletion_protection: 'false'"] : []),
            ...(project.modules?.files ? ["            TF_VAR_force_destroy: 'true'"] : [])
        )
    else
        lines.push(
            '            TF_VAR_alert_email: ${{ vars.ALERT_EMAIL }}',
            '            TF_VAR_billing_account: ${{ vars.BILLING_ACCOUNT }}',
            '            TF_VAR_frontend_domain: ${{ vars.FRONTEND_DOMAIN }}',
            '            TF_VAR_backend_domain: ${{ vars.BACKEND_DOMAIN }}'
        )
    if (project.kind === 'pasport')
        lines.push(
            '            TF_VAR_admin_email: ${{ vars.ADMIN_EMAIL }}',
            '            TF_VAR_vat_percent: ${{ vars.VAT_PERCENT }}',
            '            TF_VAR_invoice_seller_name: ${{ vars.INVOICE_SELLER_NAME }}',
            '            TF_VAR_invoice_seller_address: ${{ vars.INVOICE_SELLER_ADDRESS }}',
            '            TF_VAR_invoice_seller_vat: ${{ vars.INVOICE_SELLER_VAT }}',
            '            TF_VAR_invoice_seller_email: ${{ vars.INVOICE_SELLER_EMAIL }}',
            '            TF_VAR_invoice_seller_iban: ${{ vars.INVOICE_SELLER_IBAN }}'
        )
    if (project.kind === 'app')
        lines.push(
            '            TF_VAR_login_issuer: ${{ vars.LOGIN_ISSUER }}',
            '            TF_VAR_login_api_url: ${{ vars.LOGIN_API_URL }}',
            '            TF_VAR_login_account_url: ${{ vars.LOGIN_ACCOUNT_URL }}'
        )
    return lines.join('\n')
}

/** Login to Google Cloud (Workload Identity Federation, no keys), gcloud and the pinned Terraform. */
const setupSteps = () => `            - uses: actions/checkout@v4

            - uses: google-github-actions/auth@v2
              with:
                  workload_identity_provider: \${{ vars.GCP_WIF_PROVIDER }}
                  service_account: \${{ vars.GCP_DEPLOYER }}

            - uses: google-github-actions/setup-gcloud@v2

            - uses: hashicorp/setup-terraform@v3
              with:
                  terraform_version: ${TERRAFORM_VERSION}
                  # Plain output: $(terraform output -raw ...) must be only the value
                  terraform_wrapper: false`

/**
 * The addresses of this stack ($APP: the name of its resources): the own domains when set, else the run.app
 * addresses (known in advance); RUN_*: always the run.app address, for the smoke test (a new domain needs its
 * certificate first).
 */
const addressLines =
    deployCondition => `                  NUMBER=$(gcloud projects describe "$TF_VAR_project_id" --format='value(projectNumber)')
                  RUN_BACKEND="https://$APP-backend-$NUMBER.$TF_VAR_region.run.app"
                  RUN_FRONTEND="https://$APP-frontend-$NUMBER.$TF_VAR_region.run.app"
                  echo "RUN_BACKEND_URL=$RUN_BACKEND" >> "$GITHUB_ENV"
                  echo "RUN_FRONTEND_URL=$RUN_FRONTEND" >> "$GITHUB_ENV"
                  if [ -n "\${TF_VAR_backend_domain:-}" ]; then echo "BACKEND_URL=https://$TF_VAR_backend_domain"; else echo "BACKEND_URL=$RUN_BACKEND"; fi >> "$GITHUB_ENV"
                  if [ -n "\${TF_VAR_frontend_domain:-}" ]; then echo "FRONTEND_URL=https://$TF_VAR_frontend_domain"; else echo "FRONTEND_URL=$RUN_FRONTEND"; fi >> "$GITHUB_ENV"
                  echo "REGISTRY=$TF_VAR_region-docker.pkg.dev/$TF_VAR_project_id/$APP" >> "$GITHUB_ENV"
                  if ${deployCondition}; then echo "TAG=\${{ github.sha }}" >> "$GITHUB_ENV"; else echo "TAG=latest" >> "$GITHUB_ENV"; fi`

/** Every address of the stack must answer (2xx or 3xx) within 5 minutes: a cold start and a database that starts. */
function smokeLines(project) {
    const urls = [
        ...(project.backend ? ['"$RUN_BACKEND_URL/health"'] : []),
        ...(project.frontend ? ['"$RUN_FRONTEND_URL/"'] : [])
    ]
    return `                  for url in ${urls.join(' ')}; do
                    code=000
                    for i in $(seq 1 30); do
                      code=$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' "$url" || true)
                      if [ "$code" -ge 200 ] && [ "$code" -lt 400 ]; then break; fi
                      sleep 10
                    done
                    if [ "$code" -lt 200 ] || [ "$code" -ge 400 ]; then echo "::error::$url answers $code"; exit 1; fi
                    echo "$url: $code"
                  done`
}

/** .github/workflows/cloud.yml: the button on GitHub (Actions → Cloud → Run workflow), and the nightly down. */
export function cloudWorkflow(project, name) {
    const vars = imageVars(project)
    const previous = [
        '                  # As a digest: the tag latest is about to point at the new image',
        '                  digest() {',
        '                    case "$1" in "") ;; *@*) echo "$1" ;; *)',
        '                      d=$(gcloud artifacts docker images describe "$1" --format=\'value(image_summary.digest)\' 2>/dev/null || true)',
        '                      if [ -n "$d" ]; then echo "${1%:*}@$d"; fi ;;',
        '                    esac',
        '                  }',
        ...(project.backend
            ? [
                  '                  echo "PREVIOUS_BACKEND=$(digest "$(terraform output -raw backend_image 2>/dev/null || true)")" >> "$GITHUB_ENV"'
              ]
            : []),
        ...(project.frontend
            ? [
                  '                  echo "PREVIOUS_FRONTEND=$(digest "$(terraform output -raw frontend_image 2>/dev/null || true)")" >> "$GITHUB_ENV"'
              ]
            : [])
    ].join('\n')
    const previousVars = [
        ...(project.backend ? ['-var "backend_image=$PREVIOUS_BACKEND"'] : []),
        ...(project.frontend ? ['-var "frontend_image=$PREVIOUS_FRONTEND"'] : [])
    ].join(' ')
    const hasPrevious = [
        ...(project.backend ? ["env.PREVIOUS_BACKEND != ''"] : []),
        ...(project.frontend ? ["env.PREVIOUS_FRONTEND != ''"] : [])
    ].join(' && ')
    return `name: Cloud

# The button to start and stop the app on Google Cloud (Actions -> Cloud -> Run workflow). Only a person runs it.
#   plan:   show what would change
#   deploy: ${project.database ? 'a backup of the database, then ' : ''}build the images of this commit, push them and start everything;
#           when it does not answer within 5 minutes, the previous images are started again
#   up:     start everything again with the last images
#   down:   stop what costs while it runs (Cloud Run removed, Cloud SQL stopped); data, images and secrets stay
# Every night at 01:00 UTC it runs down by itself, in case someone forgot (the repository variable AUTO_DOWN=off stops
# that). Set up once with infra/bootstrap.sh (see infra/README.md).
on:
    workflow_dispatch:
        inputs:
            action:
                description: 'plan, deploy, up or down'
                type: choice
                options: [plan, deploy, up, down]
                default: plan
    schedule:
        - cron: '0 1 * * *'

concurrency:
    group: cloud
    cancel-in-progress: false

permissions:
    contents: read
    id-token: write

jobs:
    cloud:
        # The nightly down: only once the project is set up (infra/bootstrap.sh) and not with AUTO_DOWN=off
        if: github.event_name != 'schedule' || (vars.AUTO_DOWN != 'off' && vars.TF_STATE_BUCKET != '')
        runs-on: ubuntu-latest
        environment: production
        defaults:
            run:
                working-directory: ${TERRAFORM_DIR}
        env:
            # The nightly run has no input: it is always down
            ACTION: \${{ inputs.action || 'down' }}
            APP: ${name}
${workflowEnv(project)}
        steps:
${setupSteps()}

            - name: Terraform init
              run: |
                  terraform init -input=false -backend-config="bucket=\${{ vars.TF_STATE_BUCKET }}"
                  # Nothing deployed yet: down has nothing to stop (and must not make anything)
                  if [ -z "$(terraform state list 2>/dev/null)" ]; then echo "EMPTY=1" >> "$GITHUB_ENV"; fi

            - name: Addresses and images
              run: |
${addressLines('[ "$ACTION" = deploy ]')}

            - name: Plan
              if: env.ACTION == 'plan'
              run: terraform plan -input=false -var enabled=true ${vars}
${
    project.database
        ? `
            # Before a new version (and its migrations): a backup, when the database runs (a stopped one did not change)
            - name: Backup of the database
              if: env.ACTION == 'deploy'
              run: |
                  if [ "$(gcloud sql instances describe "$APP-db" --format='value(settings.activationPolicy)' 2>/dev/null)" = ALWAYS ]; then
                    gcloud sql backups create --instance="$APP-db" --description="Before deploy of \${{ github.sha }}"
                  else
                    echo "The database is stopped or does not exist yet: no backup needed"
                  fi
`
        : ''
}
            - name: Build and push the images
              if: env.ACTION == 'deploy'
              run: |
                  # The images that run now, to go back to when the new ones do not answer
${previous}
                  # The registry first (on the first deploy it does not exist yet)
                  terraform apply -input=false -auto-approve -target=google_artifact_registry_repository.app
                  gcloud auth configure-docker "$TF_VAR_region-docker.pkg.dev" --quiet
${imageCommands(project)}

            - name: Start
              id: start
              if: env.ACTION == 'deploy' || env.ACTION == 'up'
              run: terraform apply -input=false -auto-approve -var enabled=true ${vars}

            - name: Smoke test
              id: smoke
              if: env.ACTION == 'deploy' || env.ACTION == 'up'
              run: |
${smokeLines(project)}

            # Only when the new version was started and did not answer (not when the build failed: then nothing changed)
            - name: Back to the previous images
              if: failure() && env.ACTION == 'deploy' && (steps.start.outcome == 'failure' || steps.smoke.outcome == 'failure') && ${hasPrevious}
              run: |
                  echo "::error::The new version did not answer: the previous images run again. The database is not rolled back${project.database ? ' (the backup of this run is in Cloud SQL -> Backups)' : ''}."
                  terraform apply -input=false -auto-approve -var enabled=true ${previousVars}

            - name: Stop
              if: env.ACTION == 'down' && env.EMPTY != '1'
              run: terraform apply -input=false -auto-approve -var enabled=false ${vars}

            - name: Summary
              if: env.ACTION != 'plan' && !(env.ACTION == 'down' && env.EMPTY == '1')
              run: |
                  {
                    echo "### $ACTION"
                    echo ""
${project.frontend ? '                    echo "- Frontend: $FRONTEND_URL"\n' : ''}${project.backend ? '                    echo "- Backend: $BACKEND_URL"\n' : ''}                    echo "- Running: $(terraform output -raw enabled)"
                  } >> "$GITHUB_STEP_SUMMARY"
`
}

/**
 * .github/workflows/preview.yml: a whole copy of the app for a pull request into developer with the label preview
 * (its own Cloud Run services and database, its own Terraform state), removed when the pull request is closed or the
 * label is taken off. The address is posted on the pull request.
 */
export function previewWorkflow(project, name) {
    const vars = imageVars(project)
    const links = [
        ...(project.frontend ? ['                  - Frontend: $FRONTEND_URL'] : []),
        ...(project.backend ? ['                  - Backend: $BACKEND_URL'] : [])
    ].join('\n')
    return `name: Preview

# The label "preview" on a pull request into developer: the app of that branch runs on Google Cloud, as a copy of its
# own (its own services${project.database ? ', its own Cloud SQL instance with empty data' : ''} and Terraform state). Every push updates it; closing
# the pull request or removing the label removes all of it again. It costs while the pull request is open: use it for
# a change somebody has to see. Only for branches of this repository (not for forks).
on:
    pull_request:
        branches: [developer]
        types: [labeled, unlabeled, synchronize, reopened, closed]

concurrency:
    group: preview-\${{ github.event.pull_request.number }}
    cancel-in-progress: false

permissions:
    contents: read
    id-token: write
    pull-requests: write

jobs:
    preview:
        # Only for the label preview itself (another label changes nothing), and never for a fork
        if: >-
            github.event.pull_request.head.repo.full_name == github.repository &&
            ((github.event.action != 'labeled' && github.event.action != 'unlabeled') || github.event.label.name == 'preview') &&
            (contains(github.event.pull_request.labels.*.name, 'preview') || github.event.action == 'unlabeled')
        runs-on: ubuntu-latest
        environment: preview
        defaults:
            run:
                working-directory: ${TERRAFORM_DIR}
        env:
            PR: \${{ github.event.pull_request.number }}
            ACTION: \${{ (github.event.action == 'closed' || !contains(github.event.pull_request.labels.*.name, 'preview')) && 'destroy' || 'deploy' }}
            GH_TOKEN: \${{ github.token }}
${workflowEnv(project, { preview: true })}
        steps:
${setupSteps()}

            - name: The name of this preview
              run: |
                  # <name>-pr<number>: at most 20 characters, as the names of the app (Google Cloud limits)
                  APP="$(echo "${name}" | cut -c1-12 | sed 's/-*$//')-pr$PR"
                  echo "APP=$APP" >> "$GITHUB_ENV"
                  echo "TF_VAR_name=$APP" >> "$GITHUB_ENV"

            - name: Terraform init
              run: terraform init -input=false -backend-config="bucket=\${{ vars.TF_STATE_BUCKET }}" -backend-config="prefix=preview/pr-$PR"

            - name: Addresses and images
              run: |
${addressLines('[ "$ACTION" = deploy ]')}

            - name: Build and push the images
              if: env.ACTION == 'deploy'
              run: |
                  terraform apply -input=false -auto-approve -target=google_artifact_registry_repository.app
                  gcloud auth configure-docker "$TF_VAR_region-docker.pkg.dev" --quiet
${imageCommands(project)}

            - name: Start
              if: env.ACTION == 'deploy'
              run: terraform apply -input=false -auto-approve -var enabled=true ${vars}

            - name: Smoke test
              if: env.ACTION == 'deploy'
              run: |
${smokeLines(project)}

            - name: The address on the pull request
              if: env.ACTION == 'deploy'
              run: |
                  BODY="**Preview** of \${{ github.event.pull_request.head.sha }}:
${links}

                  Removed when this pull request is closed or the label preview is removed."
                  gh pr comment "$PR" --repo "\${{ github.repository }}" --edit-last --body "$BODY" || gh pr comment "$PR" --repo "\${{ github.repository }}" --body "$BODY"

            - name: Remove the preview
              if: env.ACTION == 'destroy'
              run: |
                  terraform destroy -input=false -auto-approve ${vars}
                  gh pr comment "$PR" --repo "\${{ github.repository }}" --body "The preview is removed."
`
}

/** infra/bootstrap.sh: run once (Cloud Shell or a computer with gcloud and gh): the state bucket and the deployer. */
export const bootstrapScript = name => `#!/usr/bin/env bash
# Run once per Google Cloud project, in Google Cloud Shell or with gcloud and gh logged in:
#   bash infra/bootstrap.sh <project-id> <owner/repository> [region]
# It makes what Terraform itself needs: the bucket of the Terraform state, a service account for the workflow, and
# Workload Identity Federation so GitHub Actions logs in without a key. Then it sets the GitHub variables.
set -euo pipefail

PROJECT="\${1:?project id}"
REPO="\${2:?owner/repository on GitHub}"
REGION="\${3:-${DEFAULT_REGION}}"
NAME="${name}"
BUCKET="$PROJECT-tfstate"
SA="$NAME-deployer@$PROJECT.iam.gserviceaccount.com"

gcloud config set project "$PROJECT"
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \\
  cloudresourcemanager.googleapis.com serviceusage.googleapis.com storage.googleapis.com

# The Terraform state: private, versioned, in the region of the app
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || \\
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update "gs://$BUCKET" --versioning

# The service account of the workflow
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || \\
  gcloud iam service-accounts create "$NAME-deployer" --display-name="Deploys $NAME (GitHub Actions)"
for ROLE in roles/run.admin roles/cloudsql.admin roles/artifactregistry.admin roles/secretmanager.admin \\
  roles/iam.serviceAccountAdmin roles/iam.serviceAccountUser roles/serviceusage.serviceUsageAdmin \\
  roles/storage.admin roles/resourcemanager.projectIamAdmin roles/monitoring.editor roles/logging.configWriter \\
  roles/cloudsql.viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="$ROLE" --condition=None >/dev/null
done

# GitHub Actions logs in as that account, only from this repository and only from a job of the environment production
# or preview: a workflow of a pull request without that environment gets nothing (run this script again to update it)
gcloud iam workload-identity-pools describe github --location=global >/dev/null 2>&1 || \\
  gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
MAPPING="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.environment=assertion.environment"
CONDITION="assertion.repository == '$REPO' && assertion.environment in ['production', 'preview']"
if gcloud iam workload-identity-pools providers describe github --location=global --workload-identity-pool=github >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc github --location=global --workload-identity-pool=github \\
    --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION"
else
  gcloud iam workload-identity-pools providers create-oidc github --location=global --workload-identity-pool=github \\
    --issuer-uri="https://token.actions.githubusercontent.com" --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION"
fi
NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
POOL="projects/$NUMBER/locations/global/workloadIdentityPools/github"
gcloud iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser \\
  --member="principalSet://iam.googleapis.com/$POOL/attribute.repository/$REPO" >/dev/null

# The settings of the workflow on GitHub
gh variable set GCP_PROJECT_ID --repo "$REPO" --body "$PROJECT"
gh variable set GCP_REGION --repo "$REPO" --body "$REGION"
gh variable set GCP_DEPLOYER --repo "$REPO" --body "$SA"
gh variable set GCP_WIF_PROVIDER --repo "$REPO" --body "$POOL/providers/github"
gh variable set TF_STATE_BUCKET --repo "$REPO" --body "$BUCKET"

# The environments: production only from developer and main; a preview only after your approval (the code of a pull
# request runs with the rights of the deployer). A private repository needs GitHub Pro or Team for these rules.
gh api --method PUT "repos/$REPO/environments/production" --input - --silent <<'JSON' || echo "production: no branch rule (GitHub plan)"
{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
JSON
for BRANCH in developer main; do
  gh api --method POST "repos/$REPO/environments/production/deployment-branch-policies" -f name="$BRANCH" --silent || true
done
OWNER_ID=$(gh api user --jq .id)
gh api --method PUT "repos/$REPO/environments/preview" --input - --silent <<JSON || echo "preview: no required reviewer (GitHub plan)"
{"reviewers": [{"type": "User", "id": $OWNER_ID}], "deployment_branch_policy": null}
JSON
echo "Ready. On GitHub: Actions -> Cloud -> Run workflow -> deploy."
`

/** infra/README.md */
export const infraReadme = (project, name) => `# Google Cloud

This project runs on Google Cloud, made with Terraform (\`infra/terraform\`), and you start and stop it with a button
on GitHub: **Actions → Cloud → Run workflow**.

| Action | What it does |
| --- | --- |
| \`plan\` | Shows what would change, changes nothing |
| \`deploy\` | ${project.database ? 'Makes a backup of the database (when it runs), then builds' : 'Builds'} the images of this commit, pushes them and starts everything. When the new version does not answer within 5 minutes (the smoke test), the previous images are started again and the run fails |
| \`up\` | Starts everything again with the last images |
| \`down\` | Stops what costs while it runs: the Cloud Run services are removed${project.database ? ' and Cloud SQL is stopped' : ''}. The data, the images and the secrets stay: \`up\` brings it back as it was |

**Every night at 01:00 UTC** the workflow runs **down** by itself, in case someone forgot: a test or a demo never
costs a whole month. For an app that has to run day and night, set the repository variable \`AUTO_DOWN\` to \`off\`
(Settings → Secrets and variables → Actions → Variables).

## A preview per pull request

Put the label **preview** on a pull request into \`developer\`: \`.github/workflows/preview.yml\` starts a copy of the app
of that branch (its own services${project.database ? ', its own Cloud SQL instance with empty data' : ''}, its own Terraform state \`preview/pr-<number>\`) and posts its
address on the pull request. Every push updates it; closing the pull request or removing the label removes it all.
It costs while it runs${project.database ? ' (mostly the Cloud SQL instance, about €0.35 a day)' : ''}, so use it when somebody has to see a change.
A preview has its own secrets, never those of production: the GitHub secrets \`PREVIEW_BACKEND_SECRETS\` and
\`PREVIEW_FRONTEND_SECRETS\` (test keys only). The code of a pull request runs with the rights of the deployer, so
\`infra/bootstrap.sh\` makes you the required reviewer of the environment *preview*, lets *production* run only from
\`developer\` and \`main\`, and lets Google Cloud in only from jobs of those two environments. On a private repository
GitHub needs Pro or Team for those rules: then only give people you trust write access.${project.kind === 'app' ? ' The login server only sends people back to addresses it knows: add the address of the preview to the app there (or try the preview without login).' : ''}${project.kind === 'pasport' ? ' The login of a preview has the same limit as the run.app addresses (below): fine to look at, not for real logins.' : ''}

## What runs where

${[
    ...(project.frontend
        ? [`- **Frontend**: Cloud Run \`${name}-frontend\` (scales to zero when nobody uses it).`]
        : []),
    ...(project.backend ? [`- **Backend**: Cloud Run \`${name}-backend\` (scales to zero).`] : []),
    ...(project.database
        ? [
              `- **PostgreSQL 17**: Cloud SQL \`${name}-db\` (\`db-f1-micro\`, daily backups). Stopped with \`down\`: then only the disk is paid for. Only Cloud Run reaches it (Cloud SQL connector).`
          ]
        : []),
    ...(project.modules?.files ? ['- **Files**: a private Cloud Storage bucket (`FILES_DRIVER=gcs`).'] : []),
    '- **Secrets**: Secret Manager (database password, session secret' +
        (project.kind === 'pasport' ? ', `OIDC_MASTER_KEY`' : '') +
        ', and the GitHub secrets `BACKEND_SECRETS` / `FRONTEND_SECRETS`).',
    '- **Images**: Artifact Registry (the last 10, older ones are removed after 30 days).',
    `- Everything in \`${DEFAULT_REGION}\` (Belgium) unless \`GCP_REGION\` says otherwise.`
].join('\n')}

## Set up once

1. A Google Cloud project with billing (console.cloud.google.com).
2. In Cloud Shell (or with \`gcloud\` and \`gh\` logged in): \`bash infra/bootstrap.sh <project-id> <owner/repository>\`.
   It makes the bucket of the Terraform state, a service account for the workflow and Workload Identity Federation
   (no key), and sets the GitHub variables \`GCP_PROJECT_ID\`, \`GCP_REGION\`, \`GCP_DEPLOYER\`, \`GCP_WIF_PROVIDER\`,
   \`TF_STATE_BUCKET\`.
3. On GitHub, Settings → Secrets and variables → Actions:${project.kind === 'app' ? '\n   - variables `LOGIN_ISSUER`, `LOGIN_API_URL`, `LOGIN_ACCOUNT_URL`: the Pasport login server in production;' : ''}${project.kind === 'pasport' ? '\n   - variable `ADMIN_EMAIL`: the superadmin made at the first start;\n   - variables `VAT_PERCENT` (empty: 21) and `INVOICE_SELLER_NAME`, `INVOICE_SELLER_ADDRESS` (lines separated by `|`), `INVOICE_SELLER_VAT`, `INVOICE_SELLER_EMAIL`, `INVOICE_SELLER_IBAN`: who sends the invoices;' : ''}
   - secret \`BACKEND_SECRETS\`: the secrets of the backend as JSON, for example
     \`{"SMTP_PASSWORD": "...", ${project.kind === 'pasport' ? '"MOLLIE_API_KEY": "live_...", "OIDC_BOOTSTRAP_ADMIN_PASSWORD_HASH": "scrypt$..."' : '"SMTP_USER": "..."'}}\`;
   - secret \`FRONTEND_SECRETS\`: those of the frontend (${project.kind === 'app' ? '`OIDC_CLIENT_SECRET` for a confidential app' : 'usually none: `{}`'}).
   The other settings of \`.env\` go in \`backend_env\` (\`infra/terraform/variables.tf\`).
4. Actions → Cloud → Run workflow → **deploy**. The summary shows the addresses.
${
    project.kind === 'app'
        ? '5. On the login server, `/admin` → Apps → this app: add the frontend address of Cloud Run (`https://…run.app/api/auth/callback`, after logout the address itself, back-channel logout `…/api/auth/backchannel-logout`).\n'
        : ''
}${
    project.kind === 'pasport'
        ? '5. Keep a copy of `OIDC_MASTER_KEY` (Secret Manager) somewhere safe: without it the signing keys in the database cannot be read.\n'
        : ''
}
## Alerts and budget

Set the GitHub variables \`ALERT_EMAIL\` (where the alerts go) and, for the budget alert, \`BILLING_ACCOUNT\`
(\`XXXXXX-XXXXXX-XXXXXX\`, Billing → Account management). The deployer needs the role *Billing Account Costs Manager*
on that billing account (Billing → Account management → Add principal: \`GCP_DEPLOYER\`). \`monthly_budget\` is 50 euro
by default (\`infra/terraform/variables.tf\`).

| Alert | What it means | What to do first |
| --- | --- | --- |
| *<name> backend is down* / *frontend is down* | The uptime check failed for 5 minutes | Cloud Run → the service → Logs; a deploy that does not answer is already rolled back by the workflow, otherwise **deploy** of the previous commit |
| *<name> backend errors* | More than 5 errors in 5 minutes | Error Reporting (grouped, with the stack); make a \`type:bug\` issue |
| Budget 50% / 90% / 100% | The costs of the month | Billing → Reports; **down** when the app is not needed |

The uptime checks only exist while the app runs: **down** gives no alerts. The workflow *Backup check* opens an issue
every month for the restore test (the \`backup\` agent).

## Own domain (needed for the login)

The addresses \`*.run.app\` work for a first try, but every Cloud Run service there is a site of its own for the browser,
so the cookies of a login between the frontend and the backend count as third-party cookies, and browsers block those.
For real use give both an own domain on the same parent domain (\`app.example.com\` and \`api.example.com\`):

1. Verify the domain in Google Search Console, and add the service account of the workflow (\`GCP_DEPLOYER\`) as owner.
2. Set the GitHub variables \`FRONTEND_DOMAIN\` and \`BACKEND_DOMAIN\` (Settings → Secrets and variables → Actions) and
   run **deploy**.
3. Add the DNS records Cloud Run shows (Cloud Run → Manage custom domains). The certificates follow by themselves.

## Costs

Cloud Run costs nothing while nobody uses the app (it starts in a few seconds on the next visit).${project.database ? ' Cloud SQL costs while it runs (about €10 a month for `db-f1-micro`) and only its disk while it is stopped: use **down** when the app is not needed (a test, a demo).' : ''} Artifact Registry, Secret Manager and the state bucket cost cents.

## On your own computer

\`\`\`
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # fill in, never commit
terraform init -backend-config="bucket=<project>-tfstate"
terraform plan
\`\`\`
`

/** infra/terraform/monitoring.tf: uptime checks, alerts and the budget alert (all off while enabled = false). */
export function monitoringTf(project) {
    const checks = [
        ...(project.backend ? [['backend', 'backend_url', '/health']] : []),
        ...(project.frontend ? [['frontend', 'frontend_url', '/']] : [])
    ]
    return `# What we see of the app in production (the observability agent owns this file). Alerts go to alert_email;
# while enabled = false (the action down) there are no uptime checks, so no alerts about a service that is off.

resource "google_monitoring_notification_channel" "email" {
  count        = var.alert_email != "" ? 1 : 0
  display_name = "\${var.name} alerts"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
  depends_on = [google_project_service.apis]
}

locals {
  alert_channels = google_monitoring_notification_channel.email[*].id
  watch          = var.enabled && var.alert_email != ""
}
${checks
    .map(
        ([part, url, pathname]) => `
resource "google_monitoring_uptime_check_config" "${part}" {
  count        = local.watch ? 1 : 0
  display_name = "\${var.name} ${part}"
  timeout      = "10s"
  period       = "300s"
  http_check {
    path         = "${pathname}"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = trimprefix(local.${url}, "https://")
    }
  }
}

resource "google_monitoring_alert_policy" "${part}_down" {
  count        = local.watch ? 1 : 0
  display_name = "\${var.name} ${part} is down"
  combiner     = "OR"
  conditions {
    display_name = "Uptime check fails"
    condition_threshold {
      filter          = "metric.type=\\"monitoring.googleapis.com/uptime_check/check_passed\\" AND resource.type=\\"uptime_url\\" AND metric.label.check_id=\\"\${google_monitoring_uptime_check_config.${part}[0].uptime_check_id}\\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }
    }
  }
  notification_channels = local.alert_channels
  documentation {
    content = "See infra/README.md, Alerts: ${part} is down."
  }
}
`
    )
    .join('')}${
        project.backend
            ? `
# Errors in the logs of the backend (severity ERROR or worse)
resource "google_logging_metric" "backend_errors" {
  name   = "\${var.name}-backend-errors"
  filter = "resource.type=\\"cloud_run_revision\\" AND resource.labels.service_name=\\"\${local.backend_service}\\" AND severity>=ERROR"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
  depends_on = [google_project_service.apis]
}

resource "google_monitoring_alert_policy" "backend_errors" {
  count        = local.watch ? 1 : 0
  display_name = "\${var.name} backend errors"
  combiner     = "OR"
  conditions {
    display_name = "More than 5 errors in 5 minutes"
    condition_threshold {
      filter          = "metric.type=\\"logging.googleapis.com/user/\${google_logging_metric.backend_errors.name}\\" AND resource.type=\\"cloud_run_revision\\""
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
  notification_channels = local.alert_channels
  documentation {
    content = "See infra/README.md, Alerts: backend errors (Error Reporting shows them grouped)."
  }
}
`
            : ''
    }
# The budget: an e-mail at 50%, 90% and 100% of monthly_budget (needs billing_account and the role Billing Account
# Costs Manager on it for the deployer, see infra/README.md)
resource "google_billing_budget" "monthly" {
  count           = var.billing_account != "" && var.monthly_budget > 0 ? 1 : 0
  billing_account = var.billing_account
  display_name    = "\${var.name} monthly"
  budget_filter {
    projects = ["projects/\${data.google_project.this.number}"]
  }
  amount {
    specified_amount {
      currency_code = "EUR"
      units         = tostring(var.monthly_budget)
    }
  }
  dynamic "threshold_rules" {
    for_each = [0.5, 0.9, 1.0]
    content {
      threshold_percent = threshold_rules.value
    }
  }
  all_updates_rule {
    monitoring_notification_channels = local.alert_channels
    disable_default_iam_recipients   = false
  }
  depends_on = [google_project_service.apis]
}
`
}

/** .github/workflows/backup-check.yml: monthly, are there recent backups, and an issue for the restore test. */
export const backupWorkflow = name => `name: Backup check

# Monthly: are there recent backups of Cloud SQL, then an issue for the backup agent of Claude Code to do the restore
# test. Skipped while the database is stopped (the action down of the workflow Cloud).
on:
    schedule:
        - cron: '17 6 1 * *'
    workflow_dispatch:

permissions:
    contents: read
    issues: write
    id-token: write

jobs:
    check:
        runs-on: ubuntu-latest
        # Google Cloud only lets the environments production and preview in (infra/bootstrap.sh)
        environment: production
        steps:
            - uses: google-github-actions/auth@v2
              with:
                  workload_identity_provider: \${{ vars.GCP_WIF_PROVIDER }}
                  service_account: \${{ vars.GCP_DEPLOYER }}

            - uses: google-github-actions/setup-gcloud@v2

            - name: Recent backups
              id: backups
              run: |
                  POLICY=$(gcloud sql instances describe ${name}-db --project "\${{ vars.GCP_PROJECT_ID }}" --format='value(settings.activationPolicy)' || echo MISSING)
                  echo "policy=$POLICY" >> "$GITHUB_OUTPUT"
                  if [ "$POLICY" != ALWAYS ]; then echo "The database is not running ($POLICY): nothing to check."; exit 0; fi
                  LAST=$(gcloud sql backups list --instance ${name}-db --project "\${{ vars.GCP_PROJECT_ID }}" --limit 1 --sort-by=~windowStartTime --format='value(windowStartTime)')
                  echo "Last backup: $LAST"
                  test -n "$LAST"
                  test "$(date -d "$LAST" +%s)" -gt "$(date -d '2 days ago' +%s)"

            - name: Issue for the restore test
              if: steps.backups.outputs.policy == 'ALWAYS'
              env:
                  GH_TOKEN: \${{ github.token }}
              run: |
                  gh issue create --repo "\${{ github.repository }}" --label type:chore --label status:ready \\
                    --title "Backup check $(date +%Y-%m): restore test" \\
                    --body "Monthly restore test of the database (backup agent of Claude Code, .claude/agents/backup.md). The backups are there; restore the last one into a copy, check it and write the result here."
`

/** Every file of the cloud setup of a project. */
export function cloudFiles(project) {
    const name = cloudName(project.name)
    const files = {
        [`${TERRAFORM_DIR}/versions.tf`]: versionsTf(name),
        [`${TERRAFORM_DIR}/variables.tf`]: variablesTf(project, name),
        [`${TERRAFORM_DIR}/main.tf`]: mainTf(project),
        [`${TERRAFORM_DIR}/outputs.tf`]: outputsTf(project),
        [`${TERRAFORM_DIR}/monitoring.tf`]: monitoringTf(project),
        [`${TERRAFORM_DIR}/terraform.tfvars.example`]: tfvarsExample(project, name),
        [`${TERRAFORM_DIR}/.gitignore`]: [
            '.terraform/',
            '*.tfstate',
            '*.tfstate.*',
            'terraform.tfvars',
            '.terraform.lock.hcl.bak',
            ''
        ].join('\n'),
        [`${INFRA_DIR}/bootstrap.sh`]: bootstrapScript(name),
        [`${INFRA_DIR}/README.md`]: infraReadme(project, name),
        '.github/workflows/cloud.yml': cloudWorkflow(project, name),
        '.github/workflows/preview.yml': previewWorkflow(project, name),
        ...(project.database ? { '.github/workflows/backup-check.yml': backupWorkflow(name) } : {})
    }
    if (project.backend) {
        files['backend/Dockerfile'] = backendDockerfile(project)
        files['backend/.dockerignore'] = DOCKERIGNORE
    }
    if (project.frontend) {
        files['frontend/Dockerfile'] = frontendDockerfile(project)
        files['frontend/.dockerignore'] = DOCKERIGNORE
    }
    return files
}

/** The step of the CLI that writes them (after the frontend and the backend exist, before git). */
export function cloudSteps({ projectDir, project }) {
    return [
        {
            title: 'Google Cloud klaarzetten (Terraform, Dockerfiles, GitHub-knop)',
            weight: 1,
            run: async () => {
                for (const [rel, content] of Object.entries(cloudFiles(project))) {
                    const target = path.join(projectDir, rel)
                    await fs.mkdir(path.dirname(target), { recursive: true })
                    await fs.writeFile(target, content, rel.endsWith('.sh') ? { mode: 0o755 } : undefined)
                }
            }
        }
    ]
}

export const cloudNext = () => [
    'Google Cloud: bash infra/bootstrap.sh <project-id> <owner/repository> (once), then on GitHub Actions -> Cloud -> deploy',
    'Aan/uit: Actions -> Cloud -> up / down (down stopt Cloud Run en de database; de data blijft)'
]
