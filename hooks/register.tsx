import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Buttons, LastReply, Message } from '../types'
import {
  clip,
  formatTranscript,
  invitesReply,
  isAnswerTail,
  isShellCommand,
  mergeReplies,
  normalizeSpace,
  parseReplies,
  parseSlashCommand,
  replyKey,
  systemPrompt,
  toBareCommand,
} from './text'

// Messages kept for the model to read, prompts and answers together.
const RECENT_MESSAGES = 8
// Longest `/suggest <hint>` passed on to the model.
const HINT_CHARS = 200
const MODEL_TIMEOUT_MS = 20_000
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
// Prompts that don't come from the person aren't part of the conversation the model reads.
const NON_PERSON_ORIGINS = new Set(['task-notification', 'scheduled-trigger', 'peer'])
// Drawn dim after a `!` shell command that was put in the input without its `!`.
const SHELL_TIP = '  (add ! at the beginning to run it in your shell, or press Enter to ask Claude)'

// Kept in session state, not module variables, so a settings change (which reloads the mod) keeps them.
const buttons = atom({ plugin: 'suggest', key: 'buttons' } as const, null as Buttons | null)
const recent = atom({ plugin: 'suggest', key: 'recent' } as const, [] as Message[])
const lastReply = atom({ plugin: 'suggest', key: 'lastReply' } as const, null as LastReply | null)

type Settings = {
  mode: 'auto' | 'smart' | 'manual'
  isFillOnClick: boolean
  maxReplies: number
  model: string
  effort: (typeof EFFORTS)[number]
  contextChars: number
  messageChars: number
}

// Bumped on every prompt and every suggestion run, so a model answer that arrives late never lands on newer buttons.
type Generation = { current: number }

// What the person asked for when buttons are shown.
type Request = {
  // Show only the free buttons, without calling the model.
  isFree?: boolean
  // Steers the model, from `/suggest <hint>`, and leaves Claude Code's own suggestion out.
  hint?: string
}

const readSettings = (options: Parameters<Register>[1]): Settings => ({
  mode: options.mode === 'auto' || options.mode === 'manual' ? options.mode : 'smart',
  isFillOnClick: options.click === 'fill',
  maxReplies: Math.max(1, Math.floor(Number(options.maxReplies) || 3)),
  model: String(options.model || 'haiku'),
  effort: EFFORTS.find(effort => effort === options.effort) ?? 'low',
  contextChars: Math.max(500, Number(options.contextChars) || 6000),
  messageChars: Math.max(200, Number(options.messageChars) || 2500),
})

async function rememberMessage($: EngineInterface, message: Message, messageChars: number) {
  const clipped = { ...message, text: clip(message.text, messageChars) }
  await update($, recent, messages => [...messages, clipped].slice(-RECENT_MESSAGES))
}

// How many replies to ask the model for; 0 means no model call.
function modelReplyCount(settings: Settings, request: Request) {
  if (request.isFree) return 0
  // A single button is Claude Code's own suggestion, unless a hint replaces it.
  if (settings.maxReplies === 1 && !request.hint) return 0

  // Asks for every button, not just the ones left: Claude Code's suggestion may never come or may repeat
  // one of the model's, and the merge puts it first and cuts the list to the limit anyway.
  return settings.maxReplies
}

async function askModel($: EngineInterface, settings: Settings, prompt: string, count: number) {
  const result = await $.model
    .complete({
      model: settings.model,
      system: systemPrompt(count),
      prompt,
      maxTokens: settings.effort === 'low' ? 300 : 4000,
      effort: settings.effort,
      timeoutMs: MODEL_TIMEOUT_MS,
    })
    .catch(() => null)

  return result?.isAnswered ? parseReplies(result.text).slice(0, count) : []
}

async function addModelReplies(
  $: EngineInterface,
  settings: Settings,
  generation: Generation,
  runId: number,
  prompt: string,
  count: number,
) {
  const replies = await askModel($, settings, prompt, count)
  if (runId !== generation.current) return
  await update($, buttons, shown =>
    shown ? { ...shown, replies: mergeReplies(shown.replies, replies, settings.maxReplies), isLoading: false } : shown,
  )

  // Without a suggestion from Claude Code, the model's first reply becomes the dim one in the input.
  // Taken with Tab, unlike a fill, a `!` shell command there switches on shell mode.
  const engineSuggestion = (await read($, lastReply))?.engineSuggestion
  if (!engineSuggestion && replies[0]) void $.prompt.suggest({ text: replies[0] })
}

// Shows buttons under the last reply: Claude Code's own suggestion right away, then the model's replies
// once they come. Returns false when there is no reply to suggest for yet.
async function showButtons($: EngineInterface, settings: Settings, generation: Generation, request: Request = {}) {
  const reply = await read($, lastReply)
  if (!reply) return false

  generation.current += 1
  const runId = generation.current
  const free = reply.engineSuggestion && !request.hint ? [reply.engineSuggestion] : []
  const count = modelReplyCount(settings, request)
  await update($, buttons, () => ({ answer: reply.answer, replies: free, isLoading: count > 0 }))
  if (count === 0) return true

  const transcript = formatTranscript(await read($, recent), settings.contextChars, settings.messageChars)
  const hint = request.hint ? `\n\nThe user asked for replies that are: ${request.hint.slice(0, HINT_CHARS)}` : ''
  // Runs after this dispatch, so the hook returns at once and the model call can outlive it.
  $.clock.after(0, () => addModelReplies($, settings, generation, runId, transcript + hint, count))

  return true
}

// Puts a reply in the input to edit; Enter sends it.
async function fillInput($: EngineInterface, text: string) {
  if (!isShellCommand(text)) {
    await $.prompt.fill({ text })
    return
  }

  // A filled `!` can't switch on shell mode, but typing one does. So the command goes in without its `!`,
  // with the caret at the start where the `!` goes, and a dim tip after it. The tip is not part of the draft
  // and goes away at the next edit.
  const command = text.slice(1).trim()
  await $.prompt.fill({
    text: command,
    cursor: 0,
    decorations: [
      {
        start: command.length,
        end: command.length,
        virtualText: SHELL_TIP,
        color: 'subtle',
        dimColor: true,
        italic: true,
      },
    ],
  })
}

// Running a command sends no prompt, so the input keeps showing Claude Code's dim suggestion. An edit clears it,
// but only an empty input is touched: a draft the person typed stays.
async function clearInputSuggestion($: EngineInterface) {
  if ((await $.prompt.read()).text !== '') return
  await $.prompt.fill({ text: ' ' })
  await $.prompt.fill({ text: '' })
}

// Sends a reply as the person's own words, not as the plugin's message, or runs it when it is a slash command.
async function sendReply($: EngineInterface, text: string) {
  await update($, buttons, () => null)

  // A plugin's prompt can't run in shell mode, so a `!` shell command goes to the input, never to Claude.
  if (isShellCommand(text)) {
    await fillInput($, text)
    return
  }

  const command = parseSlashCommand(text)
  if (!command) {
    await $.prompt.submit({ text, asUser: true })
    return
  }

  const ran = await $.command.run(command).then(
    () => true,
    () => false,
  )
  if (ran) {
    await clearInputSuggestion($)
  } else {
    // An unknown command goes to the input to edit.
    await $.prompt.fill({ text })
  }
}

export const register: Register = (on, options) => {
  const settings = readSettings(options)
  const generation: Generation = { current: 0 }

  on('session.start', async ($, e, next) => {
    // A reload drops a model call in flight, which would leave "more suggestions…" up forever.
    await update($, buttons, shown => (shown?.isLoading ? { ...shown, isLoading: false } : shown))
    // A status line stays pinned across a reload. This version pins none, so clear one an older version left.
    $.ui.status(undefined)
    await $.command.register({
      name: 'suggest',
      description: 'Show suggested replies now (optionally steered: /suggest shorter), or set the mode',
      argumentHint: '[hint | auto | smart | manual]',
    })

    return next(e)
  })

  on('command.run', { command: 'suggest' }, async ($, e) => {
    const arg = e.args.trim()
    const mode = arg.toLowerCase()
    if (mode === 'auto' || mode === 'smart' || mode === 'manual') {
      const { deny } = await $.config.set({ key: 'suggest.mode', value: mode })

      return { text: deny ? `Couldn't switch mode: ${deny}` : `Suggest: ${mode} mode` }
    }

    // Nothing goes to the session: the buttons show under the last reply.
    const isShown = await showButtons($, settings, generation, { hint: arg || undefined })

    return isShown ? {} : { text: 'No reply to suggest for yet.' }
  })

  on('prompt.submit', async ($, e, next) => {
    // `/suggest` reads the last reply, so its own prompt must not clear it.
    if (/^\/suggest\b/.test(e.text.trim())) return next(e)

    generation.current += 1
    // Errors are swallowed: the buttons must never hold up the prompt.
    if (!NON_PERSON_ORIGINS.has(e.origin.kind) && e.text.trim()) {
      await rememberMessage($, { role: 'user', text: e.text }, settings.messageChars).catch(() => undefined)
    }
    await update($, buttons, () => null).catch(() => undefined)
    await update($, lastReply, () => null).catch(() => undefined)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer' || !e.answer.trim()) return result

    await rememberMessage($, { role: 'assistant', text: e.answer }, settings.messageChars)
    await update($, lastReply, () => ({ answer: e.answer }))
    // Every mode shows the free suggestion. Auto also asks the model every time, smart only when the answer
    // invites a reply, and manual never.
    const isFree = settings.mode === 'manual' || (settings.mode === 'smart' && !invitesReply(e.answer))
    await showButtons($, settings, generation, { isFree })

    return result
  })

  // Claude Code's own dim suggestion in the input becomes the first button, even after the model's replies show.
  // It is marked as Claude's, so it reads as such when it moves to the top.
  on('prompt.suggest', { origin: { kind: 'suggestion' } }, async ($, e, next) => {
    const text = toBareCommand(normalizeSpace(e.text))
    if (text) {
      await update($, lastReply, reply => (reply ? { ...reply, engineSuggestion: text } : reply))
      await update($, buttons, shown =>
        shown ? { ...shown, replies: mergeReplies([text], shown.replies, settings.maxReplies) } : shown,
      )
    }

    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const shown = await read($, buttons)
    if (!shown || e.props.isSummary || !isAnswerTail(shown.answer, e.props.text)) return next(e)
    if (!shown.isLoading && shown.replies.length === 0) return next(e)

    const engineSuggestion = (await read($, lastReply))?.engineSuggestion
    const isEngineSuggestion = (text: string) =>
      engineSuggestion !== undefined && replyKey(engineSuggestion) === replyKey(text)
    const onPress = (text: string) => () => (settings.isFillOnClick ? fillInput($, text) : sendReply($, text))

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box flexDirection="column" marginTop={1} gap={1}>
          {shown.replies.map((text, i) => (
            <Box key={`row-${i}`} flexDirection="row" gap={1}>
              {/* Claude Code's own suggestion gets a dim ✻; every other row a blank, so the buttons line up. */}
              <Text dimColor>{isEngineSuggestion(text) ? '✻' : ' '}</Text>
              <Button
                key={`reply-${i}`}
                label={text}
                variant={i === 0 ? 'primary' : 'secondary'}
                onPress={onPress(text)}
              />
              {settings.isFillOnClick ? null : (
                <Button key={`edit-${i}`} label="✎" plain dimColor onPress={() => fillInput($, text)} />
              )}
            </Box>
          ))}
          {shown.isLoading ? (
            <Text dimColor>{shown.replies.length ? 'more suggestions…' : 'suggesting replies…'}</Text>
          ) : null}
        </Box>
      </Box>
    )
  })
}
