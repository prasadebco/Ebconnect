import path from 'node:path'
import { expect, test } from '@playwright/test'

const FIXTURE = path.join(__dirname, 'fixtures', 'sales.csv')

// Phase-1 primary journey, run against the LIVE single-origin app
// (FastAPI serving the built frontend at /app/, backend up with real Gemini).
// Upload a CSV → profile appears → ask a question → live steps + timer →
// final answer with a chart.
test('primary journey: upload → profile → ask → answer + chart', async ({
  page,
}) => {
  await page.goto('./')

  // Page loads and is styled (indigo header brand present).
  await expect(page.getByText('Spreadsheet Analyst')).toBeVisible()

  // The header should actually be styled — Tailwind compiled, not raw.
  const headerBg = await page
    .locator('header')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(headerBg).not.toBe('rgba(0, 0, 0, 0)')

  // Dropzone is visible.
  const dropzone = page.getByTestId('dropzone')
  await expect(dropzone).toBeVisible()

  // Labelled stubs are present and marked "Coming soon".
  await expect(page.getByTestId('coming-soon-badge').first()).toBeVisible()

  // Upload the fixture CSV through the hidden file input.
  await page.getByTestId('file-input').setInputFiles(FIXTURE)

  // Profile panel populates with columns from the upload response.
  await expect(page.getByTestId('column-list')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('column-list')).toContainText('region')

  // Chat is auto-opened — the empty prompt then the input appears.
  const input = page.getByTestId('question-input')
  await expect(input).toBeVisible()

  // Ask a chartable question.
  await input.fill('what is total revenue by region?')
  await page.getByTestId('ask-button').click()

  // Live status + elapsed timer appear while the query runs.
  await expect(page.getByTestId('live-status')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('elapsed-timer')).toBeVisible()

  // Final answer renders (real output, not just a 200).
  await expect(page.getByTestId('answer-content')).toBeVisible({
    timeout: 60_000,
  })

  // Per-query token + cost line is shown.
  await expect(page.getByTestId('usage-line')).toBeVisible()

  // An interactive chart renders for this chartable question.
  await expect(page.getByTestId('answer-chart')).toBeVisible({
    timeout: 10_000,
  })
})
