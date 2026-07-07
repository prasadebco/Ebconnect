'use client'

import type { ConversationSummary, DatasetSummary } from '@/lib/types'
import { ConversationList } from './ConversationList'

function kindBadge(kind: string): string {
  return kind?.toUpperCase() || 'CSV'
}

interface Props {
  datasets: DatasetSummary[]
  activeDatasetId: string | null
  conversations: ConversationSummary[]
  activeConversationId: string | null
  loading: boolean
  // Mobile-only: whether the off-canvas drawer is open. Ignored on md+ where
  // the sidebar is permanently docked.
  mobileOpen?: boolean
  onSelectDataset: (id: string) => void
  onDeleteDataset: (id: string, name: string) => void
  onSelectConversation: (id: string) => void
}

// Phase-2: the REAL persistent library. Datasets survive restarts and days;
// clicking one resumes it (profile + active dataset), reveals its past
// conversations, and lets the user reopen a chat or delete the dataset.
export function LibrarySidebar({
  datasets,
  activeDatasetId,
  conversations,
  activeConversationId,
  loading,
  mobileOpen = false,
  onSelectDataset,
  onDeleteDataset,
  onSelectConversation,
}: Props) {
  return (
    <aside
      id="library-sidebar"
      data-testid="library-sidebar"
      // On mobile the sidebar is an off-canvas drawer (fixed, slides in when
      // toggled) so it never squeezes the chat; on md+ it is permanently
      // docked. The DOM (and every test-id inside) is always present — it is
      // only translated off-screen when closed on small viewports.
      className={`fixed inset-y-0 left-0 z-30 flex w-72 shrink-0 flex-col border-r border-accent-900/40 bg-accent-800 bg-gradient-to-b from-accent-700 to-accent-900 text-white shadow-pop transition-transform duration-200 ease-out md:static md:z-auto md:w-80 md:translate-x-0 md:shadow-none dark:border-black/30 dark:from-accent-800 dark:to-slate-950 ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }`}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
          Library
        </span>
        {datasets.length > 0 && (
          <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-white/15 px-1.5 text-[10px] font-semibold text-white/90 ring-1 ring-inset ring-white/15">
            {datasets.length}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading && datasets.length === 0 ? (
          <div data-testid="library-loading" className="space-y-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-2xl bg-white/10"
              />
            ))}
          </div>
        ) : datasets.length === 0 ? (
          <div
            data-testid="library-empty"
            className="mt-8 px-3 text-center text-[13px] leading-relaxed text-white/70"
          >
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-2xl ring-1 ring-inset ring-white/15">
              📁
            </div>
            Upload a CSV to get started. Your datasets collect here across
            sessions.
          </div>
        ) : (
          <div className="space-y-2">
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
              Datasets
            </p>
            <ul className="space-y-2.5">
              {datasets.map((d) => {
                const active = d.id === activeDatasetId
                return (
                  <li key={d.id}>
                    <div
                      data-testid="library-item"
                      data-dataset-id={d.id}
                      className={`group relative overflow-hidden rounded-2xl ring-1 ring-inset transition-all duration-200 ${
                        active
                          ? 'bg-white/[0.16] shadow-lg shadow-accent-950/40 ring-white/30 before:absolute before:inset-y-0 before:left-0 before:z-10 before:w-1.5 before:bg-brand-500 before:shadow-[0_0_12px_theme(colors.brand.500)]'
                          : 'bg-white/[0.06] ring-white/10 hover:-translate-y-px hover:bg-white/[0.11] hover:shadow-lg hover:shadow-accent-950/30 hover:ring-white/25'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectDataset(d.id)}
                        className="block w-full px-4 py-3 pr-9 text-left"
                      >
                        <div
                          className={`truncate text-[13.5px] font-semibold ${
                            active ? 'text-white' : 'text-white/90'
                          }`}
                        >
                          {d.name}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-white/70">
                          <span className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono font-semibold uppercase tracking-wide text-white/80 ring-1 ring-inset ring-white/10">
                            {kindBadge(d.kind)}
                          </span>
                          <span className="tabular-nums">
                            {d.row_count.toLocaleString()} rows
                          </span>
                        </div>
                      </button>

                      <button
                        type="button"
                        data-testid="dataset-delete"
                        data-dataset-id={d.id}
                        title={`Delete ${d.name}`}
                        aria-label={`Delete ${d.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onDeleteDataset(d.id, d.name)
                        }}
                        className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-lg text-white/55 opacity-0 transition hover:bg-red-500/25 hover:text-red-200 focus:opacity-100 group-hover:opacity-100"
                      >
                        🗑
                      </button>

                      {active && (
                        <div className="border-t border-white/15 px-3 pb-3 pt-3">
                          <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
                            Conversations
                          </p>
                          <ConversationList
                            conversations={conversations}
                            activeConversationId={activeConversationId}
                            onSelect={onSelectConversation}
                          />
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-white/10 px-5 py-3.5 text-[11px] leading-relaxed text-white/70">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300 shadow-[0_0_6px_theme(colors.emerald.300)]" />
        Your data never leaves this server.
      </div>
    </aside>
  )
}
