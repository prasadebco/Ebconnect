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
      className={`fixed inset-y-0 left-0 z-30 flex w-64 shrink-0 flex-col border-r border-accent-900/40 bg-accent-800 bg-gradient-to-b from-accent-700 to-accent-900 text-white shadow-pop transition-transform duration-200 ease-out md:static md:z-auto md:translate-x-0 md:shadow-none dark:border-black/30 dark:from-accent-800 dark:to-slate-950 ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }`}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/60">
          Library
        </span>
        {datasets.length > 0 && (
          <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-white/15 px-1.5 text-[10px] font-semibold text-white/90">
            {datasets.length}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {loading && datasets.length === 0 ? (
          <div data-testid="library-loading" className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-xl bg-white/10"
              />
            ))}
          </div>
        ) : datasets.length === 0 ? (
          <div
            data-testid="library-empty"
            className="mt-6 px-2 text-center text-xs leading-relaxed text-white/60"
          >
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-lg ring-1 ring-inset ring-white/15">
              📁
            </div>
            Upload a CSV to get started. Your datasets collect here across
            sessions.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {datasets.map((d) => {
              const active = d.id === activeDatasetId
              return (
                <li key={d.id}>
                  <div
                    data-testid="library-item"
                    data-dataset-id={d.id}
                    className={`group relative overflow-hidden rounded-xl ring-1 ring-inset transition-all duration-200 ${
                      active
                        ? 'bg-white/15 ring-white/25 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-brand-500'
                        : 'bg-white/5 ring-white/10 hover:bg-white/10 hover:ring-white/20'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectDataset(d.id)}
                      className="block w-full px-3 py-2.5 pr-8 text-left"
                    >
                      <div
                        className={`truncate text-[13px] font-medium ${
                          active ? 'text-white' : 'text-white/90'
                        }`}
                      >
                        {d.name}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-white/70">
                        <span className="rounded bg-white/10 px-1 py-px font-mono uppercase text-white/70">
                          {kindBadge(d.kind)}
                        </span>
                        <span>{d.row_count.toLocaleString()} rows</span>
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
                      className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md text-white/55 opacity-0 transition hover:bg-red-500/25 hover:text-red-200 focus:opacity-100 group-hover:opacity-100"
                    >
                      🗑
                    </button>

                    {active && (
                      <div className="border-t border-white/15 px-2.5 pb-2 pt-2">
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
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t border-white/10 px-4 py-3 text-[11px] leading-relaxed text-white/70">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" />
        Your data never leaves this server.
      </div>
    </aside>
  )
}
