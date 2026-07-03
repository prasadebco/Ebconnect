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
      className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Library
        </span>
        <span className="text-[11px] text-slate-400">
          {datasets.length > 0 ? datasets.length : ''}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {loading && datasets.length === 0 ? (
          <div data-testid="library-loading" className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-lg bg-slate-100"
              />
            ))}
          </div>
        ) : datasets.length === 0 ? (
          <div
            data-testid="library-empty"
            className="mt-6 px-2 text-center text-xs leading-relaxed text-slate-400"
          >
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 text-lg">
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
                    className={`group relative rounded-lg ring-1 ring-inset transition ${
                      active
                        ? 'bg-accent-50 ring-accent-600/20'
                        : 'bg-white ring-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectDataset(d.id)}
                      className="block w-full px-3 py-2.5 pr-8 text-left"
                    >
                      <div
                        className={`truncate text-[13px] font-medium ${
                          active ? 'text-accent-800' : 'text-slate-800'
                        }`}
                      >
                        {d.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400">
                        <span className="rounded bg-slate-100 px-1 py-px font-mono uppercase text-slate-500">
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
                      className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
                    >
                      🗑
                    </button>

                    {active && (
                      <div className="border-t border-accent-600/10 px-2.5 pb-2 pt-2">
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

      <div className="border-t border-slate-100 px-4 py-3 text-[11px] leading-relaxed text-slate-400">
        Your data never leaves this server.
      </div>
    </aside>
  )
}
