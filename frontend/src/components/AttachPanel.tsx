'use client'

import { useRef, useState } from 'react'
import type { DatasetSummary, Frame } from '@/lib/types'

interface Props {
  primaryName: string
  primaryDatasetId: string
  frames: Frame[]
  library: DatasetSummary[]
  disabled: boolean
  error?: string | null
  onAttachExisting: (datasetId: string, alias: string) => void
  onUploadAndAttach: (file: File, alias: string) => void
}

// Turn a file / dataset name into a sensible, editable frame alias:
// "Orders 2025.csv" → "orders_2025".
export function aliasFromName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, '')
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || 'frame'
}

// Phase-3: attach additional datasets to the current conversation so questions
// can join across files. Shows the live frame list and an "Add file" control
// that either attaches an existing library dataset or uploads a new one.
export function AttachPanel({
  primaryName,
  primaryDatasetId,
  frames,
  library,
  disabled,
  error,
  onAttachExisting,
  onUploadAndAttach,
}: Props) {
  const [open, setOpen] = useState(false)
  const [aliases, setAliases] = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const attachedIds = new Set(frames.map((f) => f.dataset_id))
  const candidates = library.filter(
    (d) => d.id !== primaryDatasetId && !attachedIds.has(d.id),
  )

  function aliasFor(d: DatasetSummary): string {
    return aliases[d.id] ?? aliasFromName(d.name)
  }

  return (
    <div className="mb-4">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Files in this chat
      </div>

      <ul data-testid="frame-list" className="space-y-1.5">
        <li
          data-testid="frame-item"
          data-frame-alias={aliasFromName(primaryName)}
          className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs ring-1 ring-inset ring-slate-900/[0.04] dark:bg-slate-800/50 dark:ring-white/[0.04]"
        >
          <span className="min-w-0 truncate font-medium text-slate-800 dark:text-slate-200">
            {primaryName}
          </span>
          <span className="shrink-0 rounded bg-accent-50 px-1.5 py-0.5 font-mono text-[10px] text-accent-600 dark:bg-accent-500/15 dark:text-accent-300">
            primary
          </span>
        </li>
        {frames.map((f) => (
          <li
            key={f.dataset_id + f.frame_alias}
            data-testid="frame-item"
            data-frame-alias={f.frame_alias}
            className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700"
          >
            <span className="min-w-0 truncate font-medium text-slate-800 dark:text-slate-200">
              {f.dataset_name ?? f.name ?? f.frame_alias}
            </span>
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {f.frame_alias}
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        data-testid="add-file"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 transition hover:border-accent-400 hover:bg-accent-50/40 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-accent-400 dark:hover:bg-accent-500/10"
      >
        + Add another file
      </button>

      {open && (
        <div
          data-testid="attach-picker"
          className="mt-2 rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-800/50"
        >
          {candidates.length === 0 ? (
            <p className="px-1 py-1 text-[11px] text-slate-400 dark:text-slate-500">
              No other datasets in your library — upload a new file to join.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {candidates.map((d) => (
                <li key={d.id} className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12px] text-slate-700 dark:text-slate-300">
                    {d.name}
                  </span>
                  <input
                    aria-label={`Alias for ${d.name}`}
                    value={aliasFor(d)}
                    onChange={(e) =>
                      setAliases((a) => ({ ...a, [d.id]: e.target.value }))
                    }
                    className="w-24 shrink-0 rounded-md border border-slate-300 bg-white px-1.5 py-1 font-mono text-[11px] text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    data-testid="attach-dataset"
                    data-dataset-id={d.id}
                    disabled={disabled || !aliasFor(d).trim()}
                    onClick={() => {
                      onAttachExisting(d.id, aliasFor(d).trim())
                      setOpen(false)
                    }}
                    className="shrink-0 rounded-md bg-accent-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-accent-700 disabled:opacity-50 dark:bg-accent-500 dark:hover:bg-accent-400"
                  >
                    Attach
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-700">
            <input
              ref={fileRef}
              data-testid="attach-file-input"
              type="file"
              accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) {
                  onUploadAndAttach(file, aliasFromName(file.name))
                  setOpen(false)
                }
                e.target.value = ''
              }}
            />
            <button
              type="button"
              data-testid="attach-upload"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
              className="inline-flex w-full items-center justify-center rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Upload a new file to join
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          data-testid="attach-error"
          className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
        >
          {error}
        </div>
      )}
    </div>
  )
}
