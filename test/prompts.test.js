import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
    ANSWERS_FILE,
    confirm,
    input,
    password,
    readAnswers,
    recordedAnswers,
    resetAnswers,
    saveAnswers,
    select,
    useAnswers
} from '../src/prompts.js'

const CHOICES = [
    { name: 'Docker', value: 'docker' },
    { name: 'Local', value: 'local' }
]

test('an answers file answers the questions it has, in order, and keeps the answers of this run', async t => {
    t.after(resetAnswers)
    const lines = []
    useAnswers(
        {
            answers: [
                { question: 'Hoe draait PostgreSQL?', answer: 'local' },
                { question: 'Naam:', answer: 'shop' },
                { question: 'Naam:', answer: 'shop2' },
                { question: 'Klaar?', answer: true }
            ]
        },
        { log: line => lines.push(line) }
    )
    assert.equal(await select({ message: 'Hoe draait PostgreSQL?', choices: CHOICES }), 'local')
    // The same question twice: the answers in order
    assert.equal(await input({ message: 'Naam:' }), 'shop')
    assert.equal(await input({ message: 'Naam:' }), 'shop2')
    assert.equal(await confirm({ message: 'Klaar?' }), true)
    assert.equal(lines.length, 4)
    assert.match(lines[0], /antwoordbestand/)
    assert.deepEqual(recordedAnswers(), [
        { question: 'Hoe draait PostgreSQL?', answer: 'local' },
        { question: 'Naam:', answer: 'shop' },
        { question: 'Naam:', answer: 'shop2' },
        { question: 'Klaar?', answer: true }
    ])
})

test('an answer that no longer fits (a choice that is gone, a validate that refuses) is not used', async t => {
    t.after(resetAnswers)
    const lines = []
    const asked = []
    // The prompts that really ask: here they answer themselves
    const prompts = {
        select: async config => (asked.push(config.message), 'docker'),
        input: async config => (asked.push(config.message), 'NEW-CODE')
    }
    useAnswers(
        [
            { question: 'Hoe draait PostgreSQL?', answer: 'cloud' },
            { question: 'Koppelcode:', answer: 'USED-CODE' }
        ],
        { log: line => lines.push(line), prompts }
    )
    assert.equal(await select({ message: 'Hoe draait PostgreSQL?', choices: CHOICES }), 'docker')
    assert.equal(
        await input({ message: 'Koppelcode:', validate: async value => value !== 'USED-CODE' || 'al gebruikt' }),
        'NEW-CODE'
    )
    assert.deepEqual(asked, ['Hoe draait PostgreSQL?', 'Koppelcode:'])
    assert.ok(lines.every(line => /past niet meer/.test(line)))
    // What was asked is kept, not the answer of the file
    assert.deepEqual(
        recordedAnswers().map(entry => entry.answer),
        ['docker', 'NEW-CODE']
    )
})

test('passwords are never taken from the file nor kept; the file of a run is written to the project', async t => {
    t.after(resetAnswers)
    useAnswers([{ question: 'Wachtwoord:', answer: 'secret' }], {
        log: () => {},
        prompts: { password: async () => 'typed' }
    })
    // Asked (typed), not taken from the file
    assert.equal(await password({ message: 'Wachtwoord:' }), 'typed')
    assert.ok(!recordedAnswers().some(entry => entry.question === 'Wachtwoord:'))

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'answers-'))
    t.after(() => fs.rm(dir, { recursive: true, force: true }))
    resetAnswers()
    useAnswers([{ question: 'Naam:', answer: 'shop' }], { log: () => {} })
    await input({ message: 'Naam:' })
    await saveAnswers(dir, '0.51.0')
    const saved = await readAnswers(path.join(dir, ANSWERS_FILE))
    assert.equal(saved.version, '0.51.0')
    assert.deepEqual(saved.answers.at(-1), { question: 'Naam:', answer: 'shop' })
    await fs.writeFile(path.join(dir, 'other.json'), '{"x":1}')
    await assert.rejects(readAnswers(path.join(dir, 'other.json')), /geen antwoordbestand/)
})
