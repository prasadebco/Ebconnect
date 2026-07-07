import { expect, type Locator, type Page } from '@playwright/test'

// ── Gemini free-tier quota resilience ─────────────────────────────────────
// On a machine whose Gemini free-tier DAILY quota is exhausted, asking a
// question renders a FRIENDLY error bubble instead of a real answer — text
// like "The model is rate-limited right now (quota reached). Wait a moment and
// try again — your data and chat are safe." (via test-id `error-message`
// and/or role="alert"). That is CORRECT app behaviour, not a bug, so the live
// E2E gate must SKIP the answer-dependent assertions in that case — mirroring
// how the pytest suite skips quota-exhausted real-LLM assertions — rather than
// failing red.
//
// When quota IS available a real answer arrives and every assertion runs at
// full strength — this helper NEVER weakens that path.

const QUOTA_HINT = /rate[- ]?limited|quota|try again/i

export const QUOTA_SKIP_REASON =
  'Gemini free-tier quota exhausted — live answer assertion skipped'

// Locator for the friendly quota/rate-limit error bubble, matched by the
// existing `error-message` test-id OR an accessible role="alert" region whose
// text carries the rate-limit/quota wording.
function quotaErrorLocator(page: Page): Locator {
  const byTestId = page
    .getByTestId('error-message')
    .filter({ hasText: QUOTA_HINT })
  const byRole = page.getByRole('alert').filter({ hasText: QUOTA_HINT })
  return byTestId.or(byRole)
}

// True iff the assistant turn currently on screen resolved to the friendly
// quota/rate-limit error (as opposed to a real answer or a clarify turn).
export async function isQuotaExhausted(page: Page): Promise<boolean> {
  return (await quotaErrorLocator(page).count()) > 0
}

// Ask a question (or trigger a turn via the supplied action) and wait for it to
// settle into exactly one of: an answer, a clarify turn, or an error bubble —
// never a hung spinner. Returns `true` when the turn resolved to the quota
// friendly-error, so callers can guard their answer-dependent assertions with
// `test.skip(...)`.
export async function settleTurn(
  page: Page,
  timeout: number,
): Promise<boolean> {
  const answer = page.getByTestId('answer-content').last()
  const clarify = page.getByTestId('clarify-turn').last()
  const error = page.getByTestId('error-message').last()
  await expect(answer.or(clarify).or(error)).toBeVisible({ timeout })
  return isQuotaExhausted(page)
}
