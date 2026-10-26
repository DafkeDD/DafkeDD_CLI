import fs from 'node:fs/promises'
import path from 'node:path'
import * as inquirer from '@inquirer/prompts'
import pc from 'picocolors'

/**
 * The questions of the CLI, with an answers file: `DafkeDD_CLI --answers <file>` answers them from that file (the same
 * project again, without typing everything), and every run keeps its answers in `.dafkedd-answers.json`. A question
 * the file does not have, or whose answer is no longer valid (a link code that was used, a name that is taken), is
 * asked as usual. Passwords are never kept: they are always asked.
 */

/** The file every run writes in the project (not committed: .gitignore). */
export const ANSWERS_FILE = '.dafkedd-answers.json'

const state = { given: [], used: new Map(), recorded: [], log: console.log, prompts: inquirer }

/** Answers from a file (an array of { question, answer }, or { answers: [...] } as the CLI writes it). */
export function useAnswers(file, { log = console.log, prompts = inquirer } = {}) {
    const list = Array.isArray(file) ? file : (file?.answers ?? [])
    state.given = list.filter(entry => entry && typeof entry.question === 'string' && 'answer' in entry)
    state.used = new Map()
    state.log = log
    // The prompts that really ask (the tests give their own)
    state.prompts = prompts
}

/** Reads an answers file. Throws with a clear message when it is not one. */
export async function readAnswers(file) {
    let parsed
    try {
        parsed = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch (error) {
        throw new Error(`Kan het antwoordbestand ${file} niet lezen: ${error instanceof Error ? error.message : error}`)
    }
    if (!Array.isArray(parsed) && !Array.isArray(parsed?.answers))
        throw new Error(`${file} is geen antwoordbestand van DafkeDD_CLI (verwacht: { "answers": [...] })`)
    return parsed
}

/** What was answered in this run (without passwords), in the order of the questions. */
export const recordedAnswers = () => state.recorded.map(entry => ({ ...entry }))

/** Forgets everything (the tests). */
export function resetAnswers() {
    state.given = []
    state.used = new Map()
    state.recorded = []
    state.log = console.log
    state.prompts = inquirer
}

/** Writes the answers of this run to the project (and keeps the file out of git). */
export async function saveAnswers(projectDir, version) {
    await fs.writeFile(
        path.join(projectDir, ANSWERS_FILE),
        JSON.stringify({ version, answers: recordedAnswers() }, null, 4) + '\n'
    )
}

/** Is a given answer still valid for this question (its choices, its validate)? */
async function valid(kind, config, answer) {
    if (kind === 'select') return config.choices?.some(choice => choice?.value === answer) ?? false
    if (kind === 'checkbox')
        return Array.isArray(answer) && answer.every(value => config.choices?.some(choice => choice?.value === value))
    if (kind === 'confirm') return typeof answer === 'boolean'
    if (typeof answer !== 'string') return false
    return !config.validate || (await config.validate(answer)) === true
}

const show = answer => (Array.isArray(answer) ? answer.join(', ') : String(answer))

function ask(kind) {
    return async config => {
        const question = String(config.message)
        if (kind !== 'password') {
            const seen = state.used.get(question) ?? 0
            const entry = state.given.filter(item => item.question === question)[seen]
            if (entry) {
                state.used.set(question, seen + 1)
                if (await valid(kind, config, entry.answer)) {
                    state.log(
                        `${pc.green('?')} ${question} ${pc.cyan(show(entry.answer))} ${pc.dim('(antwoordbestand)')}`
                    )
                    state.recorded.push({ question, answer: entry.answer })
                    return entry.answer
                }
                state.log(pc.yellow(`! Het antwoord uit het antwoordbestand past niet meer: ${question}`))
            }
        }
        const answer = await state.prompts[kind](config)
        if (kind !== 'password') state.recorded.push({ question, answer })
        return answer
    }
}

export const select = ask('select')
export const input = ask('input')
export const password = ask('password')
export const confirm = ask('confirm')
export const checkbox = ask('checkbox')
