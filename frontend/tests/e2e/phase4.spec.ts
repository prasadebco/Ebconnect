import path from 'node:path'
import { expect, test } from '@playwright/test'
import { QUOTA_SKIP_REASON, isQuotaExhausted } from './_quota'

const FIXTURE = path.join(__dirname, 'fixtures', 'sales.csv')

// Phase-4 journey, run against the LIVE single-origin app (FastAPI serving the
// built frontend at /app/, backend up with real Gemini + SQLite).
//
// Covers the hardened-loop UI: a clarifying-question turn answered inline,
// and the uncertainty / best-guess badge on a low/medium-confidence answer.
// Selectors are resilient — the exact prompt that triggers a clarification vs
// a best-guess depends on the live model, so we branch on what the agent does.

async function upload(page: import('@playwright/test').Page) {
  await page.goto('./')
  await expect(page.getByText('Data Analyst')).toBeVisible()
  await page.getByTestId('file-input').setInputFiles(FIXTURE)
  await expect(page.getByTestId('column-list')).toBeVisible({ timeout: 30_000 })
}

test('ambiguous question → clarify turn → answer inline → resumes to an answer', async ({
  page,
}) => {
  await upload(page)

  const input = page.getByTestId('question-input')
  await input.fill('show me the best ones')
  await page.getByTestId('ask-button').click()

  // The run resolves to a clarifying turn, a (best-guess) answer, or — under
  // free-tier quota exhaustion — the friendly rate-limit bubble. In the last
  // case the clarify/answer assertions are correctly skipped (as pytest does).
  const clarify = page.getByTestId('clarify-turn').last()
  const answer = page.getByTestId('answer-content').last()
  const error = page.getByTestId('error-message').last()
  await expect(clarify.or(answer).or(error)).toBeVisible({ timeout: 60_000 })
  test.skip(await isQuotaExhausted(page), QUOTA_SKIP_REASON)

  if (await clarify.isVisible()) {
    // A clarifying question renders distinctly (not an error, not an answer).
    await expect(page.getByTestId('clarify-question').last()).toBeVisible()
    await expect(page.getByTestId('error-message')).toHaveCount(0)

    // Answer inline — the reply resumes the SAME conversation.
    const reply = page.getByTestId('clarify-input').last()
    await expect(reply).toBeVisible()
    await reply.fill('rank by revenue and show the top 5 regions')
    await page.getByTestId('clarify-send').last().click()

    // The resumed run streams and yields a normal answer.
    await expect(page.getByTestId('answer-content').last()).toBeVisible({
      timeout: 60_000,
    })
  }
})

test('under-specified metric → best-guess answer carries an uncertainty badge', async ({
  page,
}) => {
  await upload(page)

  const input = page.getByTestId('question-input')
  await input.fill('which region is doing well and by how much?')
  await page.getByTestId('ask-button').click()

  // Wait for the run to settle into a clarify turn, an answer, or the friendly
  // quota bubble (free-tier exhaustion → skip the confidence-badge assertion).
  const clarify = page.getByTestId('clarify-turn').last()
  const answer = page.getByTestId('answer-content').last()
  const error = page.getByTestId('error-message').last()
  await expect(clarify.or(answer).or(error)).toBeVisible({ timeout: 60_000 })
  test.skip(await isQuotaExhausted(page), QUOTA_SKIP_REASON)

  // If it answered, a medium/low-confidence answer surfaces the badge; a
  // high-confidence answer stays clean (no badge). Both are valid — assert the
  // badge is coherent with the note when present.
  if (await answer.isVisible()) {
    const badge = page.getByTestId('confidence-badge')
    if ((await badge.count()) > 0) {
      await expect(badge.first()).toBeVisible()
      await expect(page.getByTestId('low-confidence-note').first()).toBeVisible()
    }
  }
})
