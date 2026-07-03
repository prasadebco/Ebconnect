'use client'

import { useState } from 'react'
import type { AnswerEvent, UsageEvent } from '@/lib/types'
import { downloadExport } from '@/lib/api'
import { AnswerChart } from './AnswerChart'
import { AnswerTable } from './AnswerTable'

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

interface ChatMessageProps {
  turn: ChatTurn
  // Phase-3 wiring: the conversation the turn belongs to (for export URLs) and
  // a callback to submit a follow-up chip as the next question.
  conversationId?: string | null
  onFollowup?: (question: string) => void
}

export function ChatMessage({
  turn,
  conversationId,
  onFollowup,
}: ChatMessageProps) {
  const [showCode, setShowCode] = useState(false)
  const [exporting, setExporting] = useState<null | 'csv' | 'png'>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  async function handleExport(format: 'csv' | 'png') {
    if (!conversationId || !turn.answer?.message_id || exporting) return
    setExporting(format)
    setExportError(null)
    try {
      const filename = `result-${turn.answer.message_id.slice(0, 8)}.${format}`
      await downloadExport(
        conversationId,
        turn.answer.message_id,
        format,
        filename,
      )
    } catch (e) {
      setExportError(
        e instanceof Error ? e.message : `Couldn't export ${format}.`,
      )
    } finally {
      setExporting(null)
    }
  }

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

            {/* Answer toolbar — Show code + Export (Phase 3, real) */}
            <div
              data-testid="answer-toolbar"
              className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500"
            >
              {turn.answer.code && (
                <button
                  type="button"
                  data-testid="show-code-toggle"
                  aria-expanded={showCode}
                  onClick={() => setShowCode((v) => !v)}
                  className="inline-flex items-center rounded-md border border-slate-200 px-2.5 py-1 font-medium transition hover:bg-slate-50"
                >
                  {showCode ? '</> Hide code' : '</> Show code'}
                </button>
              )}
              <button
                type="button"
                data-testid="export-csv"
                disabled={
                  !turn.answer.table ||
                  !conversationId ||
                  exporting === 'csv'
                }
                onClick={() => handleExport('csv')}
                title={
                  turn.answer.table
                    ? 'Download the result table as CSV'
                    : 'No table to export'
                }
                className="inline-flex items-center rounded-md border border-slate-200 px-2.5 py-1 font-medium transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exporting === 'csv' ? 'Exporting…' : '⬇ Export CSV'}
              </button>
              <button
                type="button"
                data-testid="export-png"
                disabled={
                  !turn.answer.chart ||
                  !conversationId ||
                  exporting === 'png'
                }
                onClick={() => handleExport('png')}
                title={
                  turn.answer.chart
                    ? 'Download the chart as PNG'
                    : 'No chart to export'
                }
                className="inline-flex items-center rounded-md border border-slate-200 px-2.5 py-1 font-medium transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exporting === 'png' ? 'Exporting…' : '⬇ Export PNG'}
              </button>
            </div>

            {exportError && (
              <div
                data-testid="export-error"
                className="mt-2 text-[11px] text-red-600"
              >
                {exportError}
              </div>
            )}

            {/* Collapsible analysis code — hidden (clean) by default */}
            {turn.answer.code && showCode && (
              <pre
                data-testid="code-block"
                className="mt-2.5 max-h-96 overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-3 font-mono text-[12px] leading-relaxed text-slate-100"
              >
                <code>{turn.answer.code}</code>
              </pre>
            )}

            {/* Follow-up suggestion chips (Phase 3, real) */}
            {turn.answer.followups && turn.answer.followups.length > 0 && (
              <div
                data-testid="followup-list"
                className="mt-3 flex flex-wrap items-center gap-2"
              >
                <span className="text-[11px] text-slate-400">
                  Suggested follow-ups
                </span>
                {turn.answer.followups.slice(0, 3).map((q, i) => (
                  <button
                    key={i}
                    type="button"
                    data-testid="followup-chip"
                    disabled={!onFollowup}
                    onClick={() => onFollowup?.(q)}
                    className="rounded-full border border-accent-200 bg-accent-50/60 px-2.5 py-0.5 text-[11px] font-medium text-accent-700 transition hover:bg-accent-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
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
