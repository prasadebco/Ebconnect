'use client'

import type { DashboardTile as Tile } from '@/lib/types'
import { AnswerChart } from './AnswerChart'
import { AnswerTable } from './AnswerTable'

function fmtWhen(iso?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

interface Props {
  tile: Tile
  busy?: boolean
  onUnpin: (id: string) => void
  // Nice-to-have deep-link back to the source conversation.
  onOpenConversation?: (conversationId: string) => void
}

// A single pinned insight, rendered entirely from the snapshot (prose + chart
// + compact table + context). NEVER re-runs the query / calls Gemini.
export function DashboardTile({ tile, busy, onUnpin, onOpenConversation }: Props) {
  const when = fmtWhen(tile.created_at)
  const conf = tile.confidence
  const lowConfidence = conf === 'low' || conf === 'medium'

  // Cap the table for a compact tile view.
  const compactTable =
    tile.table && tile.table.columns?.length
      ? { ...tile.table, rows: (tile.table.rows ?? []).slice(0, 6) }
      : null

  return (
    <article
      data-testid="dashboard-tile"
      data-tile-id={tile.id}
      className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card ring-1 ring-slate-900/[0.02] transition hover:shadow-pop dark:border-slate-800 dark:bg-slate-900 dark:ring-white/[0.03]"
    >
      {/* Header — title/question + dataset + timestamp + unpin. */}
      <div className="flex items-start gap-3 border-b border-slate-100 bg-gradient-to-r from-accent-50/70 to-transparent px-4 py-3 dark:border-slate-800 dark:from-accent-500/10">
        <div className="min-w-0 flex-1">
          <h3
            className="truncate text-[14px] font-semibold tracking-tight text-slate-800 dark:text-slate-100"
            title={tile.title}
          >
            {tile.title || 'Pinned insight'}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            {tile.dataset_name && (
              <span className="inline-flex items-center gap-1 rounded-md bg-accent-100/70 px-1.5 py-0.5 font-medium text-accent-700 dark:bg-accent-500/15 dark:text-accent-200">
                📄 {tile.dataset_name}
              </span>
            )}
            {when && <span className="tabular-nums">{when}</span>}
          </div>
        </div>
        <button
          type="button"
          data-testid="tile-unpin"
          data-tile-id={tile.id}
          aria-label="Unpin from dashboard"
          title="Unpin from dashboard"
          disabled={busy}
          onClick={() => onUnpin(tile.id)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-500/10 hover:text-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-500 dark:hover:text-red-400"
        >
          ✕
        </button>
      </div>

      {/* Body — prose + chart + compact table. */}
      <div className="min-w-0 flex-1 px-4 py-3.5">
        {lowConfidence && (
          <div className="mb-2 inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
            <span aria-hidden="true">⚠</span> Best guess
          </div>
        )}
        {tile.content && (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">
            {tile.content}
          </p>
        )}
        {tile.chart && <AnswerChart spec={tile.chart} />}
        {compactTable && <AnswerTable table={compactTable} />}
      </div>

      {onOpenConversation && tile.conversation_id && (
        <div className="border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">
          <button
            type="button"
            data-testid="tile-open"
            onClick={() => onOpenConversation(tile.conversation_id)}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-accent-600 transition hover:text-accent-700 focus:outline-none focus-visible:underline dark:text-accent-300 dark:hover:text-accent-200"
          >
            Open conversation →
          </button>
        </div>
      )}
    </article>
  )
}
