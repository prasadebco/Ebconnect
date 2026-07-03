// Same-origin API client. The UI is served under /app/ but the API lives at
// the origin root, so all paths are absolute-from-origin (leading slash).

import type {
  Conversation,
  ConversationDetail,
  ConversationSummary,
  Dataset,
  DatasetSummary,
  Frame,
  StreamEvent,
} from './types'

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    const detail = body?.detail
    if (typeof detail === 'string') return detail
    if (detail?.message) return detail.message
    if (body?.message) return body.message
  } catch {
    // fall through
  }
  return `Request failed (${res.status})`
}

export async function uploadDataset(file: File): Promise<Dataset> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/datasets', { method: 'POST', body: form })
  if (!res.ok) throw new Error(await parseError(res))
  return (await res.json()) as Dataset
}

// ── Phase 2: persistent library + conversation history ─────────────────
// All responses are BARE objects/arrays (no {data} envelope).

export async function listDatasets(): Promise<DatasetSummary[]> {
  const res = await fetch('/datasets')
  if (!res.ok) throw new Error(await parseError(res))
  return (await res.json()) as DatasetSummary[]
}

export async function getDataset(id: string): Promise<Dataset> {
  const res = await fetch(`/datasets/${id}`)
  if (!res.ok) throw new Error(await parseError(res))
  return (await res.json()) as Dataset
}

export async function deleteDataset(id: string): Promise<void> {
  const res = await fetch(`/datasets/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await parseError(res))
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const res = await fetch('/conversations')
  if (!res.ok) throw new Error(await parseError(res))
  return (await res.json()) as ConversationSummary[]
}

export async function getConversation(
  id: string,
): Promise<ConversationDetail> {
  const res = await fetch(`/conversations/${id}`)
  if (!res.ok) throw new Error(await parseError(res))
  return (await res.json()) as ConversationDetail
}

export async function openConversation(
  primaryDatasetId: string,
): Promise<Conversation> {
  const res = await fetch('/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ primary_dataset_id: primaryDatasetId }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return (await res.json()) as Conversation
}

// ── Phase 3: multi-file attach + export ────────────────────────────────

// Normalise the attach / conversation frame payload, which may arrive as a
// bare array of frames or wrapped as { frames: [...] }.
function normaliseFrames(payload: unknown): Frame[] {
  const raw = Array.isArray(payload)
    ? payload
    : ((payload as { frames?: unknown })?.frames ?? [])
  if (!Array.isArray(raw)) return []
  return raw
    .map((f): Frame | null => {
      if (!f || typeof f !== 'object') return null
      const o = f as Record<string, unknown>
      const dataset_id = String(o.dataset_id ?? o.id ?? '')
      const frame_alias = String(o.frame_alias ?? o.alias ?? o.name ?? '')
      if (!dataset_id && !frame_alias) return null
      return {
        dataset_id,
        frame_alias,
        dataset_name:
          typeof o.dataset_name === 'string' ? o.dataset_name : undefined,
        name: typeof o.name === 'string' ? o.name : undefined,
        row_count: typeof o.row_count === 'number' ? o.row_count : undefined,
        is_primary: Boolean(o.is_primary) || frame_alias === 'df',
      }
    })
    .filter((f): f is Frame => f !== null)
}

// Attach another dataset to a conversation for multi-file joins. Returns the
// updated frame list.
export async function attachDataset(
  conversationId: string,
  datasetId: string,
  frameAlias: string,
): Promise<Frame[]> {
  const res = await fetch(`/conversations/${conversationId}/attach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_id: datasetId, frame_alias: frameAlias }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return normaliseFrames(await res.json())
}

// Build the (same-origin, absolute-from-origin) export URL for an answer.
export function exportUrl(
  conversationId: string,
  messageId: string,
  format: 'csv' | 'png',
): string {
  return `/conversations/${conversationId}/messages/${messageId}/export?format=${format}`
}

// Download an answer's result as a file. Fetches as a blob and triggers an
// anchor download so we surface HTTP errors cleanly instead of navigating.
export async function downloadExport(
  conversationId: string,
  messageId: string,
  format: 'csv' | 'png',
  filename: string,
): Promise<void> {
  const res = await fetch(exportUrl(conversationId, messageId, format))
  if (!res.ok) throw new Error(await parseError(res))
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    // Revoke on the next tick so the click has a chance to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/**
 * POST a question and consume the SSE `text/event-stream` response.
 * EventSource can't POST, so we parse the stream manually via fetch +
 * ReadableStream. Yields typed StreamEvents as they arrive.
 */
export async function* streamQuery(
  conversationId: string,
  question: string,
  sheetName?: string | null,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const body: { question: string; sheet_name?: string } = { question }
  if (sheetName) body.sheet_name = sheetName
  const res = await fetch(`/conversations/${conversationId}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  if (!res.body) {
    throw new Error('No response stream from server')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE frames are separated by a blank line.
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const rawFrame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const evt = parseFrame(rawFrame)
      if (evt) yield evt
    }
  }

  // Flush any trailing frame (stream may end without a final blank line).
  const tail = buffer.trim()
  if (tail) {
    const evt = parseFrame(tail)
    if (evt) yield evt
  }
}

function parseFrame(frame: string): StreamEvent | null {
  let eventName = 'message'
  const dataLines: string[] = []
  for (const line of frame.split('\n')) {
    const trimmed = line.replace(/\r$/, '')
    if (trimmed.startsWith(':')) continue // comment / keep-alive
    if (trimmed.startsWith('event:')) {
      eventName = trimmed.slice(6).trim()
    } else if (trimmed.startsWith('data:')) {
      dataLines.push(trimmed.slice(5).replace(/^ /, ''))
    }
  }
  if (dataLines.length === 0) return null
  let data: unknown
  try {
    data = JSON.parse(dataLines.join('\n'))
  } catch {
    return null
  }
  // Typed narrowing by event name.
  if (
    eventName === 'step' ||
    eventName === 'usage' ||
    eventName === 'answer' ||
    eventName === 'error'
  ) {
    return { type: eventName, data } as StreamEvent
  }
  return null
}
