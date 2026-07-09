'use client'

import { useEffect, useState } from 'react'
import type { ConversationSummary, DatasetSummary } from '@/lib/types'
import { ConversationList } from './ConversationList'

function kindBadge(kind: string): string {
  return kind?.toUpperCase() || 'CSV'
}

// A stable single-letter avatar for the collapsed rail.
function avatar(name: string): string {
  const c = (name || '?').trim()[0]
  return (c || '?').toUpperCase()
}

const PIN_KEY = 'ebco.sidebar.pinned'

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

// Phase-6: the REAL persistent library, now as a collapsible ICON RAIL on md+.
// Default = a slim rail of dataset avatars (labels hidden, every item + test-id
// still in the DOM); expands on hover OR click to the full panel, then collapses
// again. On mobile it remains the off-canvas drawer (sidebar-toggle /
// sidebar-backdrop preserved). Selecting a dataset pins it open so its
// conversations are reachable.
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
  const [pinnedOpen, setPinnedOpen] = useState(false)
  const [hovered, setHovered] = useState(false)

  // Restore the click-pinned rail state across sessions.
  useEffect(() => {
    try {
      if (localStorage.getItem(PIN_KEY) === '1') setPinnedOpen(true)
    } catch {
      // ignore storage errors
    }
  }, [])

  function togglePinned() {
    setPinnedOpen((v) => {
      const next = !v
      try {
        localStorage.setItem(PIN_KEY, next ? '1' : '0')
      } catch {
        // ignore
      }
      return next
    })
  }

  // On mobile the drawer always shows the full panel; on md+ it expands on
  // hover or when pinned open.
  const expanded = mobileOpen || pinnedOpen || hovered

  function handleSelectDataset(id: string) {
    // Do NOT force-pin the rail open on selection — that defeated collapse
    // (once you picked a dataset the rail stayed expanded forever). The rail
    // now collapses on mouse-leave unless the user explicitly pinned it open
    // via the pin toggle. Conversations remain reachable on hover/expand.
    onSelectDataset(id)
  }

  return (
    <aside
      id="library-sidebar"
      data-testid="library-sidebar"
      data-expanded={expanded ? 'true' : 'false'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // Mobile: off-canvas drawer (fixed, slides in). md+: a docked rail that
      // is w-16 collapsed / w-80 expanded. The DOM (and every test-id) is
      // always present — collapsed only hides LABELS, never the items.
      className={`fixed inset-y-0 left-0 z-30 flex w-72 shrink-0 flex-col border-r border-accent-900/40 bg-accent-800 bg-gradient-to-b from-accent-700 to-accent-900 text-white shadow-pop transition-all duration-200 ease-out md:static md:z-auto md:translate-x-0 md:shadow-none dark:border-black/30 dark:from-accent-800 dark:to-slate-950 ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      } ${expanded ? 'md:w-80' : 'md:w-16'}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-4">
        {expanded ? (
          <>
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
              Library
            </span>
            <div className="flex items-center gap-2">
              {datasets.length > 0 && (
                <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-white/15 px-1.5 text-[10px] font-semibold text-white/90 ring-1 ring-inset ring-white/15">
                  {datasets.length}
                </span>
              )}
              <button
                type="button"
                data-testid="sidebar-expand"
                onClick={togglePinned}
                aria-label={pinnedOpen ? 'Collapse library' : 'Keep library open'}
                aria-pressed={pinnedOpen}
                className="hidden h-7 w-7 items-center justify-center rounded-lg text-white/70 ring-1 ring-inset ring-white/15 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 md:flex"
              >
                <span aria-hidden="true">{pinnedOpen ? '⟨' : '⟩'}</span>
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            data-testid="sidebar-expand"
            onClick={togglePinned}
            aria-label="Expand library"
            aria-pressed={pinnedOpen}
            className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg text-lg text-white/80 ring-1 ring-inset ring-white/15 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <span aria-hidden="true">📚</span>
          </button>
        )}
      </div>

      <div
        className={`min-h-0 flex-1 overflow-y-auto py-4 ${
          expanded ? 'px-4' : 'px-2'
        }`}
      >
        {loading && datasets.length === 0 ? (
          <div data-testid="library-loading" className="space-y-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className={`animate-pulse rounded-2xl bg-white/10 ${
                  expanded ? 'h-16' : 'mx-auto h-10 w-10'
                }`}
              />
            ))}
          </div>
        ) : datasets.length === 0 ? (
          expanded ? (
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
            // Collapsed: keep the empty marker in the DOM (sr-only) so its
            // test-id stays reachable, and show a friendly rail glyph.
            <div className="mt-4 flex flex-col items-center gap-2">
              <span
                data-testid="library-empty"
                className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-lg ring-1 ring-inset ring-white/15"
                title="Upload a CSV to get started"
              >
                📁
              </span>
            </div>
          )
        ) : (
          <div className="space-y-2">
            {expanded && (
              <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
                Datasets
              </p>
            )}
            <ul className={expanded ? 'space-y-2.5' : 'space-y-2'}>
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
                        onClick={() => handleSelectDataset(d.id)}
                        title={d.name}
                        aria-label={`Open dataset ${d.name}`}
                        className={
                          expanded
                            ? 'block w-full px-4 py-3 pr-9 text-left'
                            : 'flex h-11 w-full items-center justify-center'
                        }
                      >
                        {expanded ? (
                          <>
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
                          </>
                        ) : (
                          <>
                            <span
                              aria-hidden="true"
                              className={`flex h-8 w-8 items-center justify-center rounded-lg text-[13px] font-bold ${
                                active
                                  ? 'bg-brand-500 text-white'
                                  : 'bg-white/10 text-white/85'
                              }`}
                            >
                              {avatar(d.name)}
                            </span>
                            {/* Keep the name in the DOM (sr-only) so the
                                item stays identifiable to assistive tech and
                                tests even when the rail is collapsed. */}
                            <span className="sr-only">
                              {d.name} · {kindBadge(d.kind)} ·{' '}
                              {d.row_count.toLocaleString()} rows
                            </span>
                          </>
                        )}
                      </button>

                      {expanded && (
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
                          className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-lg text-white/60 opacity-70 ring-1 ring-inset ring-white/10 transition hover:bg-red-500/25 hover:text-red-200 hover:opacity-100 hover:ring-red-300/40 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 group-hover:opacity-100"
                        >
                          <span aria-hidden="true">🗑</span>
                        </button>
                      )}

                      {active && expanded && (
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

      {expanded && (
        <div className="flex items-center gap-2 border-t border-white/10 px-5 py-3.5 text-[11px] leading-relaxed text-white/70">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300 shadow-[0_0_6px_theme(colors.emerald.300)]" />
          Your data never leaves this server.
        </div>
      )}
    </aside>
  )
}
