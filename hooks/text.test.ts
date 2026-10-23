import { expect, test } from 'claude-code/testing'

import {
  clip,
  formatTranscript,
  invitesReply,
  isAnswerTail,
  isShellCommand,
  mergeReplies,
  parseReplies,
  parseSlashCommand,
  toBareCommand,
} from './text'

test('a long message keeps its tail', () => {
  expect(clip('abcdef', 3)).toBe('…def')
  expect(clip('abc', 3)).toBe('abc')
})

test('the transcript takes the newest messages first and shows them oldest first', () => {
  const messages = [
    { role: 'user', text: 'old question' },
    { role: 'assistant', text: 'new answer' },
  ] as const
  expect(formatTranscript(messages, 100, 100)).toBe(
    '<user>\nold question\n</user>\n\n<assistant>\nnew answer\n</assistant>',
  )
  expect(formatTranscript(messages, 10, 100)).toBe('<assistant>\nnew answer\n</assistant>')
})

test('the buttons go under the block that ends the answer', () => {
  expect(isAnswerTail('First part.\n\nWant me to commit?', 'Want me to  commit?')).toBe(true)
  expect(isAnswerTail('First part.\n\nWant me to commit?', 'First part.')).toBe(false)
  expect(isAnswerTail('', '')).toBe(false)
})

test('the model answer parses to clean replies', () => {
  expect(parseReplies('Sure: ["run /compact", " commit   it ", "2", 3, ""]')).toEqual(['/compact', 'commit it'])
  expect(parseReplies('no list here')).toEqual([])
  expect(parseReplies('[not json]')).toEqual([])
})

test('an instruction to run a slash command becomes the command', () => {
  expect(toBareCommand('Please try `/compact now`')).toBe('/compact now')
  expect(toBareCommand('run the tests')).toBe('run the tests')
})

test('a shell command needs something after its !', () => {
  expect(isShellCommand('! git status')).toBe(true)
  expect(isShellCommand('!')).toBe(false)
})

test('a slash reply splits into command and args', () => {
  expect(parseSlashCommand('/suggest  shorter ')).toEqual({ command: 'suggest', args: 'shorter' })
  expect(parseSlashCommand('commit it')).toBeNull()
})

test('merging drops repeats that differ only in case or punctuation, and cuts to the limit', () => {
  expect(mergeReplies(['Commit it.'], ['commit it', '', 'push', 'tag'], 3)).toEqual(['Commit it.', 'push', 'tag'])
})

test('a question or an offer at the end invites a reply', () => {
  expect(invitesReply('Done. Want me to commit?')).toBe(true)
  expect(invitesReply('Done. All tests pass.')).toBe(false)
})
