export type Chips = {
  // The final text of the turn the chips belong to, to find its message row.
  answer: string
  items: string[]
  isLoading: boolean
}

export type Message = { role: 'user' | 'assistant'; text: string }

// The last main-loop reply, and the engine's own suggestion for it once it comes.
export type Last = { answer: string; engine?: string }

declare module 'claude-code' {
  interface PluginState {
    'suggest': { chips: Chips | null; recent: Message[]; last: Last | null }
  }
}
