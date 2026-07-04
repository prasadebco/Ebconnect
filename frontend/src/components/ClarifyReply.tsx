'use client'

import { useState } from 'react'

interface Props {
  // Submit the user's inline answer as the next question in the SAME
  // conversation (the backend resumes with prior-turn context).
  onAnswer: (answer: string) => void
  disabled?: boolean
}

// Inline quick-reply affordance rendered directly on a clarifying-question
// turn, so the user can answer the agent's question without hunting for the
// main input. Submitting sends the answer as the next turn in the same chat.
export function ClarifyReply({ onAnswer, disabled }: Props) {
  const [value, setValue] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const v = value.trim()
    if (!v || disabled) return
    onAnswer(v)
    setValue('')
  }

  return (
    <form
      onSubmit={submit}
      data-testid="clarify-reply"
      className="mt-3 flex items-end gap-2"
    >
      <input
        data-testid="clarify-input"
        className="flex-1 rounded-lg border border-amber-300 bg-amber-50/40 px-3 py-2 text-sm shadow-sm transition placeholder:text-amber-700/50 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-400/30 disabled:bg-slate-50"
        placeholder="Answer to continue…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        autoFocus
      />
      <button
        type="submit"
        data-testid="clarify-send"
        disabled={disabled || !value.trim()}
        className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-50 disabled:shadow-none"
      >
        Send
      </button>
    </form>
  )
}
