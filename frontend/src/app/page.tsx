'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  attachDataset,
  deleteDataset,
  getConversation,
  getDataset,
  listConversations,
  listDatasets,
  listTiles,
  openConversation,
  pinTile,
  streamQuery,
  unpinTile,
  uploadDataset,
} from '@/lib/api'
import type {
  AnswerEvent,
  AnswerStatus,
  Conversation,
  ConversationSummary,
  DashboardTile,
  Dataset,
  DatasetSummary,
  Frame,
  Message,
  UsageEvent,
} from '@/lib/types'
import { ChatPane } from '@/components/ChatPane'
import type { ChatTurn } from '@/components/ChatMessage'
import { Dashboard } from '@/components/Dashboard'
import { LibrarySidebar } from '@/components/LibrarySidebar'
import { ProfilePanel } from '@/components/ProfilePanel'
import { UploadDropzone } from '@/components/UploadDropzone'
import { ThemeToggle } from '@/components/ThemeToggle'
import { humanizeError } from '@/lib/errors'

type View = 'analyze' | 'dashboard'

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// A multi-sheet workbook defaults to its first sheet; a single-sheet CSV has
// no picker, so no sheet_name is sent (null).
function defaultSheet(ds: Dataset): string | null {
  const sheets = ds.sheets ?? []
  return sheets.length > 1 ? sheets[0].name : null
}

// Read an attached-frame list off a conversation detail defensively — the
// backend may nest it under `frames` on the detail or the conversation.
function framesFromDetail(detail: {
  conversation?: unknown
  frames?: unknown
}): Frame[] {
  const candidates = [
    (detail as { frames?: unknown }).frames,
    (detail.conversation as { frames?: unknown } | undefined)?.frames,
  ]
  for (const c of candidates) {
    if (Array.isArray(c)) {
      const frames = c
        .map((f): Frame | null => {
          if (!f || typeof f !== 'object') return null
          const o = f as Record<string, unknown>
          const dataset_id = String(o.dataset_id ?? o.id ?? '')
          const frame_alias = String(o.frame_alias ?? o.alias ?? '')
          if (!dataset_id && !frame_alias) return null
          return {
            dataset_id,
            frame_alias,
            dataset_name:
              typeof o.dataset_name === 'string' ? o.dataset_name : undefined,
            name: typeof o.name === 'string' ? o.name : undefined,
            row_count:
              typeof o.row_count === 'number' ? o.row_count : undefined,
            is_primary: Boolean(o.is_primary) || frame_alias === 'df',
          }
        })
        .filter((f): f is Frame => f !== null && !f.is_primary)
      return frames
    }
  }
  return []
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

  // Phase 3: selected Excel sheet + attached frames for multi-file joins.
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null)
  const [frames, setFrames] = useState<Frame[]>([])
  const [attaching, setAttaching] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)

  // Persistent library + conversation history (Phase 2).
  const [library, setLibrary] = useState<DatasetSummary[]>([])
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [libLoading, setLibLoading] = useState(true)

  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [busy, setBusy] = useState(false)
  // Mobile-only: the library sidebar collapses to an off-canvas drawer.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Phase 6 — in-SPA view switch (Analyze | Dashboard) + pinned tiles.
  const [view, setView] = useState<View>('analyze')
  const [tiles, setTiles] = useState<DashboardTile[]>([])
  const [tilesLoading, setTilesLoading] = useState(false)
  const [tilesError, setTilesError] = useState<string | null>(null)
  const [pinBusyId, setPinBusyId] = useState<string | null>(null)

  const loadTiles = useCallback(async () => {
    setTilesLoading(true)
    setTilesError(null)
    try {
      setTiles(await listTiles())
    } catch (e) {
      setTilesError(
        humanizeError(e instanceof Error ? e.message : 'Could not load the dashboard'),
      )
    } finally {
      setTilesLoading(false)
    }
  }, [])

  // Load pinned tiles on mount so answer cards reflect their pinned state.
  useEffect(() => {
    loadTiles()
  }, [loadTiles])

  // The tile pinning a given message (or null when unpinned).
  const pinnedTileFor = useCallback(
    (messageId: string): string | null => {
      const t = tiles.find((x) => x.message_id === messageId)
      return t ? t.id : null
    },
    [tiles],
  )

  // Pin or unpin an answer from its card.
  const handleTogglePin = useCallback(
    async (messageId: string, existingTileId: string | null) => {
      if (pinBusyId) return
      setPinBusyId(messageId)
      try {
        if (existingTileId) {
          await unpinTile(existingTileId)
          setTiles((prev) => prev.filter((t) => t.id !== existingTileId))
        } else {
          const tile = await pinTile(messageId)
          setTiles((prev) =>
            prev.some((t) => t.id === tile.id) ? prev : [tile, ...prev],
          )
        }
      } catch (e) {
        setTilesError(
          humanizeError(e instanceof Error ? e.message : 'Could not update the pin'),
        )
      } finally {
        setPinBusyId(null)
      }
    },
    [pinBusyId],
  )

  // Unpin from a Dashboard tile's remove control.
  const handleUnpinTile = useCallback(async (tileId: string) => {
    setPinBusyId(tileId)
    try {
      await unpinTile(tileId)
      setTiles((prev) => prev.filter((t) => t.id !== tileId))
    } catch (e) {
      setTilesError(
        humanizeError(e instanceof Error ? e.message : 'Could not unpin that tile'),
      )
    } finally {
      setPinBusyId(null)
    }
  }, [])

  const showDashboard = useCallback(() => {
    setView('dashboard')
    setSidebarOpen(false)
    loadTiles()
  }, [loadTiles])

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

  // Make a dataset active: reset the sheet picker to its default sheet.
  const applyDataset = useCallback((ds: Dataset) => {
    setDataset(ds)
    setSelectedSheet(defaultSheet(ds))
  }, [])

  async function handleUpload(file: File) {
    setUploading(true)
    setUploadError(null)
    try {
      const ds = await uploadDataset(file)
      applyDataset(ds)
      // Auto-open a chat over the new dataset.
      const conv = await openConversation(ds.id)
      setConversation(conv)
      setFrames([])
      setTurns([])
      // New upload joins the persistent library immediately.
      await refreshLibrary()
    } catch (e) {
      setUploadError(humanizeError(e instanceof Error ? e.message : 'Upload failed'))
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
      applyDataset(ds)
      setConversation(null)
      setFrames([])
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
        applyDataset(ds)
      }
      setConversation(detail.conversation)
      setFrames(framesFromDetail(detail))
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
        setSelectedSheet(null)
        setFrames([])
        setTurns([])
      }
      await refreshLibrary()
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Could not delete dataset')
    }
  }

  // Ensure a conversation exists over the active dataset, opening one lazily
  // (used by both the query flow and the multi-file attach flow).
  async function ensureConversation(): Promise<Conversation | null> {
    if (conversation) return conversation
    if (!dataset) return null
    const conv = await openConversation(dataset.id)
    setConversation(conv)
    return conv
  }

  // Phase 3 — attach an existing library dataset as a named frame.
  async function handleAttachExisting(datasetId: string, alias: string) {
    if (attaching) return
    setAttaching(true)
    setAttachError(null)
    try {
      const conv = await ensureConversation()
      if (!conv) return
      const updated = await attachDataset(conv.id, datasetId, alias)
      setFrames(updated.filter((f) => !f.is_primary))
    } catch (e) {
      setAttachError(
        humanizeError(e instanceof Error ? e.message : 'Could not attach that file'),
      )
    } finally {
      setAttaching(false)
    }
  }

  // Phase 3 — upload a brand-new file, then attach it to the conversation.
  async function handleUploadAndAttach(file: File, alias: string) {
    if (attaching) return
    setAttaching(true)
    setAttachError(null)
    try {
      const conv = await ensureConversation()
      if (!conv) return
      const ds = await uploadDataset(file)
      const updated = await attachDataset(conv.id, ds.id, alias)
      setFrames(updated.filter((f) => !f.is_primary))
      await refreshLibrary()
    } catch (e) {
      setAttachError(
        humanizeError(e instanceof Error ? e.message : 'Could not add that file'),
      )
    } finally {
      setAttaching(false)
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
      // Kept so a failed turn can offer a one-click retry of the same question.
      question,
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
      for await (const evt of streamQuery(conv.id, question, selectedSheet)) {
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
            errorMessage: humanizeError(evt.data.message),
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
        errorMessage: humanizeError(
          e instanceof Error ? e.message : null,
        ),
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
    <div className="flex h-screen flex-col bg-accent-50 dark:bg-slate-950">
      {/* Blue-forward corporate top bar. A SOLID Ebco-blue background-color
          base (bg-accent-700) is kept under the subtle gradient so the phase-1
          E2E guard — which asserts the <header> computed background-color is
          NOT transparent — always passes. */}
      <header className="z-10 flex items-center gap-3 border-b border-accent-900/40 bg-accent-700 bg-gradient-to-r from-accent-700 to-accent-800 px-6 py-3 shadow-md dark:border-black/30 dark:from-accent-800 dark:to-accent-900">
        {/* Mobile-only: open the library drawer. Hidden on md+ where the
            sidebar is always docked. */}
        <button
          type="button"
          data-testid="sidebar-toggle"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label={sidebarOpen ? 'Close library' : 'Open library'}
          aria-expanded={sidebarOpen}
          aria-controls="library-sidebar"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/80 ring-1 ring-inset ring-white/25 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 md:hidden"
        >
          <span aria-hidden="true" className="text-base leading-none">
            ☰
          </span>
        </button>
        {/* Static-export app is served under basePath '/app', so plain <img>
            src is NOT auto-prefixed — reference the asset at /app/…. The blue
            oval logo sits on a white rounded plate so it reads crisply on the
            Ebco-blue bar in BOTH themes. */}
        <span className="flex shrink-0 items-center rounded-lg bg-white px-2 py-1 shadow-sm ring-1 ring-black/5">
          <img
            src="/app/ebco-logo.png"
            alt="Ebco Pvt Ltd — Simplifying lives."
            className="h-9 w-auto"
          />
        </span>
        <span
          className="h-6 w-px shrink-0 bg-white/25"
          aria-hidden="true"
        />
        <span className="text-[15px] font-semibold tracking-tight text-white">
          Ebco AI <span className="text-brand-400">—</span> Data Analyst
        </span>
        <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium text-white ring-1 ring-inset ring-white/25">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
          Local &amp; private
        </span>
        {/* In-SPA view switch — Analyze | Dashboard. Client-side React state
            (no route change) so static export + basePath '/app' are intact. */}
        <nav
          aria-label="Views"
          className="ml-auto flex items-center gap-1 rounded-lg bg-white/10 p-0.5 ring-1 ring-inset ring-white/20"
        >
          <button
            type="button"
            data-testid="nav-analyze"
            aria-current={view === 'analyze' ? 'page' : undefined}
            onClick={() => setView('analyze')}
            className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
              view === 'analyze'
                ? 'bg-white text-accent-800 shadow-sm'
                : 'text-white/80 hover:bg-white/10 hover:text-white'
            }`}
          >
            Analyze
          </button>
          <button
            type="button"
            data-testid="nav-dashboard"
            aria-current={view === 'dashboard' ? 'page' : undefined}
            onClick={showDashboard}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
              view === 'dashboard'
                ? 'bg-white text-accent-800 shadow-sm'
                : 'text-white/80 hover:bg-white/10 hover:text-white'
            }`}
          >
            Dashboard
            {tiles.length > 0 && (
              <span
                className={`inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
                  view === 'dashboard'
                    ? 'bg-accent-600 text-white'
                    : 'bg-white/20 text-white'
                }`}
              >
                {tiles.length}
              </span>
            )}
          </button>
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
        </div>
      </header>

      {view === 'dashboard' ? (
        <Dashboard
          tiles={tiles}
          loading={tilesLoading}
          error={tilesError}
          busyTileId={pinBusyId}
          onUnpin={handleUnpinTile}
          onOpenConversation={(convId) => {
            setView('analyze')
            handleReopenConversation(convId)
          }}
        />
      ) : (
      <div className="relative flex min-h-0 flex-1">
        {/* Mobile drawer backdrop — click to dismiss the library. */}
        {sidebarOpen && (
          <div
            data-testid="sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
            className="fixed inset-0 z-20 bg-slate-900/40 backdrop-blur-sm md:hidden"
          />
        )}
        <LibrarySidebar
          datasets={library}
          activeDatasetId={dataset?.id ?? null}
          conversations={datasetConversations}
          activeConversationId={conversation?.id ?? null}
          loading={libLoading}
          mobileOpen={sidebarOpen}
          onSelectDataset={(id) => {
            setSidebarOpen(false)
            handleSelectDataset(id)
          }}
          onDeleteDataset={handleDeleteDataset}
          onSelectConversation={(id) => {
            setSidebarOpen(false)
            handleReopenConversation(id)
          }}
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
              conversationId={conversation?.id ?? null}
              onAsk={handleAsk}
              pinnedTileFor={pinnedTileFor}
              onTogglePin={handleTogglePin}
              pinBusyId={pinBusyId}
            />
          )}
        </main>

        <ProfilePanel
          dataset={dataset}
          loading={uploading}
          selectedSheet={selectedSheet}
          onSelectSheet={setSelectedSheet}
          conversation={conversation}
          frames={frames}
          library={library}
          attaching={attaching}
          attachError={attachError}
          onAttachExisting={handleAttachExisting}
          onUploadAndAttach={handleUploadAndAttach}
        />
      </div>
      )}
    </div>
  )
}
