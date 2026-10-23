// The buttons under the last reply.
export type Buttons = {
  // The final text of the turn the buttons belong to, used to find the message block to draw them under.
  answer: string
  replies: string[]
  // The model has been asked for more replies and hasn't answered yet.
  isLoading: boolean
}

export type Message = { role: 'user' | 'assistant'; text: string }

// The last main-loop reply, plus Claude Code's own suggestion for it once that arrives.
export type LastReply = { answer: string; engineSuggestion?: string }

declare module 'claude-code' {
  interface PluginState {
    suggest: { buttons: Buttons | null; recent: Message[]; lastReply: LastReply | null }
  }
}
