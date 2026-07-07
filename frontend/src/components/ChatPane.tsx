'use client'

import { useEffect, useRef, useState } from 'react'
import { ChatMessage, type ChatTurn } from './ChatMessage'

interface Props {
  datasetName: string
  turns: ChatTurn[]
  busy: boolean
  conversationId: string | null
  onAsk: (question: string) => void
}

export function ChatPane({
  datasetName,
  turns,
  busy,
  conversationId,
  onAsk,
}: Props) {
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
      <div ref={scrollRef} className="mx-auto w-full max-w-3xl flex-1 space-y-5 overflow-y-auto px-6 py-8">
        {turns.length === 0 ? (
          <div
            data-testid="chat-empty"
            className="mx-auto mt-20 max-w-md text-center text-sm text-slate-400 dark:text-slate-500"
          >
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-50 text-2xl ring-1 ring-inset ring-accent-100 dark:bg-accent-500/10 dark:ring-accent-400/20">
              💬
            </div>
            <p className="mt-4 leading-relaxed">
              Ask your first question about{' '}
              <span className="font-medium text-slate-600 dark:text-slate-300">
                {datasetName}
              </span>{' '}
              — e.g. &ldquo;what is total revenue by region?&rdquo;
            </p>
          </div>
        ) : (
          turns.map((t, i) => (
            <div key={t.id} data-testid={t.past ? 'past-turn' : undefined}>
              <ChatMessage
                turn={t}
                conversationId={conversationId}
                isLast={i === turns.length - 1}
                onFollowup={busy ? undefined : onAsk}
              />
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={submit}
        className="border-t border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <input
            data-testid="question-input"
            className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-accent-400 dark:disabled:bg-slate-800/60"
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
            className="rounded-xl bg-accent-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-accent-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 disabled:opacity-50 disabled:shadow-none dark:bg-accent-500 dark:hover:bg-accent-400"
          >
            {busy ? 'Asking…' : 'Ask'}
          </button>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-[11px] text-slate-400 dark:text-slate-500">
          One question at a time · analysis runs locally · only profile + a small
          sample go to the model
        </p>
      </form>
    </div>
  )
}
