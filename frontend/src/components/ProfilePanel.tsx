'use client'

import type { Dataset } from '@/lib/types'
import { ComingSoonBadge } from './ComingSoon'

export function ProfilePanel({
  dataset,
  loading,
}: {
  dataset: Dataset | null
  loading: boolean
}) {
  return (
    <aside
      data-testid="profile-panel"
      className="hidden w-80 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white p-5 lg:flex"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Data profile
        </h3>
        <span className="inline-flex items-center text-[11px] text-slate-400">
          Sheets
          <ComingSoonBadge label="P3" />
        </span>
      </div>

      {loading && (
        <div data-testid="profile-skeleton" className="mt-4 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      )}

      {!loading && !dataset && (
        <p className="mt-6 text-sm leading-relaxed text-slate-400">
          Upload a dataset to see its columns, types, and ranges here.
        </p>
      )}

      {!loading && dataset && (
        <div className="mt-4">
          <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-inset ring-slate-900/[0.04]">
            <div className="truncate text-sm font-semibold text-slate-800">
              {dataset.name}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {dataset.row_count.toLocaleString()} rows ·{' '}
              {dataset.columns.length} columns · {dataset.kind}
            </div>
          </div>

          <ul data-testid="column-list" className="mt-4 space-y-2">
            {dataset.columns.map((c) => (
              <li
                key={c.name}
                className="rounded-lg border border-slate-200 p-2.5 text-xs transition-colors hover:border-slate-300"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-slate-800">{c.name}</span>
                  <span className="shrink-0 rounded-md bg-accent-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-accent-600">
                    {c.dtype}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                  <span>{c.null_count} null</span>
                  {typeof c.distinct_count === 'number' && (
                    <span>{c.distinct_count} distinct</span>
                  )}
                  {c.min_value !== undefined && (
                    <span>
                      min {c.min_value} · max {c.max_value}
                    </span>
                  )}
                </div>
                {c.samples && c.samples.length > 0 && (
                  <div className="mt-1 truncate text-[11px] text-slate-400">
                    e.g. {c.samples.slice(0, 4).join(', ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}
