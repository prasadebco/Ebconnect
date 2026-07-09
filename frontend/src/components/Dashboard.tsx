'use client'

import type { DashboardTile as Tile } from '@/lib/types'
import { DashboardTile } from './DashboardTile'

interface Props {
  tiles: Tile[]
  loading: boolean
  error: string | null
  busyTileId: string | null
  onUnpin: (id: string) => void
  onOpenConversation?: (conversationId: string) => void
}

// Phase-6 Dashboard: a responsive premium grid of pinned insights. Rendered
// from stored snapshots — no query re-run, no Gemini call. Empty/loading/error
// states covered; blue-forward Ebco styling, light + dark.
export function Dashboard({
  tiles,
  loading,
  error,
  busyTileId,
  onUnpin,
  onOpenConversation,
}: Props) {
  return (
    <section
      data-testid="dashboard-view"
      aria-label="Dashboard of pinned insights"
      className="min-h-0 flex-1 overflow-y-auto bg-accent-50/40 px-6 py-6 dark:bg-slate-950"
    >
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-5 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-800 dark:text-slate-100">
              Dashboard
            </h2>
            <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">
              Your pinned insights — rendered instantly from saved results, no
              re-run.
            </p>
          </div>
          {tiles.length > 0 && (
            <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-accent-600 px-2 text-[11px] font-semibold text-white dark:bg-accent-500">
              {tiles.length}
            </span>
          )}
        </header>

        {error && (
          <div
            data-testid="dashboard-error"
            role="alert"
            className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
          >
            {error}
          </div>
        )}

        {loading && tiles.length === 0 ? (
          <div
            data-testid="dashboard-loading"
            className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3"
          >
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white/70 dark:border-slate-800 dark:bg-slate-900/60"
              />
            ))}
          </div>
        ) : tiles.length === 0 ? (
          <div
            data-testid="dashboard-empty"
            className="mx-auto mt-16 max-w-md rounded-2xl border border-dashed border-slate-300 bg-white/60 px-8 py-14 text-center dark:border-slate-700 dark:bg-slate-900/50"
          >
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-100 text-3xl ring-1 ring-inset ring-accent-200 dark:bg-accent-500/10 dark:ring-accent-400/20">
              📌
            </div>
            <p className="text-[15px] font-semibold text-slate-700 dark:text-slate-200">
              No pinned insights yet
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
              Pin an answer from the Analyze view to build your dashboard.
            </p>
          </div>
        ) : (
          <div
            data-testid="dashboard-grid"
            className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3"
          >
            {tiles.map((t) => (
              <DashboardTile
                key={t.id}
                tile={t}
                busy={busyTileId === t.id}
                onUnpin={onUnpin}
                onOpenConversation={onOpenConversation}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
