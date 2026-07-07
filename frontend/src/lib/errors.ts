// Turn a raw backend / network error string into a short, friendly message the
// analyst can act on. Quota / rate-limit (429) errors are the most common live
// failure, so they get a specific, calm explanation instead of a raw stack or
// a dead spinner. Everything else falls back to a rephrase nudge.

export function humanizeError(raw?: string | null): string {
  const msg = (raw ?? '').trim()
  if (!msg) return "Couldn't complete this — try again in a moment."

  const lower = msg.toLowerCase()

  // Gemini quota / rate limit.
  if (
    lower.includes('429') ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('rate-limit') ||
    lower.includes('resource_exhausted') ||
    lower.includes('resource exhausted')
  ) {
    return 'The model is rate-limited right now (quota reached). Wait a moment and try again — your data and chat are safe.'
  }

  // Timeouts / cancellations.
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'That took too long and was stopped. Try a simpler or more specific question.'
  }
  if (lower.includes('aborted') || lower.includes('cancel')) {
    return 'That request was cancelled before it finished.'
  }

  // Network / server reachability.
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('econnrefused')
  ) {
    return "Couldn't reach the server. Check that it's running and try again."
  }
  if (/\b5\d\d\b/.test(msg) || lower.includes('internal server error')) {
    return 'The server hit an error handling that. Try again, or rephrase the question.'
  }

  // A short, human-readable backend message is worth showing verbatim; a long
  // stack-like blob is not, so cap it and add a nudge.
  if (msg.length <= 160 && !msg.includes('\n') && !lower.includes('traceback')) {
    return msg
  }
  return "Couldn't complete this — try rephrasing your question."
}
