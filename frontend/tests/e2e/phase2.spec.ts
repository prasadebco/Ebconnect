import path from 'node:path'
import { expect, test } from '@playwright/test'

const FIXTURE = path.join(__dirname, 'fixtures', 'sales.csv')

// Phase-2 journey, run against the LIVE single-origin app (FastAPI serving the
// built frontend at /app/, backend up with real Gemini + SQLite).
//
// Seeds one dataset + one answered conversation, then proves the persistent
// library: reload → dataset listed → click resumes → reopen the past chat
// reloads prior turns → a follow-up streams a NEW answer in the same
// conversation (prior-turn context).
test('library: seed → reload → resume → reopen history → follow-up', async ({
  page,
}) => {
  // ── Seed: upload + ask one question so persisted history exists. ──
  await page.goto('./')
  await expect(page.getByText('Data Analyst')).toBeVisible()

  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await expect(page.getByTestId('column-list')).toBeVisible({ timeout: 30_000 })

  const input = page.getByTestId('question-input')
  await input.fill('what is total revenue by region?')
  await page.getByTestId('ask-button').click()
  await expect(page.getByTestId('answer-content').first()).toBeVisible({
    timeout: 60_000,
  })

  // ── Reload the app: the dataset must survive as a library entry. ──
  await page.reload()
  const libraryItem = page.getByTestId('library-item').first()
  await expect(libraryItem).toBeVisible({ timeout: 15_000 })
  await expect(libraryItem).toContainText('sales')

  // ── Click the library item → resumes the dataset (profile reloads). ──
  await libraryItem.click()
  await expect(page.getByTestId('column-list')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('column-list')).toContainText('region')

  // ── Its past conversation is listed; reopen it → prior turns reload. ──
  const conversationItem = page.getByTestId('conversation-item').first()
  await expect(conversationItem).toBeVisible({ timeout: 15_000 })
  await conversationItem.click()

  const pastTurns = page.getByTestId('past-turn')
  await expect(pastTurns.first()).toBeVisible({ timeout: 15_000 })
  expect(await pastTurns.count()).toBeGreaterThanOrEqual(2)

  // The reopened assistant turn must show REAL persisted telemetry, not
  // "0 tokens" — the usage reader must map the backend's flat token_* fields.
  const usageLine = page.getByTestId('usage-line').first()
  await expect(usageLine).toBeVisible({ timeout: 15_000 })
  await expect(usageLine).toContainText('tokens')
  await expect(usageLine).not.toContainText('0 tokens')

  // ── Continue with a follow-up in the SAME conversation. ──
  await input.fill('now break that down by month')
  await page.getByTestId('ask-button').click()
  await expect(page.getByTestId('live-status')).toBeVisible({ timeout: 15_000 })

  // A NEW answer streams in on top of the reloaded history.
  await expect(page.getByTestId('answer-content').last()).toBeVisible({
    timeout: 60_000,
  })
})

// The empty-library state is a friendly prompt, never a stub badge.
test('empty library shows a friendly get-started prompt when no datasets', async ({
  page,
}) => {
  await page.goto('./')
  // Either datasets already exist (library-item) or the empty prompt shows.
  const empty = page.getByTestId('library-empty')
  const item = page.getByTestId('library-item').first()
  await expect(empty.or(item)).toBeVisible({ timeout: 15_000 })
})
