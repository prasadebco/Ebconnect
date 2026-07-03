'use client'

import type { AnswerEvent, UsageEvent } from '@/lib/types'
import { AnswerChart } from './AnswerChart'
import { AnswerTable } from './AnswerTable'
import { ComingSoonBadge } from './ComingSoon'

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  // user
  question?: string
  // assistant in-flight
  status: 'streaming' | 'done' | 'error' | 'clarify'
  steps: string[]
  currentStep?: string
  elapsedMs?: number
  usage?: UsageEvent | null
  answer?: AnswerEvent | null
  errorMessage?: string
  // True when this turn was reloaded from persisted history (Phase 2).
  past?: boolean
}

function fmtElapsed(ms: number): string {
  const s = ms / 1000
  return `${s.toFixed(1)}s`
}

export function ChatMessage({ turn }: { turn: ChatTurn }) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end" data-testid="user-message">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent-600 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm">
          {turn.question}
        </div>
      </div>
    )
  }

  const streaming = turn.status === 'streaming'

  return (
    <div className="flex justify-start" data-testid="assistant-message">
      <div className="w-full max-w-[92%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3.5 text-sm shadow-sm ring-1 ring-slate-900/[0.02]">
        {/* Live steps + timer while running */}
        {streaming && (
          <div data-testid="live-status" className="space-y-2">
            <div className="flex items-center gap-2 text-accent-600">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent-500" />
              <span data-testid="current-step" className="font-medium">
                {turn.currentStep ?? 'Working…'}
              </span>
              <span
                data-testid="elapsed-timer"
                className="ml-auto font-mono text-xs tabular-nums text-slate-400"
              >
                {fmtElapsed(turn.elapsedMs ?? 0)}
              </span>
            </div>
            <ol className="ml-1 space-y-1 text-xs text-slate-400">
              {turn.steps.map((s, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span className="text-emerald-500">✓</span> {s}
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Error bubble */}
        {turn.status === 'error' && (
          <div data-testid="error-message" className="text-red-600">
            {turn.errorMessage ??
              "Couldn't complete this — try rephrasing your question."}
          </div>
        )}

        {/* Clarifying question */}
        {turn.status === 'clarify' && turn.answer && (
          <div data-testid="clarify-message">
            <div className="mb-1.5 inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              Needs clarification
            </div>
            <p className="whitespace-pre-wrap leading-relaxed text-slate-700">
              {turn.answer.content}
            </p>
          </div>
        )}

        {/* Completed answer */}
        {turn.status === 'done' && turn.answer && (
          <div data-testid="answer-content">
            {turn.answer.confidence && turn.answer.confidence !== 'high' && (
              <div className="mb-2 inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                flagged — verify
              </div>
            )}
            <p className="whitespace-pre-wrap leading-relaxed text-slate-700">
              {turn.answer.content}
            </p>
            {turn.answer.chart && <AnswerChart spec={turn.answer.chart} />}
            {turn.answer.table && <AnswerTable table={turn.answer.table} />}

            {/* Answer toolbar — Phase-1 stubs */}
            <div
              data-testid="answer-toolbar"
              className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-400"
            >
              <button
                type="button"
                disabled
                data-testid="show-code-stub"
                className="inline-flex cursor-not-allowed items-center rounded-md border border-slate-200 px-2.5 py-1 opacity-70"
                title="Coming soon — reveal the analysis code"
              >
                {'</> Show code'}
                <ComingSoonBadge label="P3" />
              </button>
              <button
                type="button"
                disabled
                data-testid="export-stub"
                className="inline-flex cursor-not-allowed items-center rounded-md border border-slate-200 px-2.5 py-1 opacity-70"
                title="Coming soon — export result as CSV/PNG"
              >
                ⬇ Export
                <ComingSoonBadge label="P3" />
              </button>
            </div>

            {/* Follow-up suggestion chips — stub */}
            <div
              data-testid="followup-stub"
              className="mt-2.5 flex flex-wrap items-center gap-2 opacity-70"
            >
              <span className="text-[11px] text-slate-400">Suggested follow-ups</span>
              <ComingSoonBadge label="P3" />
              <span className="cursor-not-allowed rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-[11px] text-slate-400">
                Break that down by month
              </span>
              <span className="cursor-not-allowed rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-[11px] text-slate-400">
                Show the top 5
              </span>
            </div>
          </div>
        )}

        {/* Usage / cost line */}
        {turn.usage && (
          <div
            data-testid="usage-line"
            className="mt-3 border-t border-slate-100 pt-2.5 font-mono text-[11px] tabular-nums text-slate-400"
          >
            {turn.usage.total.toLocaleString()} tokens ({turn.usage.prompt}▸
            {turn.usage.completion}) · $
            {turn.usage.cost_usd.toFixed(4)} ·{' '}
            {fmtElapsed(turn.usage.elapsed_ms)}
          </div>
        )}
      </div>
    </div>
  )
}
