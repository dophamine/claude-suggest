import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const ANSWER = 'Done. Want me to run the tests or commit?'

const MESSAGE = {
  plugin: 'suggest',
  component: 'AssistantMessage',
  requestId: 'msg-1',
  props: { text: ANSWER, isFirstOfReply: true },
} as const

// The reply buttons, without the ✎ beside each.
const labels = async (ui: { findAll: (q: { type: 'Button' }) => Promise<readonly { key?: string | null; props: { label?: string } }[]> }) =>
  (await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('reply-')).map(b => b.props.label)

test('replies show as buttons under the last message on desktop, and a tap sends one', { options: { mode: 'auto' } }, async ($, on) => {
  const sent: string[] = []
  const origins: unknown[] = []
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const clock = mock.clock(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: '["commit it", "2", "run the tests"]', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  on('prompt.suggest', () => ({ isShown: true }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    origins.push(e.origin)

    return { text: e.text }
  })

  await $.turn.complete({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  await $.prompt.suggest({ text: 'run the tests', origin: { kind: 'suggestion' } })
  await clock.settle()

  const ui = await $.ui.mount({ ...MESSAGE, surface: 'desktop' })
  const first = await ui.find({ type: 'Button', key: 'reply-0' })
  expect(first?.props.label).toBe('run the tests')
  expect(await labels(ui)).toEqual(['run the tests', 'commit it'])
  await ui.press({ key: 'reply-0' })
  expect(sent).toEqual(['run the tests'])
  // Sent as the person's own words, not framed as the plugin's message.
  expect(origins).toEqual([{ kind: 'plugin', name: 'suggest', asUser: true }])
  await ui.unmount()
})

test('when Haiku is not sure, only Claude Code\'s own suggestion shows', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const clock = mock.clock(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: '[]', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  on('prompt.suggest', () => ({ isShown: true }))

  await $.turn.complete({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  await $.prompt.suggest({ text: 'run the tests', origin: { kind: 'suggestion' } })
  await clock.settle()

  const ui = await $.ui.mount({ ...MESSAGE, surface: 'terminal' })
  expect(await labels(ui)).toEqual(['run the tests'])
  expect(await ui.find({ type: 'Text', text: /suggest/ })).toBeUndefined()
  await ui.unmount()
})

const OPTIONS = '["A tool for my daily routine", "A game or toy", "Something that automates a chore"]'

// Claude Code's own suggestion, if any, then the model's replies, up to three in all.
const optionsShown = async ($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], engine?: string) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const clock = mock.clock(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: OPTIONS, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  on('prompt.suggest', () => ({ isShown: true }))

  await $.turn.complete({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  if (engine) await $.prompt.suggest({ text: engine, origin: { kind: 'suggestion' } })
  await clock.settle()
  const ui = await $.ui.mount({ ...MESSAGE, surface: 'terminal' })
  const shown = await labels(ui)
  await ui.unmount()

  return shown
}

test('without Claude Code\'s own suggestion, the model fills every button', { options: { mode: 'auto' } }, async ($, on) => {
  expect(await optionsShown($, on)).toEqual(['A tool for my daily routine', 'A game or toy', 'Something that automates a chore'])
})

test('when Claude Code\'s own suggestion repeats a model reply, the buttons still fill up', { options: { mode: 'auto' } }, async ($, on) => {
  expect(await optionsShown($, on, 'A game or toy')).toEqual(['A game or toy', 'A tool for my daily routine', 'Something that automates a chore'])
})

test('a late suggestion from Claude Code does not reorder the shown buttons', { options: { mode: 'auto', maxReplies: 4 } }, async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const clock = mock.clock(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: OPTIONS, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  on('prompt.suggest', () => ({ isShown: true }))

  await $.turn.complete({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  await clock.settle()
  // Differs from a shown reply only in case and punctuation, so it is the same reply.
  await $.prompt.suggest({ text: 'a game or toy.', origin: { kind: 'suggestion' } })
  await $.prompt.suggest({ text: 'run the tests', origin: { kind: 'suggestion' } })
  const ui = await $.ui.mount({ ...MESSAGE, surface: 'terminal' })
  expect(await labels(ui)).toEqual(['A tool for my daily routine', 'A game or toy', 'Something that automates a chore', 'run the tests'])
  await ui.unmount()
})

test('with one reply allowed, only Claude Code\'s own suggestion shows and no model is called', { options: { maxReplies: 1 } }, async ($, on) => {
  let calls = 0
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const clock = mock.clock(on)
  on('model.complete', () => {
    calls += 1

    return { value: { isAnswered: true, text: '["commit it"]', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('prompt.suggest', () => ({ isShown: true }))

  await $.turn.complete({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  await $.prompt.suggest({ text: 'run the tests', origin: { kind: 'suggestion' } })
  await clock.settle()

  const ui = await $.ui.mount({ ...MESSAGE, surface: 'terminal' })
  expect(await labels(ui)).toEqual(['run the tests'])
  expect(calls).toBe(0)
  await ui.unmount()
})

test('manual mode shows only the free suggestion until /suggest, which sends nothing', { options: { mode: 'manual' } }, async ($, on) => {
  let calls = 0
  const sent: string[] = []
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const clock = mock.clock(on)
  on('model.complete', () => {
    calls += 1

    return { value: { isAnswered: true, text: '["commit it"]', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('prompt.suggest', () => ({ isShown: true }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return { text: e.text }
  })

  await $.turn.complete({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  await $.prompt.suggest({ text: 'run the tests', origin: { kind: 'suggestion' } })
  await clock.settle()
  const before = await $.ui.mount({ ...MESSAGE, surface: 'terminal' })
  expect(await labels(before)).toEqual(['run the tests'])
  expect(calls).toBe(0)
  await before.unmount()

  const ran = await $.command.run({ command: 'suggest', args: '' } as never)
  expect(ran.text).toBeUndefined()
  await clock.settle()
  const ui = await $.ui.mount({ ...MESSAGE, surface: 'terminal' })
  expect(await labels(ui)).toEqual(['run the tests', 'commit it'])
  expect(calls).toBe(1)
  expect(sent).toEqual([])
  await ui.unmount()
})

const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

test('smart mode asks the model only when the reply asks something', { options: { mode: 'smart' } }, async ($, on) => {
  let calls = 0
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const clock = mock.clock(on)
  on('model.complete', () => {
    calls += 1

    return { value: { isAnswered: true, text: '["commit it"]', usage: USAGE } }
  })
  on('prompt.suggest', () => ({ isShown: true }))
  on('prompt.submit', (_, e) => ({ text: e.text }))

  await $.turn.complete({ answer: 'Done. All tests pass.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.settle()
  expect(calls).toBe(0)

  await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } } as never)
  await $.turn.complete({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  await clock.settle()
  expect(calls).toBe(1)
})

test('a hint steers the model and leaves the engine suggestion out', { options: { mode: 'manual' } }, async ($, on) => {
  const prompts: string[] = []
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const clock = mock.clock(on)
  on('model.complete', (_, e) => {
    prompts.push(e.prompt)

    return { value: { isAnswered: true, text: '["ship it", "commit it", "push it"]', usage: USAGE } }
  })
  on('prompt.suggest', () => ({ isShown: true }))

  await $.turn.complete({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  await $.prompt.suggest({ text: 'run the tests', origin: { kind: 'suggestion' } })
  await $.command.run({ command: 'suggest', args: 'shorter' } as never)
  await clock.settle()

  expect(prompts[0]).toContain('shorter')
  const ui = await $.ui.mount({ ...MESSAGE, surface: 'terminal' })
  expect(await labels(ui)).toEqual(['ship it', 'commit it', 'push it'])
  await ui.unmount()
})

// Sets up a turn whose chips are 'run the tests' (the engine's), then '/compact' and 'commit it' (the model's).
const withChips = async (...[$, on]: Parameters<TestBody>) => {
  const log: string[] = []
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const clock = mock.clock(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: '["run /compact", "commit it"]', usage: USAGE } }))
  on('prompt.suggest', () => ({ isShown: true }))
  on('prompt.submit', (_, e) => {
    log.push(`submit ${e.text}`)

    return { text: e.text }
  })
  on('prompt.fill', (_, e) => {
    log.push(`fill ${e.text}`)

    return { isFilled: true }
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('command.run', (_, e) => {
    log.push(`run ${e.command} ${e.args}`)

    return {}
  })

  await $.turn.complete({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  await $.prompt.suggest({ text: 'run the tests', origin: { kind: 'suggestion' } })
  await clock.settle()

  return { log, ui: await $.ui.mount({ ...MESSAGE, surface: 'terminal' }) }
}

test('✎ puts a reply in the input, and a slash reply runs as a command', async ($, on) => {
  const { log, ui } = await withChips($, on)
  expect(await labels(ui)).toEqual(['run the tests', '/compact', 'commit it'])
  await ui.press({ key: 'edit-2' })
  await ui.press({ key: 'reply-1' })
  expect(log).toEqual(['fill commit it', 'run compact ', 'fill  ', 'fill '])
  await ui.unmount()
})

test('in fill mode a click puts the reply in the input and there is no ✎', { options: { click: 'fill' } }, async ($, on) => {
  const { log, ui } = await withChips($, on)
  expect(await ui.find({ type: 'Button', key: 'edit-0' })).toBeUndefined()
  await ui.press({ key: 'reply-0' })
  expect(log).toEqual(['fill run the tests'])
  await ui.unmount()
})

test('a reload mid-call does not leave the loading line up', { options: { mode: 'auto' } }, async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  mock.clock(on)
  on('prompt.suggest', () => ({ isShown: true }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  // The clock never runs, as when a reload drops the call.
  await $.turn.complete({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  await $.prompt.suggest({ text: 'run the tests', origin: { kind: 'suggestion' } })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...MESSAGE, surface: 'terminal' })
  expect(await labels(ui)).toEqual(['run the tests'])
  expect(await ui.find({ type: 'Text', text: /suggest/ })).toBeUndefined()
  await ui.unmount()
})
