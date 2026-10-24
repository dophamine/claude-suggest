import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

const ANSWER = 'Done. Want me to run the tests or commit?'
const OPTIONS = '["A tool for my daily routine", "A game or toy", "Something that automates a chore"]'
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const TIP =
  'tip   (add ! at the beginning to run it in your shell, or press Enter to ask Claude) at 10 subtle dim true italic true'

const MESSAGE = {
  plugin: 'suggest',
  component: 'AssistantMessage',
  requestId: 'msg-1',
  props: { text: ANSWER, isFirstOfReply: true },
} as const

// Stands in for Claude Code around the plugin. The model always answers `modelText`, and `log` records
// what the plugin sends, fills and runs. `isCommandStubbed` also answers every command the plugin runs.
const stubEngine = (on: On, modelText = '[]', { isCommandStubbed = false } = {}) => {
  const log: string[] = []
  const suggested: string[] = []
  const modelPrompts: string[] = []
  const origins: unknown[] = []

  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const clock = mock.clock(on)
  on('model.complete', (_, e) => {
    modelPrompts.push(e.prompt)

    return { value: { isAnswered: true, text: modelText, usage: USAGE } }
  })
  on('prompt.suggest', (_, e) => {
    suggested.push(e.text)

    return { isShown: true }
  })
  on('prompt.submit', (_, e) => {
    log.push(`submit ${e.text}`)
    origins.push(e.origin)

    return { text: e.text }
  })
  on('prompt.fill', (_, e) => {
    const mode = e.mode === 'insert' ? ' insert' : ''
    log.push(e.cursor === undefined ? `fill ${e.text}${mode}` : `fill ${e.text}${mode} cursor ${e.cursor}`)
    for (const d of e.decorations ?? []) {
      log.push(`tip ${d.virtualText} at ${d.start} ${d.color} dim ${d.dimColor} italic ${d.italic}`)
    }

    return { isFilled: true }
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  if (isCommandStubbed) {
    on('command.run', (_, e) => {
      log.push(`run ${e.command} ${e.args}`)

      return {}
    })
  }

  return { log, suggested, modelPrompts, origins, clock }
}

// A main-loop turn ends with `answer`, then Claude Code's own suggestion for it, if any, arrives.
const finishTurn = async ($: Engine, { answer = ANSWER, engine = '', turnId = 't' } = {}) => {
  await $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId, reason: 'answer' })
  if (engine) await $.prompt.suggest({ text: engine, origin: { kind: 'suggestion' } })
}

// The person types `/suggest <args>`.
const runSuggest = ($: Engine, args = '') =>
  $.command.run({
    command: 'suggest',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

const mountMessage = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') => $.ui.mount({ ...MESSAGE, surface })

// The reply buttons' labels, without the ✎ beside each.
const labels = async (ui: Awaited<ReturnType<typeof mountMessage>>) =>
  (await ui.findAll({ type: 'Button' })).filter(b => String(b.key).startsWith('reply-')).map(b => b.props.label)

// Labels shown for a turn whose model replies are OPTIONS, after Claude Code's own suggestion, if any.
const labelsForOptions = async ($: Engine, on: On, engine?: string) => {
  const { clock } = stubEngine(on, OPTIONS)
  await finishTurn($, { engine })
  await clock.settle()
  const ui = await mountMessage($)
  const shown = await labels(ui)
  await ui.unmount()

  return shown
}

// Buttons for 'run the tests' (Claude Code's own), then '/compact' and 'commit it' (the model's).
const withChips = async ($: Engine, on: On) => {
  const { log, clock } = stubEngine(on, '["run /compact", "commit it"]', { isCommandStubbed: true })
  await finishTurn($, { engine: 'run the tests' })
  await clock.settle()

  return { log, ui: await mountMessage($) }
}

// Buttons for the model's '! git status', 'commit it' and a bare '!', with no suggestion from Claude Code.
const withShellChips = async ($: Engine, on: On) => {
  const { log, suggested, clock } = stubEngine(on, '["! git status", "commit it", "!"]')
  await finishTurn($)
  await clock.settle()

  return { log, suggested, ui: await mountMessage($) }
}

test(
  'replies show as buttons under the last message on desktop, and a tap sends one',
  { options: { mode: 'auto' } },
  async ($, on) => {
    const { log, origins, clock } = stubEngine(on, '["commit it", "2", "run the tests"]')
    await finishTurn($, { engine: 'run the tests' })
    await clock.settle()

    const ui = await mountMessage($, 'desktop')
    expect((await ui.find({ type: 'Button', key: 'reply-0' }))?.props.label).toBe('run the tests')
    expect(await labels(ui)).toEqual(['run the tests', 'commit it'])
    await ui.press({ key: 'reply-0' })
    expect(log).toEqual(['submit run the tests'])
    // Sent as the person's own words, not framed as the plugin's message.
    expect(origins).toEqual([{ kind: 'plugin', name: 'suggest', asUser: true }])
    await ui.unmount()
  },
)

test("when Haiku is not sure, only Claude Code's own suggestion shows", async ($, on) => {
  const { clock } = stubEngine(on, '[]')
  await finishTurn($, { engine: 'run the tests' })
  await clock.settle()

  const ui = await mountMessage($)
  expect(await labels(ui)).toEqual(['run the tests'])
  expect(await ui.find({ type: 'Text', text: /suggest/ })).toBeUndefined()
  await ui.unmount()
})

test(
  "without Claude Code's own suggestion, the model fills every button",
  { options: { mode: 'auto' } },
  async ($, on) => {
    expect(await labelsForOptions($, on)).toEqual([
      'A tool for my daily routine',
      'A game or toy',
      'Something that automates a chore',
    ])
  },
)

test(
  "when Claude Code's own suggestion repeats a model reply, the buttons still fill up",
  { options: { mode: 'auto' } },
  async ($, on) => {
    expect(await labelsForOptions($, on, 'A game or toy')).toEqual([
      'A game or toy',
      'A tool for my daily routine',
      'Something that automates a chore',
    ])
  },
)

test(
  "a late suggestion from Claude Code goes to the top, marked as Claude's",
  { options: { mode: 'auto' } },
  async ($, on) => {
    const { clock } = stubEngine(on, OPTIONS)
    await finishTurn($)
    await clock.settle()
    const before = await mountMessage($)
    expect(await before.find({ type: 'Text', text: '✻' })).toBeUndefined()
    await before.unmount()

    // Differs from a shown reply only in case and punctuation, so it is the same reply.
    await $.prompt.suggest({ text: 'a game or toy.', origin: { kind: 'suggestion' } })
    const ui = await mountMessage($)
    expect(await labels(ui)).toEqual([
      'a game or toy.',
      'A tool for my daily routine',
      'Something that automates a chore',
    ])
    expect(await ui.findAll({ type: 'Text', text: '✻' })).toHaveLength(1)
    await ui.unmount()
  },
)

test(
  "with one reply allowed, only Claude Code's own suggestion shows and no model is called",
  { options: { maxReplies: 1 } },
  async ($, on) => {
    const { modelPrompts, clock } = stubEngine(on, '["commit it"]')
    await finishTurn($, { engine: 'run the tests' })
    await clock.settle()

    const ui = await mountMessage($)
    expect(await labels(ui)).toEqual(['run the tests'])
    expect(modelPrompts).toHaveLength(0)
    await ui.unmount()
  },
)

test(
  'manual mode shows only the free suggestion until /suggest, which sends nothing',
  { options: { mode: 'manual' } },
  async ($, on) => {
    const { log, modelPrompts, clock } = stubEngine(on, '["commit it"]')
    await finishTurn($, { engine: 'run the tests' })
    await clock.settle()
    const before = await mountMessage($)
    expect(await labels(before)).toEqual(['run the tests'])
    expect(modelPrompts).toHaveLength(0)
    await before.unmount()

    const ran = await runSuggest($)
    expect(ran.text).toBeUndefined()
    await clock.settle()
    const ui = await mountMessage($)
    expect(await labels(ui)).toEqual(['run the tests', 'commit it'])
    expect(modelPrompts).toHaveLength(1)
    expect(log).toEqual([])
    await ui.unmount()
  },
)

test('smart mode asks the model only when the reply asks something', { options: { mode: 'smart' } }, async ($, on) => {
  const { modelPrompts, clock } = stubEngine(on, '["commit it"]')
  await finishTurn($, { answer: 'Done. All tests pass.', turnId: 't1' })
  await clock.settle()
  expect(modelPrompts).toHaveLength(0)

  await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
  await finishTurn($, { turnId: 't2' })
  await clock.settle()
  expect(modelPrompts).toHaveLength(1)
})

test('a hint steers the model and leaves the engine suggestion out', { options: { mode: 'manual' } }, async ($, on) => {
  const { modelPrompts, clock } = stubEngine(on, '["ship it", "commit it", "push it"]')
  await finishTurn($, { engine: 'run the tests' })
  await runSuggest($, 'shorter')
  await clock.settle()

  expect(modelPrompts[0]).toContain('shorter')
  const ui = await mountMessage($)
  expect(await labels(ui)).toEqual(['ship it', 'commit it', 'push it'])
  await ui.unmount()
})

test('a ! shell reply goes to the input without its !, the caret where the ! goes, and nothing is sent', async ($, on) => {
  const { log, suggested, ui } = await withShellChips($, on)
  // The grey suggestion keeps its !: taken with Tab, it switches on shell mode.
  expect(suggested).toEqual(['! git status'])
  await ui.press({ key: 'edit-0' })
  await ui.press({ key: 'reply-0' })
  expect(log).toEqual(['fill git status cursor 0', TIP, 'fill git status cursor 0', TIP])
  await ui.unmount()
})

// The hint line under the prompt, as Claude Code draws it in shell mode or out of it.
const drawHint = async ($: Engine, hint: string, isDraft = false) => {
  const ui = await $.ui.mount({
    plugin: 'suggest',
    component: 'PromptHint',
    surface: 'terminal',
    props: { hint, isDraft, isWorking: false },
  })
  await ui.unmount()
}

test('once the person types !, a ! shell reply goes into the shell prompt without the tip', async ($, on) => {
  const { log, ui } = await withShellChips($, on)
  await drawHint($, '! for shell mode')
  await ui.press({ key: 'edit-0' })
  // Leaving shell mode brings the tip back.
  await drawHint($, '? for shortcuts')
  await ui.press({ key: 'edit-0' })
  await drawHint($, '! for shell mode')
  await ui.press({ key: 'reply-0' })
  expect(log).toEqual(['fill git status insert', 'fill git status cursor 0', TIP, 'fill git status insert'])
  await ui.unmount()
})

test(
  'in fill mode a ! shell reply gets the tip, and a bare ! is a plain reply',
  { options: { click: 'fill' } },
  async ($, on) => {
    const { log, ui } = await withShellChips($, on)
    await ui.press({ key: 'reply-0' })
    await ui.press({ key: 'reply-2' })
    expect(log).toEqual(['fill git status cursor 0', TIP, 'fill !'])
    await ui.unmount()
  },
)

test('✎ puts a reply in the input, and a slash reply runs as a command', async ($, on) => {
  const { log, ui } = await withChips($, on)
  expect(await labels(ui)).toEqual(['run the tests', '/compact', 'commit it'])
  await ui.press({ key: 'edit-2' })
  await ui.press({ key: 'reply-1' })
  expect(log).toEqual(['fill commit it', 'run compact ', 'fill  ', 'fill '])
  await ui.unmount()
})

test(
  'in fill mode a click puts the reply in the input and there is no ✎',
  { options: { click: 'fill' } },
  async ($, on) => {
    const { log, ui } = await withChips($, on)
    expect(await ui.find({ type: 'Button', key: 'edit-0' })).toBeUndefined()
    await ui.press({ key: 'reply-0' })
    expect(log).toEqual(['fill run the tests'])
    await ui.unmount()
  },
)

test('a reload mid-call does not leave the loading line up', { options: { mode: 'auto' } }, async ($, on) => {
  // No clock.settle(): the model call never finishes, as when a reload drops it.
  stubEngine(on, OPTIONS)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const status: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    status.push(e.text)

    return { value: undefined }
  })

  await finishTurn($, { engine: 'run the tests' })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  // A status line an older version pinned is cleared.
  expect(status).toEqual([undefined])

  const ui = await mountMessage($)
  expect(await labels(ui)).toEqual(['run the tests'])
  expect(await ui.find({ type: 'Text', text: /suggest/ })).toBeUndefined()
  await ui.unmount()
})
