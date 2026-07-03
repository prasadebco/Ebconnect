'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteDataset,
  getConversation,
  getDataset,
  listConversations,
  listDatasets,
  openConversation,
  streamQuery,
  uploadDataset,
} from '@/lib/api'
import type {
  AnswerEvent,
  AnswerStatus,
  Conversation,
  ConversationSummary,
  Dataset,
  DatasetSummary,
  Message,
  UsageEvent,
} from '@/lib/types'
import { ChatPane } from '@/components/ChatPane'
import type { ChatTurn } from '@/components/ChatMessage'
import { LibrarySidebar } from '@/components/LibrarySidebar'
import { ProfilePanel } from '@/components/ProfilePanel'
import { UploadDropzone } from '@/components/UploadDropzone'

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// Rebuild a persisted usage line from a stored message (nested or flat).
function usageFromMessage(m: Message): UsageEvent | null {
  if (m.usage) return m.usage
  if (
    m.token_total != null ||
    m.total_tokens != null ||
    m.cost_usd != null
  ) {
    return {
      prompt: m.token_prompt ?? m.prompt_tokens ?? 0,
      completion: m.token_completion ?? m.completion_tokens ?? 0,
      total: m.token_total ?? m.total_tokens ?? 0,
      cost_usd: m.cost_usd ?? 0,
      elapsed_ms: m.elapsed_ms ?? 0,
    }
  }
  return null
}

// Reload prior turns (question + answer + chart/table) from history so a
// reopened conversation renders exactly like it did, then continues.
function messagesToTurns(messages: Message[]): ChatTurn[] {
  return messages.map((m): ChatTurn => {
    if (m.role === 'user') {
      return {
        id: m.id,
        role: 'user',
        question: m.content,
        status: 'done',
        steps: [],
        past: true,
      }
    }
    const status = m.status
    const turnStatus: ChatTurn['status'] =
      status === 'needs_clarification'
        ? 'clarify'
        : status === 'failed'
          ? 'error'
          : 'done'
    const answer: AnswerEvent = {
      message_id: m.id,
      content: m.content,
      chart: m.chart ?? null,
      table: m.table ?? null,
      code: m.code ?? null,
      followups: m.followups,
      confidence: m.confidence,
      status: (status as AnswerStatus) ?? 'completed',
    }
    return {
      id: m.id,
      role: 'assistant',
      status: turnStatus,
      steps: [],
      answer: turnStatus === 'error' ? null : answer,
      errorMessage: turnStatus === 'error' ? m.content : undefined,
      usage: usageFromMessage(m),
      past: true,
    }
  })
}

export default function Home() {
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Persistent library + conversation history (Phase 2).
  const [library, setLibrary] = useState<DatasetSummary[]>([])
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [libLoading, setLibLoading] = useState(true)

  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [busy, setBusy] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshLibrary = useCallback(async () => {
    try {
      const [ds, cs] = await Promise.all([listDatasets(), listConversations()])
      setLibrary(ds)
      setConversations(cs)
    } catch {
      // A missing/empty library must never crash the workspace.
    }
  }, [])

  useEffect(() => {
    setLibLoading(true)
    refreshLibrary().finally(() => setLibLoading(false))
  }, [refreshLibrary])

  const updateTurn = useCallback((id: string, patch: Partial<ChatTurn>) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  async function handleUpload(file: File) {
    setUploading(true)
    setUploadError(null)
    try {
      const ds = await uploadDataset(file)
      setDataset(ds)
      // Auto-open a chat over the new dataset.
      const conv = await openConversation(ds.id)
      setConversation(conv)
      setTurns([])
      // New upload joins the persistent library immediately.
      await refreshLibrary()
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  // Resume a dataset from the library: load its full profile, make it active
  // for new questions, and start a clean chat surface (its past chats show in
  // the sidebar and can be reopened).
  async function handleSelectDataset(id: string) {
    if (id === dataset?.id || busy) return
    setUploadError(null)
    setUploading(true)
    try {
      const ds = await getDataset(id)
      setDataset(ds)
      setConversation(null)
      setTurns([])
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Could not open dataset')
    } finally {
      setUploading(false)
    }
  }

  // Reopen a past conversation → reload its full history into the chat pane,
  // then allow a new follow-up in the SAME conversation (prior-turn context).
  async function handleReopenConversation(convId: string) {
    if (busy) return
    setBusy(true)
    setUploadError(null)
    try {
      const detail = await getConversation(convId)
      const dsId = detail.conversation.primary_dataset_id
      if (dsId !== dataset?.id) {
        const ds = await getDataset(dsId)
        setDataset(ds)
      }
      setConversation(detail.conversation)
      setTurns(messagesToTurns(detail.messages))
    } catch (e) {
      setUploadError(
        e instanceof Error ? e.message : 'Could not reopen conversation',
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteDataset(id: string, name: string) {
    if (busy) return
    if (
      !window.confirm(
        `Delete "${name}"? This removes the file and its chats from the library.`,
      )
    ) {
      return
    }
    try {
      await deleteDataset(id)
      if (dataset?.id === id) {
        setDataset(null)
        setConversation(null)
        setTurns([])
      }
      await refreshLibrary()
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Could not delete dataset')
    }
  }

  async function handleAsk(question: string) {
    if (!dataset || busy) return
    setBusy(true)

    // Lazily open a conversation if the user started from a resumed dataset.
    let conv = conversation
    if (!conv) {
      try {
        conv = await openConversation(dataset.id)
        setConversation(conv)
      } catch (e) {
        setBusy(false)
        setUploadError(
          e instanceof Error ? e.message : 'Could not start a conversation',
        )
        return
      }
    }

    const userTurn: ChatTurn = {
      id: uid(),
      role: 'user',
      question,
      status: 'done',
      steps: [],
    }
    const assistantId = uid()
    const assistantTurn: ChatTurn = {
      id: assistantId,
      role: 'assistant',
      status: 'streaming',
      steps: [],
      currentStep: 'Starting…',
      elapsedMs: 0,
    }
    setTurns((prev) => [...prev, userTurn, assistantTurn])

    const start = Date.now()
    timerRef.current = setInterval(() => {
      updateTurn(assistantId, { elapsedMs: Date.now() - start })
    }, 100)

    const stopTimer = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }

    try {
      const stepsSeen: string[] = []
      for await (const evt of streamQuery(conv.id, question)) {
        if (evt.type === 'step') {
          stepsSeen.push(evt.data.label)
          updateTurn(assistantId, {
            steps: [...stepsSeen],
            currentStep: evt.data.label,
          })
        } else if (evt.type === 'usage') {
          updateTurn(assistantId, { usage: evt.data })
        } else if (evt.type === 'answer') {
          stopTimer()
          const done = evt.data.status === 'needs_clarification'
          updateTurn(assistantId, {
            status: done ? 'clarify' : 'done',
            answer: evt.data,
            elapsedMs: Date.now() - start,
          })
        } else if (evt.type === 'error') {
          stopTimer()
          updateTurn(assistantId, {
            status: 'error',
            errorMessage: evt.data.message,
          })
        }
      }
      // If the stream ended without a terminal event, mark done gracefully.
      updateTurn(assistantId, { currentStep: undefined })
      setTurns((prev) =>
        prev.map((t) =>
          t.id === assistantId && t.status === 'streaming'
            ? {
                ...t,
                status: 'error',
                errorMessage:
                  "Couldn't complete this — the stream ended unexpectedly.",
              }
            : t,
        ),
      )
    } catch (e) {
      stopTimer()
      updateTurn(assistantId, {
        status: 'error',
        errorMessage:
          e instanceof Error
            ? e.message
            : "Couldn't complete this — try rephrasing.",
      })
    } finally {
      stopTimer()
      setBusy(false)
      // Reflect updated last_used ordering + any newly-created conversation.
      refreshLibrary()
    }
  }

  const datasetConversations = dataset
    ? conversations.filter((c) => c.primary_dataset_id === dataset.id)
    : []

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white bg-gradient-to-r from-white to-accent-50/40 px-6 py-3 shadow-sm">
        {/* Static-export app is served under basePath '/app', so plain <img>
            src is NOT auto-prefixed — reference the asset at /app/…. */}
        <img
          src="/app/ebco-logo.png"
          alt="Ebco Pvt Ltd — Simplifying lives."
          className="h-11 w-auto shrink-0"
        />
        <span className="h-6 w-px shrink-0 bg-slate-200" aria-hidden="true" />
        <span className="text-[15px] font-semibold tracking-tight text-slate-900">
          Ebco AI <span className="text-brand-500">—</span> Data Analyst
        </span>
        <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/10">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Local &amp; private
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <LibrarySidebar
          datasets={library}
          activeDatasetId={dataset?.id ?? null}
          conversations={datasetConversations}
          activeConversationId={conversation?.id ?? null}
          loading={libLoading}
          onSelectDataset={handleSelectDataset}
          onDeleteDataset={handleDeleteDataset}
          onSelectConversation={handleReopenConversation}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          {!dataset ? (
            <div className="flex flex-1 items-center justify-center overflow-y-auto">
              <UploadDropzone
                onFile={handleUpload}
                loading={uploading}
                error={uploadError}
              />
            </div>
          ) : (
            <ChatPane
              datasetName={dataset.name}
              turns={turns}
              busy={busy}
              onAsk={handleAsk}
            />
          )}
        </main>

        <ProfilePanel dataset={dataset} loading={uploading} />
      </div>
    </div>
  )
}
