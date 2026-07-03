// API contract types — mirror spec/api.md exactly.

export interface DatasetColumn {
  name: string
  dtype: string
  null_count: number
  distinct_count?: number
  min_value?: string
  max_value?: string
  samples?: string[]
}

export interface DatasetSheet {
  name: string
  row_count: number
}

export interface Dataset {
  id: string
  name: string
  kind: string
  row_count: number
  sheets: DatasetSheet[]
  columns: DatasetColumn[]
}

export interface Conversation {
  id: string
  primary_dataset_id: string
  title: string
}

// SSE event payloads
export interface StepEvent {
  label: string
}

export interface UsageEvent {
  prompt: number
  completion: number
  total: number
  cost_usd: number
  elapsed_ms: number
}

export interface ChartSpec {
  // Flexible chart spec from the backend.
  type?: 'bar' | 'line' | 'area' | 'pie' | string
  x?: string
  y?: string | string[]
  series?: string[]
  data?: Record<string, unknown>[]
  title?: string
}

export interface TableSpec {
  columns: string[]
  rows: Record<string, string | number | null>[]
}

export type AnswerStatus = 'completed' | 'needs_clarification' | 'failed'

export interface AnswerEvent {
  message_id: string
  content: string
  chart?: ChartSpec | null
  table?: TableSpec | null
  code?: string | null
  followups?: string[]
  confidence?: 'high' | 'medium' | 'low' | string
  status: AnswerStatus
}

export interface ErrorEvent {
  message: string
}

export type StreamEvent =
  | { type: 'step'; data: StepEvent }
  | { type: 'usage'; data: UsageEvent }
  | { type: 'answer'; data: AnswerEvent }
  | { type: 'error'; data: ErrorEvent }
