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
import { useIsDark } from '@/lib/theme'

// EBCO brand-led multi-series palette. Leads with Ebco Blue #003DA5 (so
// single-series charts render in the brand primary), pairs it with Ebco
// Orange #F47920 as the standout highlight, then alternates blue tints with
// harmonious supporting hues (teal, muted gold, slate, rust) so every
// adjacent series has strong contrast and stays legible on the white card.
const COLORS = [
  '#003da5', // Ebco Blue — brand primary (single-series lead)
  '#f47920', // Ebco Orange — standout highlight
  '#3f74c4', // mid blue tint
  '#0ea5a5', // teal
  '#e0a32e', // muted gold
  '#7ba1d9', // light blue tint
  '#64748b', // slate-500
  '#b34f13', // deep rust orange
]

// Theme-aware chart chrome. Charts must stay legible in BOTH themes, so axis,
// tick, grid and tooltip colours are resolved from the active theme at render.
function chartTheme(dark: boolean) {
  const AXIS_COLOR = dark ? '#64748b' : '#94a3b8' // slate-500 / slate-400
  const TICK_COLOR = dark ? '#cbd5e1' : '#475569' // slate-300 / slate-600
  const GRID_COLOR = dark ? '#334155' : '#e2e8f0' // slate-700 / slate-200
  const PIE_STROKE = dark ? '#0f172a' : '#ffffff' // slate-900 / white
  return {
    AXIS_COLOR,
    TICK_COLOR,
    GRID_COLOR,
    PIE_STROKE,
    tickStyle: { fontSize: 11, fill: TICK_COLOR },
    legendStyle: { fontSize: 12, paddingTop: 8, color: TICK_COLOR },
    tooltipStyle: {
      contentStyle: {
        borderRadius: 10,
        border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
        background: dark ? '#1e293b' : '#ffffff',
        boxShadow: dark
          ? '0 8px 24px -8px rgba(0,0,0,0.6)'
          : '0 8px 24px -8px rgba(15,23,42,0.25)',
        fontSize: 12,
        padding: '8px 12px',
      },
      labelStyle: {
        color: dark ? '#f1f5f9' : '#0f172a',
        fontWeight: 600,
        marginBottom: 4,
      },
      itemStyle: { color: dark ? '#cbd5e1' : '#334155', padding: 0 },
      cursor: { fill: dark ? 'rgba(63,116,196,0.14)' : 'rgba(0,61,165,0.06)' },
    },
  }
}

// Give room for rotated x labels + a left y-axis label.
const CARTESIAN_MARGIN = { top: 12, right: 20, bottom: 28, left: 12 }

export function AnswerChart({ spec }: { spec: ChartSpec }) {
  const dark = useIsDark()
  const { AXIS_COLOR, TICK_COLOR, GRID_COLOR, PIE_STROKE, tickStyle, legendStyle, tooltipStyle } =
    chartTheme(dark)
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
      className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      {spec.title && (
        <div className="mb-3 text-[13px] font-semibold tracking-tight text-slate-800 dark:text-slate-100">
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
                stroke={PIE_STROKE}
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
