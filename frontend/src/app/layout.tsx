import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Ebco AI — Data Analyst',
  description: 'EBCO PVT LTD — Ask your spreadsheets questions in plain English, analyzed locally.',
}

// Pre-hydration theme resolver: sets the `dark` class on <html> from the
// persisted choice, falling back to the OS preference, BEFORE first paint so
// there is no theme flash. Kept inline + tiny; no external deps.
const THEME_SCRIPT = `
(function(){try{
  var k='ebco-theme';
  var s=localStorage.getItem(k);
  var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;
  if(d)document.documentElement.classList.add('dark');
}catch(e){}})();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-accent-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        {children}
      </body>
    </html>
  )
}
