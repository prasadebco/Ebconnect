'use client'

import type { DatasetSheet } from '@/lib/types'

interface Props {
  sheets: DatasetSheet[]
  selected: string | null
  onSelect: (name: string) => void
}

function label(name: string): string {
  return name === '__default__' ? 'Sheet 1' : name
}

// Phase-3: multi-sheet Excel picker. Selecting a sheet drives which columns
// the profile panel shows and which `sheet_name` is sent on the next query.
export function SheetPicker({ sheets, selected, onSelect }: Props) {
  if (sheets.length <= 1) return null

  return (
    <div data-testid="sheet-picker" className="mb-4">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Sheet
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sheets.map((s) => {
          const active = s.name === selected
          return (
            <button
              key={s.name}
              type="button"
              data-testid="sheet-option"
              data-sheet-name={s.name}
              aria-pressed={active}
              onClick={() => onSelect(s.name)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset transition ${
                active
                  ? 'bg-accent-50 text-accent-800 ring-accent-600/30 dark:bg-accent-500/15 dark:text-accent-200 dark:ring-accent-400/30'
                  : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700'
              }`}
            >
              <span className="truncate max-w-[8rem]">{label(s.name)}</span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {s.row_count.toLocaleString()}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
