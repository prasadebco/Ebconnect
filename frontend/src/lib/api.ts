// Same-origin API client. The UI is served under /app/ but the API lives at
// the origin root, so all paths are absolute-from-origin (leading slash).

import type {
  Conversation,
  ConversationDetail,
  ConversationSummary,
  Dataset,
  DatasetSummary,
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

/**
 * POST a question and consume the SSE `text/event-stream` response.
 * EventSource can't POST, so we parse the stream manually via fetch +
 * ReadableStream. Yields typed StreamEvents as they arrive.
 */
export async function* streamQuery(
  conversationId: string,
  question: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const res = await fetch(`/conversations/${conversationId}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ question }),
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
