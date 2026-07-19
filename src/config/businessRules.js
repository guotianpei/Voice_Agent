/**
 * Business-rule checks driven by the clinic's onboarding config
 * (tenant_configs.config). Every function is a no-op pass when the tenant
 * has no config or the relevant section is missing — rules only tighten
 * behavior when the clinic actually provided them.
 *
 * All rejection messages are written to be SPOKEN by the voice assistant,
 * so they are returned as natural language, not error codes.
 */

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// 'YYYY-MM-DD' -> 'monday' etc. Noon avoids any UTC/local off-by-one.
function dayOfWeek(dateStr) {
  return DAY_NAMES[new Date(dateStr + 'T12:00:00').getDay()]
}

/**
 * Validates a resolved YYYY-MM-DD date against the clinic's configured
 * business hours and scheduling rules.
 * Returns { ok: true } or { ok: false, message: <speakable reason> }.
 */
function validateRequestedDate(config, dateStr, now = new Date()) {
  if (!config) return { ok: true }

  const rules = config.scheduling_rules || {}
  const hours = config.business_hours || null

  // --- Booking window: max advance ---
  if (rules.max_advance_days) {
    const max = new Date(now)
    max.setDate(max.getDate() + rules.max_advance_days)
    if (new Date(dateStr + 'T12:00:00') > max) {
      return {
        ok: false,
        message:
          'That date is beyond our booking window. We can only schedule up to ' +
          rules.max_advance_days + ' days in advance. Please choose an earlier date.',
      }
    }
  }

  // --- Booking window: past dates / same-day minimum notice ---
  const todayStr = now.toISOString().split('T')[0]
  if (dateStr < todayStr) {
    return { ok: false, message: 'That date is in the past. Please choose an upcoming date.' }
  }
  if (dateStr === todayStr && (rules.min_advance_hours || 0) >= 24) {
    return {
      ok: false,
      message:
        'We are not able to book same-day appointments. The earliest we can schedule is tomorrow.',
    }
  }

  // --- Business hours: closed days ---
  // Convention: a day set to null, or absent while other days are present,
  // means the clinic is closed that day.
  if (hours) {
    const day = dayOfWeek(dateStr)
    const dayKeys = DAY_NAMES.filter((d) => hours[d] !== undefined)
    const entry = hours[day]

    const isClosed =
      entry === null ||
      (entry === undefined && dayKeys.length > 0) ||
      (entry && !entry.open && !entry.close)

    if (isClosed) {
      const openDays = DAY_NAMES.filter((d) => hours[d] && (hours[d].open || hours[d].close))
      const openList = openDays.map((d) => d[0].toUpperCase() + d.slice(1)).join(', ')
      return {
        ok: false,
        message:
          'We are closed on ' + day.charAt(0).toUpperCase() + day.slice(1) + 's.' +
          (openList ? ' We are open on: ' + openList + '. Would another day work?' : ''),
      }
    }
  }

  return { ok: true }
}

/**
 * Returns the clinic's bookable services from config, in the canonical
 * appointment-type shape the formatter expects — or null when the tenant
 * has no configured services (caller falls back to the PMS adapter).
 */
function configuredAppointmentTypes(config) {
  const mappings = config && config.services && config.services.mappings
  if (!Array.isArray(mappings)) return null

  const enabled = mappings
    .filter((s) => s.enabled)
    .map((s) => ({
      id: s.id,
      name: s.customer_facing_name,
      durationMinutes: s.duration_minutes,
    }))

  return enabled.length > 0 ? enabled : null
}

/**
 * Filters PMS availability slots to providers the clinic configured as
 * voice-bookable, honoring each provider's available_days. Name-based
 * matching for MVP; production maps config staff to PMS resource IDs
 * during onboarding.
 */
function filterSlotsByStaff(config, availability) {
  const doctors = config && config.staff && config.staff.doctors
  if (!Array.isArray(doctors) || doctors.length === 0) return availability
  if (!availability || !Array.isArray(availability.slots)) return availability

  const day = availability.matchedDate ? dayOfWeek(availability.matchedDate) : null
  const norm = (s) => (s || '').toLowerCase().replace(/^dr\.?\s*/, '').trim()

  const allowed = doctors.filter(
    (d) => !day || !d.available_days || d.available_days.length === 0 || d.available_days.includes(day)
  ).map((d) => norm(d.name))

  const slots = availability.slots.filter((s) => allowed.includes(norm(s.resourceName)))
  return { ...availability, slots }
}

module.exports = { validateRequestedDate, configuredAppointmentTypes, filterSlotsByStaff, dayOfWeek }
