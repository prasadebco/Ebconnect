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

// Accent-led series palette: indigo leads, supporting hues stay muted so a
// single-series chart reads as "on brand" and multi-series stays legible.
const COLORS = [
  '#4f46e5', // accent-600
  '#0ea5e9', // sky-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
]

const AXIS_COLOR = '#94a3b8' // slate-400
const TICK_COLOR = '#475569' // slate-600
const GRID_COLOR = '#e2e8f0' // slate-200

const tickStyle = { fontSize: 11, fill: TICK_COLOR }

const tooltipStyle = {
  contentStyle: {
    borderRadius: 10,
    border: '1px solid #e2e8f0',
    boxShadow: '0 8px 24px -8px rgba(15,23,42,0.25)',
    fontSize: 12,
    padding: '8px 12px',
  },
  labelStyle: { color: '#0f172a', fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: '#334155', padding: 0 },
  cursor: { fill: 'rgba(79,70,229,0.06)' },
}

const legendStyle = { fontSize: 12, paddingTop: 8, color: TICK_COLOR }

// Give room for rotated x labels + a left y-axis label.
const CARTESIAN_MARGIN = { top: 12, right: 20, bottom: 28, left: 12 }

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
  const yLabel = ySeries.length === 1 ? ySeries[0] : undefined

  return (
    <div
      data-testid="answer-chart"
      className="mt-4 rounded-xl border border-slate-200 bg-white p-4"
    >
      {spec.title && (
        <div className="mb-3 text-[13px] font-semibold tracking-tight text-slate-800">
          {spec.title}
        </div>
      )}
      <div className="h-80 min-h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {type === 'line' ? (
            <LineChart data={data} margin={CARTESIAN_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
              <XAxis dataKey={x} tick={tickStyle} tickLine={false} axisLine={{ stroke: GRID_COLOR }} tickMargin={8} />
              <YAxis
                tick={tickStyle}
                tickLine={false}
                axisLine={false}
                width={56}
                label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: AXIS_COLOR, textAnchor: 'middle' } } : undefined}
              />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
              {ySeries.map((s, i) => (
                <Line key={s} type="monotone" dataKey={s} stroke={COLORS[i % COLORS.length]} strokeWidth={2.5} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
              ))}
            </LineChart>
          ) : type === 'area' ? (
            <AreaChart data={data} margin={CARTESIAN_MARGIN}>
              <defs>
                {ySeries.map((s, i) => (
                  <linearGradient key={s} id={`area-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
              <XAxis dataKey={x} tick={tickStyle} tickLine={false} axisLine={{ stroke: GRID_COLOR }} tickMargin={8} />
              <YAxis
                tick={tickStyle}
                tickLine={false}
                axisLine={false}
                width={56}
                label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: AXIS_COLOR, textAnchor: 'middle' } } : undefined}
              />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
              {ySeries.map((s, i) => (
                <Area key={s} type="monotone" dataKey={s} stroke={COLORS[i % COLORS.length]} strokeWidth={2} fill={`url(#area-${i})`} />
              ))}
            </AreaChart>
          ) : type === 'pie' ? (
            <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
              <Pie
                data={data}
                dataKey={ySeries[0]}
                nameKey={x}
                outerRadius={100}
                innerRadius={48}
                paddingAngle={2}
                stroke="#ffffff"
                strokeWidth={2}
                label={{ fontSize: 11, fill: TICK_COLOR }}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : (
            <BarChart data={data} margin={CARTESIAN_MARGIN} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
              <XAxis dataKey={x} tick={tickStyle} tickLine={false} axisLine={{ stroke: GRID_COLOR }} tickMargin={8} interval={0} />
              <YAxis
                tick={tickStyle}
                tickLine={false}
                axisLine={false}
                width={56}
                label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: AXIS_COLOR, textAnchor: 'middle' } } : undefined}
              />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={legendStyle} />
              {ySeries.map((s, i) => (
                <Bar key={s} dataKey={s} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} maxBarSize={64} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}
