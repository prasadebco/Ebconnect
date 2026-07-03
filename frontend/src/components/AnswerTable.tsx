'use client'

import type { TableSpec } from '@/lib/types'

function isNumeric(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v)
  if (typeof v === 'string' && v.trim() !== '') return !Number.isNaN(Number(v))
  return false
}

export function AnswerTable({ table }: { table: TableSpec }) {
  if (!table.columns?.length) return null

  const rows = table.rows.slice(0, 50)

  // A column is numeric when every present value parses as a number — those
  // get right-aligned + tabular figures so digits line up down the column.
  const numericCols = new Set(
    table.columns.filter((c) => {
      const vals = rows
        .map((r) => r[c])
        .filter((v) => v !== null && v !== undefined && v !== '')
      return vals.length > 0 && vals.every(isNumeric)
    }),
  )

  return (
    <div
      data-testid="answer-table"
      className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white"
    >
      <table className="min-w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {table.columns.map((c) => (
              <th
                key={c}
                className={`whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${
                  numericCols.has(c) ? 'text-right' : 'text-left'
                }`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={`border-b border-slate-100 transition-colors last:border-0 hover:bg-accent-50/50 ${
                i % 2 ? 'bg-slate-50/60' : 'bg-white'
              }`}
            >
              {table.columns.map((c) => {
                const cell = row[c]
                const num = numericCols.has(c)
                return (
                  <td
                    key={c}
                    className={`whitespace-nowrap px-4 py-2 text-slate-700 ${
                      num ? 'text-right font-mono tabular-nums' : 'text-left'
                    }`}
                  >
                    {cell === null || cell === undefined || cell === ''
                      ? '—'
                      : String(cell)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {table.rows.length > rows.length && (
        <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
          Showing first {rows.length} of {table.rows.length.toLocaleString()} rows
        </div>
      )}
    </div>
  )
}
