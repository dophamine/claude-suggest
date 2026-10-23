import type { Message } from '../types'

// Pure text helpers: the prompt the model reads, parsing its answer, and comparing replies.
// Nothing here calls Claude Code, so each one can be tested on its own.

// Longest reply the model is asked to write.
const REPLY_CHARS = 80
// How much of the end of the answer must match a rendered block for the buttons to go under it.
const TAIL_MATCH_CHARS = 200
// How much of the end of an answer is searched for a question or an offer.
const INVITE_TAIL_CHARS = 600

export const systemPrompt = (count: number) => `You predict what a user will type next to an AI coding assistant.
Reply with ONLY a JSON array of 0 to ${count} strings, most likely first.
Each string is a reply the user could send as-is: written as the user, in the user's language, under ${REPLY_CHARS} characters, no quotes or numbering.
If the assistant asked a question or offered options, each reply answers it or picks one option. If there is an obvious next step, suggest approving it.
If the assistant told the user to run a slash command, suggest the bare command itself, starting with "/" (like "/reload-plugins"), never "run /reload-plugins".
If the next reply is not clear, return []. Fewer good replies beat more guesses.`

// Cuts a long message down to its last `max` characters, because a question or a next step is usually at the end.
export const clip = (text: string, max: number) => (text.length > max ? '…' + text.slice(-max) : text)

// The recent conversation as the model reads it. Messages are taken newest first until `contextChars` runs out,
// each clipped to `messageChars`, then shown oldest first.
export const formatTranscript = (messages: readonly Message[], contextChars: number, messageChars: number) => {
  const picked: string[] = []
  let charsLeft = contextChars
  for (const message of [...messages].reverse()) {
    if (charsLeft <= 0) break
    const text = clip(message.text.trim(), Math.min(messageChars, charsLeft))
    picked.unshift(`<${message.role}>\n${text}\n</${message.role}>`)
    charsLeft -= text.length
  }

  return picked.join('\n\n')
}

export const normalizeSpace = (text: string) => text.replace(/\s+/g, ' ').trim()

// Whether a rendered message block is the last block of `answer`. A long answer renders as several blocks,
// and the buttons belong under the last one.
export const isAnswerTail = (answer: string, blockText: string) => {
  const a = normalizeSpace(answer)
  const block = normalizeSpace(blockText)
  if (!a || !block) return false

  return a === block || a.endsWith(block) || block.endsWith(a.slice(-TAIL_MATCH_CHARS))
}

// Turns an instruction to run a slash command into the command itself, so a click runs it:
// "run /reload-plugins" and "Please try `/compact now`" become "/reload-plugins" and "/compact now".
export const toBareCommand = (text: string) =>
  /^(?:please\s+)?(?:run|type|use|try)\s+`?(\/[\w:-]+(?:\s[^`]*)?)`?$/i.exec(text)?.[1]?.trim() ?? text

// A `!` shell command, as typed to run in shell mode. A bare `!` is not one.
export const isShellCommand = (text: string) => /^!\s*\S/.test(text)

// An empty reply, or a bare number like "2", says nothing on its own.
export const isSendable = (text: string) => text !== '' && !/^\d+$/.test(text)

// The model's answer as a list of replies. Anything that isn't a JSON array of strings gives none.
export const parseReplies = (modelText: string): string[] => {
  const json = modelText.match(/\[[\s\S]*\]/)?.[0]
  if (!json) return []
  try {
    const list: unknown = JSON.parse(json)
    if (!Array.isArray(list)) return []

    return list
      .filter((item): item is string => typeof item === 'string')
      .map(normalizeSpace)
      .map(toBareCommand)
      .filter(isSendable)
  } catch {
    return []
  }
}

// Splits "/name args" into the shape `$.command.run` takes, or gives null when the text is not a slash command.
export const parseSlashCommand = (text: string) => {
  const match = /^\/([\w:-]+)\s*([\s\S]*)$/.exec(text)
  if (!match?.[1]) return null

  return { command: match[1], args: (match[2] ?? '').trim() }
}

// Replies that differ only in case or punctuation get the same key, so they count as one reply.
export const replyKey = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}/]+/gu, ' ')
    .trim()

// `first` then `rest`, without empty replies or repeats, cut to `max`.
export const mergeReplies = (first: readonly string[], rest: readonly string[], max: number) => {
  const seen = new Set<string>()

  return [...first, ...rest]
    .filter(isSendable)
    .filter(reply => {
      const key = replyKey(reply)
      if (seen.has(key)) return false
      seen.add(key)

      return true
    })
    .slice(0, max)
}

// Whether the answer ends on a question or an offer, which is where suggested replies help most.
export const invitesReply = (answer: string) =>
  /\?|\b(should i|shall i|want me to|would you like|let me know|which (one|option)|or should)\b/i.test(
    answer.slice(-INVITE_TAIL_CHARS),
  )
