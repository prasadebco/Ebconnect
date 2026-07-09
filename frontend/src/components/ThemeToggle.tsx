'use client'

import { useEffect, useState } from 'react'
import { useTheme } from '@/lib/theme'

// Header sun/moon toggle. Renders a stable, accessible button; the icon is
// resolved after mount to avoid any SSR/CSR mismatch (the class is already set
// pre-hydration, so there is no visual flash regardless).
export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const isDark = theme === 'dark'
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme'

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="group relative flex h-9 w-9 items-center justify-center rounded-lg text-white/85 ring-1 ring-inset ring-white/25 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    >
      <span
        aria-hidden="true"
        className="text-[15px] leading-none transition-transform duration-300 group-active:scale-90"
      >
        {mounted ? (isDark ? '☀' : '☾') : '☾'}
      </span>
    </button>
  )
}
