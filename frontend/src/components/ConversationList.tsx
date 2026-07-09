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
        className="rounded-lg bg-white/[0.04] px-3 py-2.5 text-center text-[11px] leading-relaxed text-white/70 ring-1 ring-inset ring-white/5"
      >
        No past chats yet — ask a question to start one.
      </p>
    )
  }

  return (
    <ul data-testid="conversation-list" className="space-y-1.5">
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
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] transition ${
                active
                  ? 'bg-white/[0.18] text-white ring-1 ring-inset ring-white/30'
                  : 'text-white/75 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className="shrink-0 text-white/60">💬</span>
              <span className="min-w-0 flex-1 truncate">
                {c.title?.trim() || 'Untitled chat'}
              </span>
              {when && (
                <span className="shrink-0 text-[10px] font-medium text-white/60">
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
