// Shared "Coming soon" badge so every Phase-1 stub reads as intentional,
// never as a bug.
export function ComingSoonBadge({ label = 'Coming soon' }: { label?: string }) {
  return (
    <span
      data-testid="coming-soon-badge"
      className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700"
    >
      {label}
    </span>
  )
}
