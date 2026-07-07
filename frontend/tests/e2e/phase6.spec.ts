import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { QUOTA_SKIP_REASON, settleTurn } from './_quota'

// Phase-6: Pinnable Dashboard + collapsible icon-rail sidebar, run against the
// LIVE single-origin app (FastAPI serving the built frontend at /app/, backend
// up with real Gemini + SQLite).
//
// Two independent journeys:
//   1. Pin → Dashboard → persist across reload → unpin → empty state. This one
//      needs a real completed answer, so it is QUOTA-AWARE: if the live model is
//      rate-limited the answer resolves to the friendly bubble and the
//      pin-dependent assertions are skipped (mirroring the pytest quota skips).
//   2. Sidebar collapse/expand — a pure-UI, NON-LLM test that always runs.

const SALES = path.join(__dirname, 'fixtures', 'sales.csv')
const LONG = 60_000
const MED = 30_000

async function askAndSettle(page: Page, question: string): Promise<boolean> {
  await page.getByTestId('question-input').fill(question)
  await page.getByTestId('ask-button').click()
  return settleTurn(page, LONG)
}

test('pin an answer → dashboard tile → persists across reload → unpin → empty', async ({
  page,
}) => {
  await page.goto('./')
  await expect(page.getByText('Data Analyst')).toBeVisible()

  // The Analyze | Dashboard view switch is present.
  await expect(page.getByTestId('nav-analyze')).toBeVisible()
  await expect(page.getByTestId('nav-dashboard')).toBeVisible()

  // Upload a CSV → profile populates.
  await page.getByTestId('file-input').setInputFiles(SALES)
  await expect(page.getByTestId('column-list')).toBeVisible({ timeout: MED })

  // Ask a question and wait for it to settle (answer / clarify / error).
  const quotaExhausted = await askAndSettle(
    page,
    'what is total revenue by region?',
  )
  test.skip(quotaExhausted, QUOTA_SKIP_REASON)

  // A completed answer exposes a pin button.
  const pinBtn = page.getByTestId('pin-button').last()
  await expect(pinBtn).toBeVisible({ timeout: LONG })

  // Pin it → the button flips to a pinned state.
  await pinBtn.click()
  await expect(page.getByTestId('pinned').last()).toBeVisible({ timeout: MED })

  // Switch to the Dashboard → the tile appears.
  await page.getByTestId('nav-dashboard').click()
  await expect(page.getByTestId('dashboard-view')).toBeVisible()
  await expect(page.getByTestId('dashboard-grid')).toBeVisible({ timeout: MED })
  const tile = page.getByTestId('dashboard-tile').first()
  await expect(tile).toBeVisible()

  // Reload the page → the pinned tile persists (rendered from the snapshot).
  await page.reload()
  await page.getByTestId('nav-dashboard').click()
  await expect(page.getByTestId('dashboard-tile').first()).toBeVisible({
    timeout: MED,
  })

  // Unpin from the tile → it disappears; with none left the empty state shows.
  const tilesBefore = await page.getByTestId('dashboard-tile').count()
  await page.getByTestId('tile-unpin').first().click()
  await expect
    .poll(() => page.getByTestId('dashboard-tile').count())
    .toBe(tilesBefore - 1)

  if (tilesBefore - 1 === 0) {
    await expect(page.getByTestId('dashboard-empty')).toBeVisible({
      timeout: MED,
    })
  }
})

// ── Sidebar collapse/expand — NON-LLM, always runs. ───────────────────────
test('sidebar is a collapsed icon rail that expands on hover/click', async ({
  page,
}) => {
  await page.goto('./')
  const sidebar = page.getByTestId('library-sidebar')
  await expect(sidebar).toBeVisible()

  // Default (desktop) = the slim icon rail (collapsed).
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')

  // Every existing sidebar test-id remains present in the DOM even collapsed.
  await expect(page.getByTestId('sidebar-toggle')).toBeAttached()
  await expect(page.getByTestId('sidebar-expand')).toBeAttached()

  // HOVER-expand → the rail opens to the full panel.
  await sidebar.hover()
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')

  // Move the pointer off the rail → it collapses again (nothing pinned yet).
  await page.mouse.move(640, 16)
  await expect(sidebar).toHaveAttribute('data-expanded', 'false')

  // CLICK-expand (pin open) via the explicit rail affordance → stays open even
  // after the pointer leaves.
  await page.getByTestId('sidebar-expand').click()
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')
  await page.mouse.move(640, 16)
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')

  // Expanded, the library items (with labels) or the friendly empty prompt are
  // reachable — all sidebar test-ids still in the DOM.
  const item = page.getByTestId('library-item').first()
  const empty = page.getByTestId('library-empty')
  await expect(item.or(empty)).toBeVisible({ timeout: MED })
})

// ── Delete from the library — NON-LLM regression guard. ───────────────────
// Reproduces the reported bug: users could not delete datasets because the
// delete control was opacity-0-until-hover and effectively unclickable. This
// asserts the always-discoverable delete control is clickable end-to-end:
// upload (no LLM) → expand sidebar → click dataset-delete → accept confirm →
// the library-item is removed. Guards the regression.
test('delete a dataset from the expanded library removes the item', async ({
  page,
}) => {
  // Auto-accept the window.confirm() guard before deletion.
  page.on('dialog', (d) => d.accept())

  await page.goto('./')
  const sidebar = page.getByTestId('library-sidebar')
  await expect(sidebar).toBeVisible()

  // Upload a CSV (no LLM needed) → it lands in the library.
  await page.getByTestId('file-input').setInputFiles(SALES)
  await expect(page.getByTestId('column-list')).toBeVisible({ timeout: MED })

  // Pin the rail open (click-expand) so the delete control is reachable.
  await page.getByTestId('sidebar-expand').click()
  await expect(sidebar).toHaveAttribute('data-expanded', 'true')

  // The uploaded dataset is present in the library.
  const items = page.getByTestId('library-item')
  await expect(items.first()).toBeVisible({ timeout: MED })
  const countBefore = await items.count()

  // The delete control is discoverable (not opacity-0) and clickable.
  const del = page.getByTestId('dataset-delete').first()
  await expect(del).toBeVisible()
  await del.click()

  // After confirm → DELETE /datasets/{id} → the item disappears.
  await expect
    .poll(() => page.getByTestId('library-item').count(), { timeout: MED })
    .toBe(countBefore - 1)
})
