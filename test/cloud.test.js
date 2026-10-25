import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
    askCloud,
    backendDockerfile,
    cloudFiles,
    cloudName,
    cloudNext,
    cloudSteps,
    cloudWorkflow,
    frontendDockerfile,
    mainTf,
    monitoringTf,
    outputsTf,
    previewWorkflow,
    backupWorkflow,
    TERRAFORM_VERSION,
    variablesTf
} from '../src/cloud.js'
import { describeProject, projectClaudeMd } from '../src/claude.js'

const app = describeProject({
    name: 'KidieFile',
    frontend: {},
    backend: { id: 'linked' },
    answers: {
        link: { clientId: 'kidiefile', product: 'kidie' },
        database: { database: 'kidiefile' },
        appOptions: { mail: true, files: true, isolation: 'database' }
    }
})
const pasport = describeProject({
    name: 'pasport',
    frontend: {},
    backend: { id: 'nestjs' },
    answers: { oidc: {}, database: { database: 'pasport' } }
})
const site = describeProject({ name: 'site', frontend: {} })

test('the CLI asks for Google Cloud, yes by default', async () => {
    let asked
    assert.equal(await askCloud({ prompts: { confirm: async config => ((asked = config), true) } }), true)
    assert.equal(asked.default, true)
    assert.match(asked.message, /Google Cloud/)
})

test('cloudName makes a name Google Cloud accepts', () => {
    assert.equal(cloudName('KidieFile'), 'kidiefile')
    assert.equal(cloudName('Het Speelnest!'), 'het-speelnest')
    assert.equal(cloudName('123'), 'app-123')
    assert.equal(cloudName('a'.repeat(40)).length, 20)
    assert.equal(cloudName('---'), 'app')
})

test('Terraform: Cloud Run that scales to zero and goes away with enabled = false, Cloud SQL that stops', () => {
    const tf = mainTf(app)
    for (const part of ['backend', 'frontend']) {
        assert.match(
            tf,
            new RegExp(`resource "google_cloud_run_v2_service" "${part}" \\{\\n  count\\s+= var\\.enabled \\? 1 : 0`)
        )
        assert.match(tf, new RegExp(`resource "google_cloud_run_domain_mapping" "${part}"`))
    }
    assert.match(tf, /min_instance_count = 0/)
    assert.match(tf, /cpu_idle = true/)
    assert.match(tf, /activation_policy = var\.enabled \? "ALWAYS" : "NEVER"/)
    assert.match(tf, /database_version\s+= "POSTGRES_17"/)
    assert.match(tf, /DATABASE_HOST = "\/cloudsql\/\$\{google_sql_database_instance\.db\.connection_name\}"/)
    assert.match(tf, /TENANT_ISOLATION = "database"/)
    assert.match(tf, /FILES_DRIVER = "gcs"/)
    assert.match(tf, /public_access_prevention\s+= "enforced"/)
    assert.match(tf, /OIDC_CLIENT_IDS = "kidiefile"/)
    // The secrets live in Secret Manager and reach Cloud Run as references
    assert.match(tf, /DATABASE_PASSWORD = random_password\.db\.result/)
    assert.match(tf, /secret_key_ref \{\n\s+secret\s+= env\.value\.secret_id\n\s+version = "latest"/)
    assert.match(tf, /AUTH_SECRET = random_id\.auth_secret\.hex/)
    assert.match(variablesTf(app, 'kidiefile'), /variable "login_issuer"/)
    assert.match(variablesTf(app, 'kidiefile'), /sensitive\s+= true/)
})

test('the login server keeps its master key, its clients point at Cloud Run, and a site has no backend or database', () => {
    const tf = mainTf(pasport)
    assert.match(tf, /OIDC_MASTER_KEY = random_id\.master_key\.hex/)
    assert.match(tf, /OIDC_ISSUER = "\$\{local\.backend_url\}\/oidc"/)
    assert.match(tf, /OIDC_CLIENTS_FILE = "config\/oidc-clients\.cloud\.json"/)
    assert.match(tf, /OIDC_BOOTSTRAP_ADMIN_EMAIL = var\.admin_email/)
    assert.match(cloudWorkflow(pasport, 'pasport'), /sed "s#http:\/\/localhost:3000#\$FRONTEND_URL#g"/)
    const siteTf = mainTf(site)
    assert.ok(!siteTf.includes('google_sql_database_instance'))
    assert.ok(!siteTf.includes('"google_cloud_run_v2_service" "backend"'))
    assert.ok(siteTf.includes('"google_cloud_run_v2_service" "frontend"'))
})

test('the GitHub button: plan, deploy, up and down, with Workload Identity Federation and a pinned Terraform', () => {
    const workflow = cloudWorkflow(app, 'kidiefile')
    assert.match(workflow, /workflow_dispatch:/)
    assert.match(workflow, /options: \[plan, deploy, up, down\]/)
    assert.match(workflow, /id-token: write/)
    assert.match(workflow, /workload_identity_provider: \$\{\{ vars\.GCP_WIF_PROVIDER \}\}/)
    assert.match(workflow, new RegExp(`terraform_version: ${TERRAFORM_VERSION.replaceAll('.', '\\.')}`))
    assert.match(workflow, /-var enabled=false/)
    assert.match(workflow, /--build-arg NEXT_PUBLIC_PASPORT_API_URL="\$TF_VAR_login_api_url"/)
    assert.match(workflow, /TF_VAR_backend_secrets: \$\{\{ secrets\.BACKEND_SECRETS \|\| '\{\}' \}\}/)
    assert.ok(!/on:\n\s+push/.test(workflow), 'never on its own')
})

test('Dockerfiles: small images that run as node on the port of Cloud Run', () => {
    const backend = backendDockerfile(app)
    assert.match(backend, /npm prune --omit=dev/)
    assert.match(backend, /COPY --from=build --chown=node:node \/app\/config \.\/config/)
    assert.match(backend, /USER node/)
    assert.match(backend, /CMD \["node", "dist\/main"\]/)
    assert.ok(
        !backendDockerfile(describeProject({ name: 'x', backend: { id: 'nestjs' }, answers: {} })).includes(
            '/app/config'
        )
    )
    const frontend = frontendDockerfile(app)
    assert.match(frontend, /ARG NEXT_PUBLIC_API_URL/)
    assert.match(frontend, /ARG NEXT_PUBLIC_PASPORT_API_URL/)
    assert.match(frontend, /next start -p \$\{PORT:-8080\}/)
})

test('cloudFiles and cloudSteps: Terraform, bootstrap, README, workflow, Dockerfiles and .dockerignore', async t => {
    const files = cloudFiles(app)
    for (const rel of [
        'infra/terraform/versions.tf',
        'infra/terraform/variables.tf',
        'infra/terraform/main.tf',
        'infra/terraform/outputs.tf',
        'infra/terraform/terraform.tfvars.example',
        'infra/terraform/.gitignore',
        'infra/bootstrap.sh',
        'infra/README.md',
        '.github/workflows/cloud.yml',
        'backend/Dockerfile',
        'backend/.dockerignore',
        'frontend/Dockerfile',
        'frontend/.dockerignore'
    ])
        assert.ok(files[rel], rel)
    assert.match(files['infra/terraform/.gitignore'], /^terraform\.tfvars$/m)
    assert.match(files['infra/terraform/versions.tf'], /backend "gcs" \{\n\s+prefix = "kidiefile"/)
    assert.match(files['backend/.dockerignore'], /^\.env$/m)
    // Only this repository, and only jobs of the environments production and preview
    assert.match(
        files['infra/bootstrap.sh'],
        /CONDITION="assertion\.repository == '\$REPO' && assertion\.environment in \['production', 'preview'\]"/
    )
    assert.match(files['infra/bootstrap.sh'], /providers update-oidc github/)
    assert.match(files['infra/bootstrap.sh'], /environments\/production\/deployment-branch-policies/)
    assert.match(files['infra/bootstrap.sh'], /"reviewers": \[\{"type": "User", "id": \$OWNER_ID\}\]/)
    assert.match(files['.github/workflows/backup-check.yml'], /environment: production/)
    assert.match(files['infra/README.md'], /Own domain \(needed for the login\)/)
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dafkedd-cloud-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    const [step] = cloudSteps({ projectDir: dir, project: app })
    await step.run()
    const stat = await fs.stat(path.join(dir, 'infra', 'bootstrap.sh'))
    if (process.platform !== 'win32') assert.ok(stat.mode & 0o100, 'bootstrap.sh is executable')
    assert.ok(cloudNext().some(line => line.includes('bootstrap.sh')))
    // CLAUDE.md of the project tells about it, and the infra agent never presses the button
    assert.match(projectClaudeMd({ ...app, cloud: true }), /## Google Cloud/)
    assert.ok(!projectClaudeMd(app).includes('## Google Cloud'))
    const infra = await fs.readFile('templates/project-claude/.claude/agents/infra.md', 'utf8')
    assert.match(infra, /never run `deploy`, `up` or `down` yourself/)
})

test('monitoring: uptime checks and alerts only while the app runs, errors from the logs, a budget alert', () => {
    const tf = monitoringTf(app)
    assert.match(tf, /watch\s+= var\.enabled && var\.alert_email != ""/)
    for (const part of ['backend', 'frontend']) {
        assert.match(
            tf,
            new RegExp(
                `resource "google_monitoring_uptime_check_config" "${part}" \\{\\n  count\\s+= local\\.watch \\? 1 : 0`
            )
        )
        assert.match(tf, new RegExp(`resource "google_monitoring_alert_policy" "${part}_down"`))
    }
    assert.match(tf, /path\s+= "\/health"/)
    assert.match(tf, /resource "google_logging_metric" "backend_errors"/)
    assert.match(tf, /severity>=ERROR/)
    assert.match(
        tf,
        /resource "google_billing_budget" "monthly" \{\n  count\s+= var\.billing_account != "" && var\.monthly_budget > 0/
    )
    assert.match(tf, /for_each = \[0\.5, 0\.9, 1\.0\]/)
    assert.ok(!monitoringTf(site).includes('backend_errors'), 'a site has no backend')
    const files = cloudFiles(app)
    assert.ok(files['infra/terraform/monitoring.tf'])
    assert.match(files['infra/terraform/variables.tf'], /variable "alert_email"/)
    assert.match(files['.github/workflows/cloud.yml'], /TF_VAR_alert_email: \$\{\{ vars\.ALERT_EMAIL \}\}/)
    assert.match(files['infra/README.md'], /## Alerts and budget/)
})

test('the monthly backup check: recent backups, then an issue for the restore test; nothing while the database is off', () => {
    const workflow = backupWorkflow('kidiefile')
    assert.match(workflow, /cron: '17 6 1 \* \*'/)
    assert.match(workflow, /--instance kidiefile-db/)
    assert.match(workflow, /if \[ "\$POLICY" != ALWAYS \]; then .+exit 0; fi/)
    assert.match(workflow, /gh issue create .+--label type:chore/s)
    assert.ok(cloudFiles(app)['.github/workflows/backup-check.yml'])
    assert.ok(!cloudFiles(site)['.github/workflows/backup-check.yml'], 'no database, no backups')
})

test('a login project gets its JWT secret from Terraform, the APIs come first, plan shows the running app', () => {
    const login = {
        ...describeProject({
            name: 'shop',
            frontend: { id: 'nextjs' },
            backend: { id: 'nestjs' },
            answers: { auth: true, database: { database: 'shop' } }
        }),
        cloud: true
    }
    const main = mainTf(login)
    assert.match(main, /JWT_SECRET = random_id\.jwt\.hex/)
    assert.match(main, /resource "random_id" "jwt"/)
    assert.ok(!mainTf(app).includes('random_id.jwt'))
    assert.match(
        main,
        /resource "google_service_account" "backend" \{\n(?:  .+\n)*  depends_on\s+= \[google_project_service\.apis\]\n\}/
    )
    assert.match(
        monitoringTf(login),
        /resource "google_billing_budget"[\s\S]+depends_on = \[google_project_service\.apis\]\n\}/
    )
    assert.match(cloudWorkflow(login, 'shop'), /terraform plan -input=false -var enabled=true/)
})

test('without a backend there is no backend address in the outputs or the summary', () => {
    const site = { ...describeProject({ name: 'site', frontend: { id: 'nextjs' } }), cloud: true }
    assert.ok(!outputsTf(site).includes('backend_url'))
    assert.match(outputsTf(site), /output "frontend_url"/)
    assert.ok(!cloudWorkflow(site, 'site').includes('- Backend:'))
    assert.match(cloudWorkflow(app, 'planner'), /- Backend: \$BACKEND_URL/)
})

test('the nightly down, a backup before deploy, the smoke test and the way back to the previous images', () => {
    const workflow = cloudWorkflow(app, 'kidiefile')
    assert.match(workflow, /schedule:\n\s+- cron: '0 1 \* \* \*'/)
    assert.match(
        workflow,
        /if: github\.event_name != 'schedule' \|\| \(vars\.AUTO_DOWN != 'off' && vars\.TF_STATE_BUCKET != ''\)/
    )
    // Nothing deployed yet: down makes nothing
    assert.match(workflow, /if \[ -z "\$\(terraform state list 2>\/dev\/null\)" \]; then echo "EMPTY=1"/)
    assert.match(workflow, /if: env\.ACTION == 'down' && env\.EMPTY != '1'/)
    assert.match(workflow, /curl -s --max-time 20/)
    // Back only when the new version was started: a failed build changes nothing
    assert.match(
        workflow,
        /\(steps\.start\.outcome == 'failure' \|\| steps\.smoke\.outcome == 'failure'\) && env\.PREVIOUS_BACKEND != '' && env\.PREVIOUS_FRONTEND != ''/
    )
    assert.match(workflow, /ACTION: \$\{\{ inputs\.action \|\| 'down' \}\}/)
    assert.ok(!workflow.includes('inputs.action ==')) // every step goes by env.ACTION
    assert.match(workflow, /terraform_wrapper: false/)
    assert.match(workflow, /gcloud sql backups create --instance="\$APP-db"/)
    assert.match(workflow, /PREVIOUS_BACKEND=\$\(digest "\$\(terraform output -raw backend_image/)
    assert.match(workflow, /"\$RUN_BACKEND_URL\/health" "\$RUN_FRONTEND_URL\/"/)
    assert.match(workflow, /-var "backend_image=\$PREVIOUS_BACKEND" -var "frontend_image=\$PREVIOUS_FRONTEND"/)
    // The images that run are outputs, so the next deploy knows them
    assert.match(outputsTf(app), /output "backend_image" \{\n {2}value = var\.backend_image/)
    const site = { ...describeProject({ name: 'site', frontend: { id: 'nextjs' } }), cloud: true }
    assert.ok(!cloudWorkflow(site, 'site').includes('backups create'))
    assert.match(cloudWorkflow(site, 'site'), /env\.PREVIOUS_FRONTEND != ''/)
    assert.ok(!outputsTf(site).includes('backend_image'))
})

test('a preview per pull request: its own stack, removed with the pull request', () => {
    const files = cloudFiles(app)
    const preview = files['.github/workflows/preview.yml']
    assert.equal(preview, previewWorkflow(app, 'kidiefile'))
    assert.match(preview, /types: \[labeled, unlabeled, synchronize, reopened, closed\]/)
    assert.match(preview, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/)
    assert.match(preview, /-backend-config="prefix=preview\/pr-\$PR"/)
    assert.match(preview, /APP="\$\(echo "kidiefile" \| cut -c1-12 \| sed 's\/-\*\$\/\/'\)-pr\$PR"/)
    assert.match(preview, /TF_VAR_db_deletion_protection: 'false'/)
    assert.match(preview, /TF_VAR_force_destroy: 'true'/)
    assert.match(preview, /TF_VAR_alert_email: ''/)
    assert.ok(!preview.includes('FRONTEND_DOMAIN'))
    assert.match(preview, /terraform destroy -input=false -auto-approve/)
    assert.match(preview, /gh pr comment "\$PR" .* --edit-last/)
    assert.match(preview, /environment: preview/)
    // Its own secrets, never those of production; a new database name every time; removable
    assert.match(preview, /TF_VAR_backend_secrets: \$\{\{ secrets\.PREVIEW_BACKEND_SECRETS \|\| '\{\}' \}\}/)
    assert.ok(!/secrets\.BACKEND_SECRETS/.test(preview))
    assert.match(preview, /TF_VAR_preview: 'true'/)
    assert.match(
        mainTf(app),
        /name {16}= var\.preview \? "\$\{var\.name\}-db-\$\{random_id\.preview_db\.hex\}" : "\$\{var\.name\}-db"/
    )
    assert.equal(mainTf(app).match(/deletion_policy = "ABANDON"/g).length, 2)
    // Another label changes nothing
    assert.match(preview, /github\.event\.label\.name == 'preview'\) &&/)
    // The files bucket of a preview may go with its files; production keeps them
    assert.match(mainTf(app), /force_destroy {15}= var\.force_destroy/)
    assert.match(variablesTf(app, 'kidiefile'), /variable "force_destroy" \{[^}]+default {5}= false/)
    assert.match(files['infra/README.md'], /## A preview per pull request/)
    assert.match(files['infra/README.md'], /AUTO_DOWN/)
})

test('the invoices of the login server on Cloud Run: the VAT and the seller from GitHub variables', () => {
    const tf = mainTf(pasport)
    assert.match(tf, /BILLING_VAT_PERCENT = var\.vat_percent == "" \? "21" : var\.vat_percent/)
    assert.match(tf, /INVOICE_SELLER_NAME = var\.invoice_seller_name == "" \? "pasport" : var\.invoice_seller_name/)
    for (const name of ['ADDRESS', 'VAT', 'EMAIL', 'IBAN'])
        assert.match(tf, new RegExp(`INVOICE_SELLER_${name} = var\\.invoice_seller_${name.toLowerCase()}`), name)
    const variables = variablesTf(pasport)
    for (const name of ['vat_percent', 'invoice_seller_name', 'invoice_seller_iban'])
        assert.ok(variables.includes(`variable "${name}"`), name)
    const workflow = cloudWorkflow(pasport, 'pasport')
    assert.match(workflow, /TF_VAR_vat_percent: \$\{\{ vars\.VAT_PERCENT \}\}/)
    assert.match(workflow, /TF_VAR_invoice_seller_address: \$\{\{ vars\.INVOICE_SELLER_ADDRESS \}\}/)
    // Only the login server sends invoices
    assert.ok(!mainTf(app).includes('INVOICE_SELLER'))
    assert.ok(!variablesTf(app).includes('vat_percent'))
})
