'use client'

import { useState } from 'react'
import type { AnswerEvent, UsageEvent } from '@/lib/types'
import { downloadExport } from '@/lib/api'
import { humanizeError } from '@/lib/errors'
import { AnswerChart } from './AnswerChart'
import { AnswerTable } from './AnswerTable'
import { ClarifyReply } from './ClarifyReply'
import { LiveSteps, StepTrail } from './StepTrail'

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
  // Phase-4: whether this is the last turn — the inline clarify-reply box only
  // renders on the latest clarifying question (older ones are read-only).
  isLast?: boolean
  // Phase-6: dashboard pinning. `pinnedTileId` is the id of the tile pinning
  // this answer (null/undefined when unpinned); `onTogglePin` pins or unpins.
  // `pinBusy` disables the control mid-request.
  pinnedTileId?: string | null
  onTogglePin?: (messageId: string, pinnedTileId: string | null) => void
  pinBusy?: boolean
}

export function ChatMessage({
  turn,
  conversationId,
  onFollowup,
  isLast,
  pinnedTileId,
  onTogglePin,
  pinBusy,
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
        e instanceof Error
          ? humanizeError(e.message)
          : `Couldn't export ${format}.`,
      )
    } finally {
      setExporting(null)
    }
  }

  if (turn.role === 'user') {
    return (
      <div className="flex justify-end" data-testid="user-message">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent-600 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm dark:bg-accent-500">
          {turn.question}
        </div>
      </div>
    )
  }

  const streaming = turn.status === 'streaming'
  // Read confidence defensively: only medium/low flags; anything else
  // (high, absent, unknown string) renders clean with no badge.
  const conf = turn.answer?.confidence
  const lowConfidence = conf === 'low' || conf === 'medium'

  return (
    <div className="flex justify-start" data-testid="assistant-message">
      <div className="w-full max-w-[92%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3.5 text-sm shadow-card ring-1 ring-slate-900/[0.02] dark:border-slate-800 dark:bg-slate-900 dark:ring-white/[0.03]">
        {/* Live steps + timer while running */}
        {streaming && (
          <div data-testid="live-status" className="space-y-2">
            <div className="flex items-center gap-2 text-accent-600 dark:text-accent-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent-500" />
              <span data-testid="current-step" className="font-medium">
                {turn.currentStep ?? 'Working…'}
              </span>
              <span
                data-testid="elapsed-timer"
                className="ml-auto font-mono text-xs tabular-nums text-slate-400 dark:text-slate-500"
              >
                {fmtElapsed(turn.elapsedMs ?? 0)}
              </span>
            </div>
            <LiveSteps steps={turn.steps} />
          </div>
        )}

        {/* Error bubble — a clean, friendly affordance (never a raw stack or a
            hung spinner). Offers a one-click retry of the same question. */}
        {turn.status === 'error' && (
          <div data-testid="error-message" role="alert" className="space-y-2">
            <div className="flex items-start gap-2 text-red-600 dark:text-red-400">
              <span aria-hidden="true" className="mt-px shrink-0">
                ⚠
              </span>
              <span>
                {turn.errorMessage ??
                  "Couldn't complete this — try rephrasing your question."}
              </span>
            </div>
            {turn.question && onFollowup && (
              <button
                type="button"
                data-testid="retry-question"
                onClick={() => onFollowup(turn.question as string)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                ↻ Try again
              </button>
            )}
          </div>
        )}

        {/* Clarifying question — distinct from an error and a normal answer.
            The user can answer inline; their reply resumes the SAME chat. */}
        {turn.status === 'clarify' && turn.answer && (
          <div data-testid="clarify-turn">
            <div className="mb-1.5 inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
              <span aria-hidden="true">✳</span> I need a quick clarification
            </div>
            <p
              data-testid="clarify-question"
              className="whitespace-pre-wrap leading-relaxed text-slate-700 dark:text-slate-200"
            >
              {turn.answer.content}
            </p>
            {/* Inline quick-reply on the latest clarify turn only. */}
            {isLast && onFollowup && (
              <ClarifyReply onAnswer={onFollowup} disabled={!onFollowup} />
            )}
            <StepTrail steps={turn.steps} />
          </div>
        )}

        {/* Completed answer */}
        {turn.status === 'done' && turn.answer && (
          <div data-testid="answer-content">
            {/* Confidence flag — clean by default (high shows nothing); a
                subtle amber "best guess" badge for medium/low confidence.
                Read defensively so older messages without confidence stay
                clean. */}
            {lowConfidence && (
              <div
                data-testid="confidence-badge"
                className="mb-2 inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-400/15 dark:text-amber-300"
                title="This answer is a best guess — verify before acting."
              >
                <span aria-hidden="true">⚠</span> Best guess — verify
              </div>
            )}
            <p className="whitespace-pre-wrap leading-relaxed text-slate-700 dark:text-slate-200">
              {turn.answer.content}
            </p>
            {lowConfidence && (
              <p
                data-testid="low-confidence-note"
                className="mt-1.5 text-[11px] italic text-amber-700 dark:text-amber-300"
              >
                {turn.answer.confidence === 'low'
                  ? 'Low confidence — the question was under-specified, so verify this against the source.'
                  : 'Medium confidence — double-check this before acting on it.'}
              </p>
            )}
            {turn.answer.chart && <AnswerChart spec={turn.answer.chart} />}
            {turn.answer.table && <AnswerTable table={turn.answer.table} />}

            {/* Answer toolbar — Show code + Export (Phase 3, real) */}
            <div
              data-testid="answer-toolbar"
              className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400"
            >
              {/* Pin to dashboard — only on a COMPLETED assistant answer with a
                  real message id. Flips between outline "Pin" and filled
                  "Pinned"; clicking a pinned answer unpins it. */}
              {onTogglePin &&
                turn.answer.message_id &&
                turn.answer.status === 'completed' &&
                (() => {
                  const pinned = Boolean(pinnedTileId)
                  return (
                    <button
                      type="button"
                      data-testid="pin-button"
                      {...(pinned ? { 'data-pinned': 'true' } : {})}
                      aria-pressed={pinned}
                      aria-label={
                        pinned ? 'Unpin from dashboard' : 'Pin to dashboard'
                      }
                      disabled={pinBusy}
                      onClick={() =>
                        onTogglePin(
                          turn.answer!.message_id,
                          pinnedTileId ?? null,
                        )
                      }
                      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                        pinned
                          ? 'border-accent-500 bg-accent-600 text-white shadow-sm hover:bg-accent-700 dark:border-accent-400 dark:bg-accent-500 dark:hover:bg-accent-600'
                          : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      {pinned ? (
                        <span data-testid="pinned">📌 Pinned</span>
                      ) : (
                        <span>📍 Pin to dashboard</span>
                      )}
                    </button>
                  )
                })()}
              {turn.answer.code && (
                <button
                  type="button"
                  data-testid="show-code-toggle"
                  aria-expanded={showCode}
                  onClick={() => setShowCode((v) => !v)}
                  className="inline-flex items-center rounded-md border border-slate-200 px-2.5 py-1 font-medium transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
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
                className="inline-flex items-center rounded-md border border-slate-200 px-2.5 py-1 font-medium transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
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
                className="inline-flex items-center rounded-md border border-slate-200 px-2.5 py-1 font-medium transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exporting === 'png' ? 'Exporting…' : '⬇ Export PNG'}
              </button>
            </div>

            {exportError && (
              <div
                data-testid="export-error"
                role="alert"
                className="mt-2 text-[11px] text-red-600 dark:text-red-400"
              >
                {exportError}
              </div>
            )}

            {/* Collapsible analysis code — hidden (clean) by default */}
            {turn.answer.code && showCode && (
              <pre
                data-testid="code-block"
                className="mt-2.5 max-h-96 overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-3 font-mono text-[12px] leading-relaxed text-slate-100 dark:border-slate-700 dark:bg-slate-950"
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
                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                  Suggested follow-ups
                </span>
                {turn.answer.followups.slice(0, 3).map((q, i) => (
                  <button
                    key={i}
                    type="button"
                    data-testid="followup-chip"
                    disabled={!onFollowup}
                    onClick={() => onFollowup?.(q)}
                    className="rounded-full border border-accent-200 bg-accent-50/60 px-2.5 py-0.5 text-[11px] font-medium text-accent-700 transition hover:bg-accent-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-accent-400/25 dark:bg-accent-500/10 dark:text-accent-200 dark:hover:bg-accent-500/20"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Step trail — collapsed by default, auto-opens when the agent
                retried/self-corrected so those steps stay visible. */}
            <StepTrail steps={turn.steps} />
          </div>
        )}

        {/* Usage / cost line */}
        {turn.usage && (
          <div
            data-testid="usage-line"
            className="mt-3 border-t border-slate-100 pt-2.5 font-mono text-[11px] tabular-nums text-slate-400 dark:border-slate-800 dark:text-slate-500"
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
