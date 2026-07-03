'use client'

import { useEffect, useRef, useState } from 'react'
import { ChatMessage, type ChatTurn } from './ChatMessage'

interface Props {
  datasetName: string
  turns: ChatTurn[]
  busy: boolean
  onAsk: (question: string) => void
}

export function ChatPane({ datasetName, turns, busy, onAsk }: Props) {
  const [value, setValue] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [turns])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const q = value.trim()
    if (!q || busy) return
    onAsk(q)
    setValue('')
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
        {turns.length === 0 ? (
          <div
            data-testid="chat-empty"
            className="mx-auto mt-16 max-w-md text-center text-sm text-gray-400"
          >
            <div className="text-2xl">💬</div>
            <p className="mt-2">
              Ask your first question about{' '}
              <span className="font-medium text-gray-600">{datasetName}</span> —
              e.g. &ldquo;what is total revenue by region?&rdquo;
            </p>
          </div>
        ) : (
          turns.map((t) => <ChatMessage key={t.id} turn={t} />)
        )}
      </div>

      <form
        onSubmit={submit}
        className="border-t border-gray-200 bg-white px-4 py-3"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <input
            data-testid="question-input"
            className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50"
            placeholder={
              busy
                ? 'Working on your question…'
                : 'Ask a question about your data…'
            }
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
          />
          <button
            type="submit"
            data-testid="ask-button"
            disabled={busy || !value.trim()}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Asking…' : 'Ask'}
          </button>
        </div>
        <p className="mx-auto mt-1.5 max-w-3xl text-[11px] text-gray-400">
          One question at a time · analysis runs locally · only profile + a small
          sample go to the model
        </p>
      </form>
    </div>
  )
}
