'use client'

import type { ConversationSummary } from '@/lib/types'

function fmtWhen(iso?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const now = Date.now()
  const diff = now - d.getTime()
  const day = 86_400_000
  if (diff < day && d.getDate() === new Date().getDate()) return 'Today'
  if (diff < 2 * day) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface Props {
  conversations: ConversationSummary[]
  activeConversationId: string | null
  onSelect: (id: string) => void
}

// Phase-2: past conversations for the active dataset. Reopening one reloads
// the full prior chat so the user can continue with a follow-up in context.
export function ConversationList({
  conversations,
  activeConversationId,
  onSelect,
}: Props) {
  if (conversations.length === 0) {
    return (
      <p
        data-testid="conversation-empty"
        className="px-1 py-1 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500"
      >
        No past chats yet — ask a question to start one.
      </p>
    )
  }

  return (
    <ul data-testid="conversation-list" className="space-y-1">
      {conversations.map((c) => {
        const active = c.id === activeConversationId
        const when = fmtWhen(c.last_used_at ?? c.created_at)
        return (
          <li key={c.id}>
            <button
              type="button"
              data-testid="conversation-item"
              data-conversation-id={c.id}
              onClick={() => onSelect(c.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition ${
                active
                  ? 'bg-accent-100 text-accent-800 ring-1 ring-inset ring-accent-600/20 dark:bg-accent-500/15 dark:text-accent-200 dark:ring-accent-400/25'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <span className="shrink-0 text-slate-400 dark:text-slate-500">💬</span>
              <span className="min-w-0 flex-1 truncate">
                {c.title?.trim() || 'Untitled chat'}
              </span>
              {when && (
                <span className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                  {when}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
