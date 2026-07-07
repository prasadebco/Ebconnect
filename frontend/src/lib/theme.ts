'use client'

import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'ebco-theme'

// Read the current theme from the <html> class (source of truth, set pre-hydration).
function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Storage may be unavailable (private mode) — the in-DOM class still works.
  }
  // Notify listeners (charts/tables) so they re-read theme-aware colors.
  window.dispatchEvent(new CustomEvent('ebco-theme-change'))
}

// Subscribe to the active theme. Reflects both the toggle and OS changes,
// and stays in sync across components via a custom event.
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    setTheme(currentTheme())
    const onChange = () => setTheme(currentTheme())
    window.addEventListener('ebco-theme-change', onChange)
    return () => window.removeEventListener('ebco-theme-change', onChange)
  }, [])

  const toggle = () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark')
  return { theme, toggle }
}

// Convenience boolean hook for runtime-colored surfaces (Recharts).
export function useIsDark(): boolean {
  return useTheme().theme === 'dark'
}
