'use client'

import { useState } from 'react'

// A step label is a "retry" step when the agent self-corrects — it changed
// approach or is re-attempting after a failed run. Detected loosely so any
// backend phrasing ("Retrying…", "attempt 2", "new approach") is marked.
export function isRetryStep(label: string): boolean {
  return /\bretry(ing)?\b|\battempt\b|new approach|self-correct/i.test(label)
}

function StepItem({ label }: { label: string }) {
  const retry = isRetryStep(label)
  return (
    <li
      data-testid={retry ? 'retry-step' : 'step-item'}
      className={`flex items-start gap-1.5 ${
        retry ? 'font-medium text-amber-600' : 'text-slate-400'
      }`}
    >
      <span className={retry ? 'text-amber-500' : 'text-emerald-500'}>
        {retry ? '↻' : '✓'}
      </span>
      <span>{label}</span>
    </li>
  )
}

// Live step list shown while a query is in flight (retry steps highlighted so
// the user watches the agent self-correct in real time).
export function LiveSteps({ steps }: { steps: string[] }) {
  return (
    <ol data-testid="step-list" className="ml-1 space-y-1 text-xs">
      {steps.map((s, i) => (
        <StepItem key={i} label={s} />
      ))}
    </ol>
  )
}

// After a turn completes, keep the step trail available (collapsed by default
// so it never clutters the clean answer) — but auto-open when a retry happened
// so the self-correction stays visible.
export function StepTrail({ steps }: { steps: string[] }) {
  const hadRetry = steps.some(isRetryStep)
  const [open, setOpen] = useState(hadRetry)
  if (steps.length === 0) return null

  return (
    <div
      data-testid="step-trail"
      className="mt-3 border-t border-slate-100 pt-2.5"
    >
      <button
        type="button"
        data-testid="steps-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 transition hover:text-slate-600"
      >
        <span>{open ? '▾' : '▸'}</span>
        {open ? 'Hide steps' : `Show steps (${steps.length})`}
        {hadRetry && (
          <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
            self-corrected
          </span>
        )}
      </button>
      {open && (
        <ol className="ml-1 mt-2 space-y-1 text-xs">
          {steps.map((s, i) => (
            <StepItem key={i} label={s} />
          ))}
        </ol>
      )}
    </div>
  )
}
