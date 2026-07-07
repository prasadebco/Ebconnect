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
  onSelectDataset,
  onDeleteDataset,
  onSelectConversation,
}: Props) {
  return (
    <aside
      data-testid="library-sidebar"
      className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5 dark:border-slate-800">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Library
        </span>
        {datasets.length > 0 && (
          <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
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
                className="h-12 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800"
              />
            ))}
          </div>
        ) : datasets.length === 0 ? (
          <div
            data-testid="library-empty"
            className="mt-6 px-2 text-center text-xs leading-relaxed text-slate-400 dark:text-slate-500"
          >
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-50 text-lg ring-1 ring-inset ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
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
                        ? 'bg-accent-50 ring-accent-600/20 before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-brand-500 dark:bg-accent-500/10 dark:ring-accent-400/25'
                        : 'bg-white ring-slate-200 hover:bg-slate-50 hover:ring-slate-300 hover:shadow-sm dark:bg-slate-900 dark:ring-slate-800 dark:hover:bg-slate-800/60 dark:hover:ring-slate-700'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectDataset(d.id)}
                      className="block w-full px-3 py-2.5 pr-8 text-left"
                    >
                      <div
                        className={`truncate text-[13px] font-medium ${
                          active
                            ? 'text-accent-800 dark:text-accent-200'
                            : 'text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        {d.name}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
                        <span className="rounded bg-slate-100 px-1 py-px font-mono uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
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
                      className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 focus:opacity-100 group-hover:opacity-100 dark:text-slate-600 dark:hover:bg-red-500/15 dark:hover:text-red-400"
                    >
                      🗑
                    </button>

                    {active && (
                      <div className="border-t border-accent-600/10 px-2.5 pb-2 pt-2 dark:border-accent-400/15">
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

      <div className="flex items-center gap-1.5 border-t border-slate-100 px-4 py-3 text-[11px] leading-relaxed text-slate-400 dark:border-slate-800 dark:text-slate-500">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
        Your data never leaves this server.
      </div>
    </aside>
  )
}
