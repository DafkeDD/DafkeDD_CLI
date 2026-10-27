#!/usr/bin/env node
import { main, version } from '../src/index.js'
import { update } from '../src/update.js'
import { doctor } from '../src/doctor.js'

const HELP = `DafkeDD_CLI v${version}

  DafkeDD_CLI            een nieuw project in deze map (frontend, backend, Claude Code, Google Cloud, GitHub)
  DafkeDD_CLI --answers <bestand>
                         hetzelfde project opnieuw, met de antwoorden van toen (.dafkedd-answers.json van een
                         vorig project); wat er niet in staat en elk wachtwoord wordt gevraagd
  DafkeDD_CLI update     een bestaand project bijwerken naar deze versie (de code van de backend en de frontend,
                         nieuwe teksten, scripts en .env-instellingen, agents, hooks, pipelines, Terraform);
                         wat je zelf aanpaste wordt nooit overschreven (<bestand>.dafkedd-new ernaast)
  DafkeDD_CLI doctor     controleren of alles er is (node, gh, MCP-servers, database, labels, branchbescherming)
  DafkeDD_CLI --version`

const commands = {
    update: () => update({ version }),
    doctor: async () => {
        if (!(await doctor({ version }))) process.exitCode = 1
    },
    '--version': () => console.log(version),
    '-v': () => console.log(version),
    '--help': () => console.log(HELP),
    '-h': () => console.log(HELP)
}

const [command, value] = process.argv.slice(2)
const answers = command === '--answers' || command === '-a'
if (answers && !value) {
    console.error(`--answers heeft een bestand nodig.\n\n${HELP}`)
    process.exit(1)
}
const action = command === undefined ? () => main() : answers ? () => main({ answersFile: value }) : commands[command]
if (!action) {
    console.error(`Onbekend commando "${command}".\n\n${HELP}`)
    process.exit(1)
}

Promise.resolve()
    .then(action)
    .catch(err => {
        if (err && err.name === 'ExitPromptError') {
            console.log('\nAfgebroken.')
            process.exit(130)
        }
        console.error(err?.message ?? err)
        process.exit(1)
    })
