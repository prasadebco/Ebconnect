'use client'

import { useCallback, useRef, useState } from 'react'
import { openConversation, streamQuery, uploadDataset } from '@/lib/api'
import type { Conversation, Dataset } from '@/lib/types'
import { ChatPane } from '@/components/ChatPane'
import type { ChatTurn } from '@/components/ChatMessage'
import { LibrarySidebar } from '@/components/LibrarySidebar'
import { ProfilePanel } from '@/components/ProfilePanel'
import { UploadDropzone } from '@/components/UploadDropzone'

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export default function Home() {
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [busy, setBusy] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const updateTurn = useCallback(
    (id: string, patch: Partial<ChatTurn>) => {
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      )
    },
    [],
  )

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
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleAsk(question: string) {
    if (!conversation) return
    setBusy(true)

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
      for await (const evt of streamQuery(conversation.id, question)) {
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
    }
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-5 py-3">
        <span className="text-lg font-semibold tracking-tight text-gray-900">
          📊 Spreadsheet Analyst
        </span>
        <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-600">
          Local &amp; private
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <LibrarySidebar current={dataset} />

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
