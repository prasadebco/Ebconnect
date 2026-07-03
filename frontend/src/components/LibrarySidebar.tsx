'use client'

import type { Dataset } from '@/lib/types'
import { ComingSoonBadge } from './ComingSoon'

// Phase-1 STUB library sidebar. The current dataset is shown as the single
// real entry; the full persistent-library experience (switch across days,
// delete, conversation history) is Phase 2 and is rendered greyed + labelled.
export function LibrarySidebar({ current }: { current: Dataset | null }) {
  return (
    <aside
      data-testid="library-sidebar"
      className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4 md:flex"
    >
      <div className="flex items-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Library
        <ComingSoonBadge label="P2" />
      </div>

      <div className="mt-3 space-y-1">
        {current ? (
          <div className="rounded-lg bg-accent-50 px-3 py-2.5 text-sm font-medium text-accent-800 ring-1 ring-inset ring-accent-600/10">
            {current.name}
            <div className="mt-0.5 text-[11px] font-normal text-accent-500">
              {current.row_count.toLocaleString()} rows
            </div>
          </div>
        ) : (
          <p className="px-1 text-xs leading-relaxed text-slate-400">
            Uploaded datasets will collect here across sessions.
          </p>
        )}
      </div>

      <div
        aria-disabled
        className="mt-4 space-y-2 opacity-50"
        title="Coming soon — a persistent library across days"
      >
        <div className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400">
          Yesterday · sales_q1.csv
        </div>
        <div className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-400">
          Conversations history
        </div>
      </div>

      <div className="mt-auto pt-4 text-[11px] leading-relaxed text-slate-400">
        Your data never leaves this server.
      </div>
    </aside>
  )
}
