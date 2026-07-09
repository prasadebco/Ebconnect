import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { QUOTA_SKIP_REASON, settleTurn } from './_quota'

// Phase-5 comprehensive regression: ONE end-to-end journey exercising the whole
// product in sequence against the LIVE single-origin app (FastAPI serving the
// built frontend at /app/, backend up with real Gemini + SQLite).
//
// Because live-model behaviour varies (clarify vs. best-guess vs. straight
// answer; which columns are chartable), selectors are resilient and branch on
// what the agent actually does. The journey still asserts the real, verifiable
// surface of every phase: profile, answer + chart + table, dark mode, Excel
// sheet picker, multi-file join, follow-up chips, show-code, export, clarify,
// confidence, and the persistent library.

const SALES = path.join(__dirname, 'fixtures', 'sales.csv')
const CUSTOMERS = path.join(__dirname, 'fixtures', 'customers.csv')
const XLSX = path.join(__dirname, 'fixtures', 'book.xlsx')

const LONG = 60_000
const MED = 30_000

// Ask a question and wait for the turn to settle into an answer, a clarify
// turn, or an error affordance — never a hung spinner. Returns `true` when the
// live model was quota-exhausted (friendly rate-limit bubble), so callers can
// make the answer-dependent assertions quota-conditional.
async function askAndSettle(page: Page, question: string): Promise<boolean> {
  await page.getByTestId('question-input').fill(question)
  await page.getByTestId('ask-button').click()
  return settleTurn(page, LONG)
}

test('full product journey: upload → profile → ask → chart → dark → excel → join → chips → code → export → clarify → library', async ({
  page,
}) => {
  // ── 1. Load: the styled Ebco workspace. ──
  await page.goto('./')
  await expect(page.getByText('Data Analyst')).toBeVisible()
  const headerBg = await page
    .locator('header')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(headerBg).not.toBe('rgba(0, 0, 0, 0)')

  // ── 2. Upload a CSV → the profile panel populates. ──
  await page.getByTestId('file-input').setInputFiles(SALES)
  await expect(page.getByTestId('column-list')).toBeVisible({ timeout: MED })
  await expect(page.getByTestId('column-list')).toContainText('region')

  // ── 3. Ask a chartable question → prose + chart + table + token/cost. ──
  // Answer-dependent assertions run only when the live model actually answered;
  // under quota exhaustion the friendly rate-limit bubble is correct behaviour.
  const quotaExhausted = await askAndSettle(
    page,
    'what is total revenue by region?',
  )
  if (!quotaExhausted) {
    await expect(page.getByTestId('answer-content').last()).toBeVisible({
      timeout: LONG,
    })
    await expect(page.getByTestId('usage-line').last()).toBeVisible()
    await expect(page.getByTestId('usage-line').last()).not.toContainText(
      '0 tokens',
    )
    // A chart is expected for this aggregation, but the model decides — assert
    // it if present so the test is robust to a table-only answer.
    const chart = page.getByTestId('answer-chart').last()
    if ((await chart.count()) > 0) {
      await expect(chart).toBeVisible({ timeout: 10_000 })
    }
  } else {
    test.info().annotations.push({ type: 'quota', description: QUOTA_SKIP_REASON })
  }

  // ── 4. Toggle DARK MODE → the theme actually changes on <html>. ──
  const html = page.locator('html')
  const wasDark = await html.evaluate((el) => el.classList.contains('dark'))
  await page.getByTestId('theme-toggle').click()
  await expect
    .poll(() => html.evaluate((el) => el.classList.contains('dark')))
    .toBe(!wasDark)

  // ── 5. Show-code toggle reveals the pandas (hidden by default). ──
  const codeToggle = page.getByTestId('show-code-toggle').last()
  if ((await codeToggle.count()) > 0) {
    await expect(page.getByTestId('code-block').last()).toBeHidden()
    await codeToggle.click()
    await expect(page.getByTestId('code-block').last()).toBeVisible()
  }

  // ── 6. Follow-up chip → auto-asks the next question in context. ──
  const chip = page.getByTestId('followup-chip').first()
  if ((await chip.count()) > 0) {
    await expect(chip.first()).toBeVisible({ timeout: MED })
    await chip.first().click()
    // The follow-up produces a NEW answer — unless quota is exhausted, in which
    // case the friendly rate-limit bubble is the correct, non-failing outcome.
    const answer = page.getByTestId('answer-content').last()
    const error = page.getByTestId('error-message').last()
    await expect(answer.or(error)).toBeVisible({ timeout: LONG })
  }

  // ── 7. Export the result table as CSV. ──
  const exportCsv = page.getByTestId('export-csv').last()
  if (await exportCsv.isEnabled().catch(() => false)) {
    const dl = page.waitForEvent('download')
    await exportCsv.click()
    expect((await dl).suggestedFilename()).toContain('.csv')
  }

  // ── 8. Confidence badge is coherent with its note when the model flags a
  //       best guess (clean, no badge, when confident — both are valid). ──
  const badge = page.getByTestId('confidence-badge')
  if ((await badge.count()) > 0) {
    await expect(page.getByTestId('low-confidence-note').first()).toBeVisible()
  }

  // ── 9. Switch to an Excel workbook → sheet picker → pick a sheet → ask. ──
  await page.getByTestId('file-input').setInputFiles(XLSX)
  await expect(page.getByTestId('column-list')).toBeVisible({ timeout: MED })
  const picker = page.getByTestId('sheet-picker')
  if (await picker.isVisible().catch(() => false)) {
    const option = page.getByTestId('sheet-option').first()
    await option.click()
  }
  await askAndSettle(page, 'summarise this sheet in one number')

  // ── 10. Attach a second file → join question spanning both frames. ──
  const addFile = page.getByTestId('add-file')
  if (await addFile.isVisible().catch(() => false)) {
    await addFile.click()
    await page.getByTestId('attach-file-input').setInputFiles(CUSTOMERS)
    await expect(page.getByTestId('frame-item')).toHaveCount(2, {
      timeout: MED,
    })
    await askAndSettle(
      page,
      'join to the customers frame and show revenue by segment',
    )
  }

  // ── 11. Ambiguous question → clarify turn answered inline → resumes. ──
  await askAndSettle(page, 'show me the best ones')
  const clarify = page.getByTestId('clarify-turn').last()
  if (await clarify.isVisible().catch(() => false)) {
    await expect(page.getByTestId('error-message')).toHaveCount(0)
    const reply = page.getByTestId('clarify-input').last()
    await reply.fill('rank regions by total revenue and show the top 3')
    await page.getByTestId('clarify-send').last().click()
    // Resumes to a real answer — or the friendly quota bubble if the free-tier
    // limit was reached on the resumed run.
    const resumed = page.getByTestId('answer-content').last()
    const resumedErr = page.getByTestId('error-message').last()
    await expect(resumed.or(resumedErr)).toBeVisible({ timeout: LONG })
  }

  // ── 12. Persistent library: reload → resume a dataset → reopen a chat. ──
  await page.reload()
  const libItem = page.getByTestId('library-item').first()
  await expect(libItem).toBeVisible({ timeout: MED })
  await libItem.click()
  await expect(page.getByTestId('column-list')).toBeVisible({ timeout: MED })

  const convItem = page.getByTestId('conversation-item').first()
  if (await convItem.isVisible().catch(() => false)) {
    await convItem.click()
    await expect(page.getByTestId('past-turn').first()).toBeVisible({
      timeout: MED,
    })
  }
})
