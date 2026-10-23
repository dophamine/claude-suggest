import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Chips, Last, Message } from '../types'

const chips = atom({ plugin: 'suggest', key: 'chips' } as const, null as Chips | null)
// Kept in session state, not module variables, so a settings change (which reloads the mod) keeps them.
const recent = atom({ plugin: 'suggest', key: 'recent' } as const, [] as Message[])
const last = atom({ plugin: 'suggest', key: 'last' } as const, null as Last | null)

const system = (count: number) => `You predict what a user will type next to an AI coding assistant.
Reply with ONLY a JSON array of 0 to ${count} strings, most likely first.
Each string is a reply the user could send as-is: written as the user, in the user's language, under 80 characters, no quotes or numbering.
If the assistant asked a question or offered options, each reply answers it or picks one option. If there is an obvious next step, suggest approving it.
If the assistant told the user to run a slash command, suggest the bare command itself, starting with "/" (like "/reload-plugins"), never "run /reload-plugins".
If the next reply is not clear, return []. Fewer good replies beat more guesses.`

// Long messages keep their tail: that is where a question or a next step sits.
const clip = (text: string, max: number) => (text.length > max ? '…' + text.slice(-max) : text)

// Recent messages the model reads: newest first, until the budget runs out.
const transcript = (messages: readonly Message[], contextChars: number, messageChars: number) => {
  const picked: string[] = []
  let left = contextChars
  for (const m of [...messages].reverse()) {
    if (left <= 0) break
    const text = clip(m.text.trim(), Math.min(messageChars, left))
    picked.unshift(`<${m.role}>\n${text}\n</${m.role}>`)
    left -= text.length
  }

  return picked.join('\n\n')
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

// The turn's answer is the reply's final text; the row drawing its last block holds its tail.
const isLastBlock = (answer: string, text: string) => {
  const a = norm(answer)
  const t = norm(text)
  if (!a || !t) return false

  return a === t || a.endsWith(t) || t.endsWith(a.slice(-200))
}

const parse = (text: string): string[] => {
  const json = text.match(/\[[\s\S]*\]/)?.[0]
  if (!json) return []
  try {
    const list: unknown = JSON.parse(json)
    if (!Array.isArray(list)) return []

    return list.filter((x): x is string => typeof x === 'string').map(norm).map(bareCommand).filter(sendable)
  } catch {
    return []
  }
}

// "run /reload-plugins" becomes "/reload-plugins", so a click runs it.
const bareCommand = (x: string) => /^(?:please\s+)?(?:run|type|use|try)\s+`?(\/[\w:-]+(?:\s[^`]*)?)`?$/i.exec(x)?.[1]?.trim() ?? x

// A bare digit says nothing as a reply.
const sendable = (x: string) => x !== '' && !/^\d+$/.test(x)

// `/name args` as `$.command.run` takes it.
const asCommand = (text: string) => {
  const m = /^\/([\w:-]+)\s*([\s\S]*)$/.exec(text)

  return m?.[1] ? { command: m[1], args: (m[2] ?? '').trim() } : null
}

const merge = (a: string[], b: string[], max: number) => {
  const seen = new Set<string>()

  return [...a, ...b]
    .filter(sendable)
    .filter(x => {
      const k = x.toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)

      return true
    })
    .slice(0, max)
}

type Settings = {
  max: number
  model: string
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  contextChars: number
  messageChars: number
}

async function remember($: EngineInterface, m: Message, messageChars: number) {
  await update($, recent, list => [...list, { ...m, text: clip(m.text, messageChars) }].slice(-8))
}

// A reply that ends on a question or an offer is where suggested replies help most.
const invitesReply = (answer: string) =>
  /\?|\b(should i|shall i|want me to|would you like|let me know|which (one|option)|or should)\b/i.test(answer.slice(-600))

// Shows the chips under the last reply: the engine's own suggestion (free), then the model's
// unless `isFree`. A `hint` steers the model and leaves the engine's suggestion out.
async function suggest($: EngineInterface, s: Settings, run: { generation: number }, how: { isFree?: boolean; hint?: string } = {}) {
  const l = await read($, last)
  if (!l) return false
  const mine = (run.generation += 1)
  const first = l.engine && !how.hint ? [l.engine] : []
  // The engine's suggestion takes a slot even when it comes after this.
  const extra = how.isFree ? 0 : how.hint ? s.max : s.max - 1
  await update($, chips, () => ({ answer: l.answer, items: first, isLoading: extra > 0 }))
  if (extra === 0) return true
  const context =
    transcript(await read($, recent), s.contextChars, s.messageChars) +
    (how.hint ? `\n\nThe user asked for replies that are: ${how.hint.slice(0, 200)}` : '')

  // Off this dispatch, so the caller ends at once and the model call outlives the hook.
  $.clock.after(0, async () => {
    const r = await $.model
      .complete({
        model: s.model,
        system: system(extra),
        prompt: context,
        maxTokens: s.effort === 'low' ? 300 : 4000,
        effort: s.effort,
        timeoutMs: 20000,
      })
      .catch(() => null)
    if (mine !== run.generation) return
    const items = r?.isAnswered ? parse(r.text).slice(0, extra) : []
    await update($, chips, c => (c ? { ...c, items: merge(c.items, items, s.max), isLoading: false } : c))
    if (!(await read($, last))?.engine && items[0]) void $.prompt.suggest({ text: items[0] })
  })

  return true
}

export const register: Register = (on, options) => {
  const max = Math.max(1, Math.floor(Number(options.maxReplies) || 3))
  const mode = options.mode === 'manual' || options.mode === 'auto' ? options.mode : 'smart'
  const model = String(options.model || 'haiku')
  const effort = (['low', 'medium', 'high', 'xhigh', 'max'] as const).find(x => x === options.effort) ?? 'low'
  const contextChars = Math.max(500, Number(options.contextChars) || 6000)
  const messageChars = Math.max(200, Number(options.messageChars) || 2500)
  const isFillOnClick = options.click === 'fill'

  const settings: Settings = { max, model, effort, contextChars, messageChars }
  // Bumped per prompt and per run so a late model answer never lands on newer chips.
  const run = { generation: 0 }

  on('session.start', async ($, e, next) => {
    // A reload drops a model call in flight; its chips would say "more suggestions…" forever.
    await update($, chips, c => (c?.isLoading ? { ...c, isLoading: false } : c))
    await $.command.register({
      name: 'suggest',
      description: 'Show suggested replies now (optionally steered: /suggest shorter), or set the mode',
      argumentHint: '[hint | auto | smart | manual]',
    })

    return next(e)
  })

  on('command.run', { command: 'suggest' }, async ($, e) => {
    const arg = e.args.trim()
    const word = arg.toLowerCase()
    if (word === 'auto' || word === 'smart' || word === 'manual') {
      const { deny } = await $.config.set({ key: 'suggest.mode', value: word })

      return { text: deny ? `Couldn't switch mode: ${deny}` : `Suggest: ${word} mode` }
    }

    // Nothing goes to the session: the buttons show under the last reply.
    return (await suggest($, settings, run, { hint: arg || undefined })) ? {} : { text: 'No reply to suggest for yet.' }
  })

  on('prompt.submit', async ($, e, next) => {
    // The command reads the last reply, so its own prompt must not clear it.
    if (/^\/suggest\b/.test(e.text.trim())) return next(e)
    run.generation += 1
    const kind = e.origin.kind
    if (kind !== 'task-notification' && kind !== 'scheduled-trigger' && kind !== 'peer' && e.text.trim()) {
      await remember($, { role: 'user', text: e.text }, messageChars).catch(() => undefined)
    }
    // Never hold up the prompt over the chips.
    await update($, chips, () => null).catch(() => undefined)
    await update($, last, () => null).catch(() => undefined)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer' || !e.answer.trim()) return result

    await remember($, { role: 'assistant', text: e.answer }, messageChars)
    await update($, last, () => ({ answer: e.answer }))
    // Auto always asks the model; smart only when the reply invites one; manual never. All show the free one.
    const isFree = mode === 'manual' || (mode === 'smart' && !invitesReply(e.answer))
    await suggest($, settings, run, { isFree })

    return result
  })

  // The engine's own dim prompt suggestion becomes the first chip.
  on('prompt.suggest', { origin: { kind: 'suggestion' } }, async ($, e, next) => {
    const text = bareCommand(norm(e.text))
    if (text) {
      await update($, last, l => (l ? { ...l, engine: text } : l))
      await update($, chips, c => (c ? { ...c, items: merge([text], c.items, max) } : c))
    }

    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const c = await read($, chips)
    if (!c || e.props.isSummary || !isLastBlock(c.answer, e.props.text)) return next(e)
    if (!c.isLoading && c.items.length === 0) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    // Puts the reply in the prompt box to edit, Enter to send.
    const fill = (text: string) => async () => {
      await $.prompt.fill({ text })
    }
    // Sends the reply, or runs it when it is a slash command; an unknown command goes to the box instead.
    // The person picked it, so it goes as their own words, not framed as the plugin's message.
    const send = (text: string) => async () => {
      await update($, chips, () => null)
      const cmd = asCommand(text)
      if (!cmd) return void (await $.prompt.submit({ text, asUser: true }))
      const ran = await $.command.run(cmd).then(
        () => true,
        () => false,
      )
      if (!ran) return void (await $.prompt.fill({ text }))
      // A command sends no prompt, so the box keeps the dim suggestion; an edit clears it.
      // Only an empty box: a draft the person typed stays.
      if ((await $.prompt.read()).text !== '') return
      await $.prompt.fill({ text: ' ' })
      await $.prompt.fill({ text: '' })
    }

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box flexDirection="column" marginTop={1} gap={1}>
          {c.items.map((text, i) => (
            <Box key={`row-${i}`} flexDirection="row" gap={1}>
              <Button
                key={`reply-${i}`}
                label={text}
                variant={i === 0 ? 'primary' : 'secondary'}
                onPress={isFillOnClick ? fill(text) : send(text)}
              />
              {isFillOnClick ? null : <Button key={`edit-${i}`} label="✎" plain dimColor onPress={fill(text)} />}
            </Box>
          ))}
          {c.isLoading ? <Text dimColor>{c.items.length ? 'more suggestions…' : 'suggesting replies…'}</Text> : null}
        </Box>
      </Box>
    )
  })
}
