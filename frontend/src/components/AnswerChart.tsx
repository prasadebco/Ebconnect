'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartSpec } from '@/lib/types'

const COLORS = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
]

export function AnswerChart({ spec }: { spec: ChartSpec }) {
  const data = spec.data ?? []
  if (data.length === 0) return null

  const x = spec.x ?? Object.keys(data[0])[0]
  const ySeries: string[] = spec.series?.length
    ? spec.series
    : Array.isArray(spec.y)
      ? spec.y
      : spec.y
        ? [spec.y]
        : Object.keys(data[0]).filter((k) => k !== x)

  const type = (spec.type ?? 'bar').toLowerCase()

  return (
    <div data-testid="answer-chart" className="mt-3 h-72 w-full">
      {spec.title && (
        <div className="mb-1 text-xs font-medium text-gray-600">
          {spec.title}
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        {type === 'line' ? (
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey={x} fontSize={11} />
            <YAxis fontSize={11} />
            <Tooltip />
            <Legend />
            {ySeries.map((s, i) => (
              <Line key={s} type="monotone" dataKey={s} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        ) : type === 'area' ? (
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey={x} fontSize={11} />
            <YAxis fontSize={11} />
            <Tooltip />
            <Legend />
            {ySeries.map((s, i) => (
              <Area key={s} type="monotone" dataKey={s} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.2} />
            ))}
          </AreaChart>
        ) : type === 'pie' ? (
          <PieChart>
            <Tooltip />
            <Legend />
            <Pie data={data} dataKey={ySeries[0]} nameKey={x} outerRadius={90} label>
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey={x} fontSize={11} />
            <YAxis fontSize={11} />
            <Tooltip />
            <Legend />
            {ySeries.map((s, i) => (
              <Bar key={s} dataKey={s} fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
