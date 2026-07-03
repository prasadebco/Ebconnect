import path from 'node:path'
import { expect, test } from '@playwright/test'

const XLSX = path.join(__dirname, 'fixtures', 'book.xlsx')
const CUSTOMERS = path.join(__dirname, 'fixtures', 'customers.csv')

// Phase-3 journey, run against the LIVE single-origin app (FastAPI serving the
// built frontend at /app/, backend up with real Gemini + SQLite).
//
// Covers the five un-stubbed features: Excel multi-sheet picker, multi-file
// attach/join, follow-up chips, show-code toggle, and export.
test('multi-sheet xlsx → pick sheet → ask; attach a file → join; chips, code, export', async ({
  page,
}) => {
  await page.goto('./')
  await expect(page.getByText('Data Analyst')).toBeVisible()

  // ── Upload a multi-sheet Excel workbook. ──
  await page.getByTestId('file-input').setInputFiles(XLSX)
  await expect(page.getByTestId('column-list')).toBeVisible({ timeout: 30_000 })

  // ── A sheet picker appears; pick the "sales" sheet. ──
  const picker = page.getByTestId('sheet-picker')
  await expect(picker).toBeVisible({ timeout: 15_000 })
  const salesOption = page.getByTestId('sheet-option').filter({ hasText: 'sales' })
  await salesOption.click()
  await expect(page.getByTestId('column-list')).toContainText('region')

  // ── Ask a question against the chosen sheet. ──
  const input = page.getByTestId('question-input')
  await input.fill('what is total revenue by region?')
  await page.getByTestId('ask-button').click()
  await expect(page.getByTestId('answer-content').first()).toBeVisible({
    timeout: 60_000,
  })

  // ── Follow-up chips are real; clicking one submits the next question. ──
  const chip = page.getByTestId('followup-chip').first()
  await expect(chip).toBeVisible({ timeout: 15_000 })
  await chip.click()
  await expect(page.getByTestId('live-status')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('answer-content').last()).toBeVisible({
    timeout: 60_000,
  })

  // ── Show-code toggle reveals the pandas, hidden by default. ──
  const toggle = page.getByTestId('show-code-toggle').first()
  await expect(toggle).toBeVisible()
  await expect(page.getByTestId('code-block').first()).toBeHidden()
  await toggle.click()
  await expect(page.getByTestId('code-block').first()).toBeVisible()

  // ── Attach a second file and ask a join question spanning both. ──
  await page.getByTestId('add-file').click()
  const uploadInput = page.getByTestId('attach-file-input')
  await uploadInput.setInputFiles(CUSTOMERS)
  await expect(page.getByTestId('frame-item')).toHaveCount(2, {
    timeout: 30_000,
  })

  await input.fill('join to customers and show revenue vs target by region')
  await page.getByTestId('ask-button').click()
  await expect(page.getByTestId('answer-content').last()).toBeVisible({
    timeout: 60_000,
  })

  // ── Export: download the result table as CSV. ──
  const exportCsv = page.getByTestId('export-csv').last()
  await expect(exportCsv).toBeEnabled({ timeout: 15_000 })
  const download = page.waitForEvent('download')
  await exportCsv.click()
  const file = await download
  expect(file.suggestedFilename()).toContain('.csv')
})
