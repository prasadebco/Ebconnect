'use client'

import type { TableSpec } from '@/lib/types'

export function AnswerTable({ table }: { table: TableSpec }) {
  if (!table.columns?.length) return null
  return (
    <div data-testid="answer-table" className="mt-3 overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-xs">
        <thead className="bg-gray-50">
          <tr>
            {table.columns.map((c) => (
              <th
                key={c}
                className="px-3 py-2 text-left font-semibold text-gray-600"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {table.rows.slice(0, 50).map((row, i) => (
            <tr key={i} className={i % 2 ? 'bg-gray-50/50' : ''}>
              {table.columns.map((c) => {
                const cell = row[c]
                return (
                  <td key={c} className="px-3 py-1.5 text-gray-700">
                    {cell === null || cell === undefined ? '—' : String(cell)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
