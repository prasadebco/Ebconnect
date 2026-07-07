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
  // Multi-sheet workbooks (P3) may carry per-sheet column profiles; read
  // defensively — a CSV / single-sheet response omits this.
  columns?: DatasetColumn[]
}

// An attached frame in a multi-file conversation (P3). The backend's attach
// response / conversation detail may vary in field names, so consumers read
// this defensively.
export interface Frame {
  dataset_id: string
  frame_alias: string
  dataset_name?: string
  name?: string
  row_count?: number
  is_primary?: boolean
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

// Library list item — GET /datasets returns a BARE array of these summaries
// (no columns/sheets; those come from GET /datasets/{id}).
export interface DatasetSummary {
  id: string
  name: string
  kind: string
  row_count: number
  created_at?: string
  last_used_at?: string
}

// GET /conversations returns a BARE array of these, ordered by last_used_at.
export interface ConversationSummary {
  id: string
  primary_dataset_id: string
  title?: string | null
  created_at?: string
  last_used_at?: string
  message_count?: number
}

// A persisted chat turn. GET /conversations/{id} returns
// { conversation, messages: Message[] }. Assistant messages mirror the
// `answer` SSE event; usage may arrive nested or as flat token fields.
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  chart?: ChartSpec | null
  table?: TableSpec | null
  code?: string | null
  followups?: string[]
  confidence?: 'high' | 'medium' | 'low' | string
  status?: AnswerStatus | string
  usage?: UsageEvent | null
  token_prompt?: number
  token_completion?: number
  token_total?: number
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  cost_usd?: number
  elapsed_ms?: number
  created_at?: string
}

export interface ConversationDetail {
  conversation: Conversation
  messages: Message[]
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

// ── Phase 6: Pinnable Dashboard ────────────────────────────────────────
// A pinned answer snapshot. POST /dashboard/tiles returns a bare object;
// GET /dashboard/tiles returns a bare array. Read defensively — the backend
// snapshots prose/chart/table/context at pin time so the tile renders
// without re-running the query.
export interface DashboardTile {
  id: string
  message_id: string
  conversation_id: string
  dataset_id?: string
  dataset_name?: string
  title: string
  content: string
  chart?: ChartSpec | null
  table?: TableSpec | null
  confidence?: 'high' | 'medium' | 'low' | string | null
  display_order?: number
  created_at?: string
}
