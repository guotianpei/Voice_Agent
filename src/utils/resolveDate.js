const chrono = require('chrono-node')

/**
 * Resolves whatever the caller said ("next Monday", "July 21st", "tomorrow",
 * or an already-clean "2026-07-20") into a YYYY-MM-DD string, using the
 * server's own clock as the reference — never the LLM's arithmetic. This is
 * why the checkAvailability tool schema should stop asking the assistant to
 * pre-convert dates: pass along the caller's own words instead, and let this
 * function do the one thing LLMs are unreliable at.
 */
function resolveDate(raw, referenceDate = new Date()) {
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  const parsed = chrono.parseDate(raw, referenceDate)
  if (!parsed) return null

  const y = parsed.getFullYear()
  const m = String(parsed.getMonth() + 1).padStart(2, '0')
  const d = String(parsed.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

module.exports = resolveDate
