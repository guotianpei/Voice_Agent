const PMSAdapter = require('./pmsAdapter')

const { APPOINTMENT_TYPES, RESOURCES, AVAILABLE_SLOTS, CONTACTS, ANIMALS, APPOINTMENTS } = require('../mocks/pmsData')

// 'YYYY-MM-DD HH:MM' + minutes -> 'YYYY-MM-DD HH:MM'. Local-time string math,
// deliberately not timezone-aware — consistent with the rest of this adapter,
// which treats these as opaque clinic-local strings rather than parsing them
// as UTC instants.
function addMinutes(dateTimeStr, minutes) {
  const [datePart, timePart] = dateTimeStr.split(' ')
  const dt = new Date(`${datePart}T${timePart}:00`)
  dt.setMinutes(dt.getMinutes() + minutes)
  const pad = (n) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ` +
    `${pad(dt.getHours())}:${pad(dt.getMinutes())}`
}

/**
 * EzyVetAdapter — talks to ezyVet (currently: the mock data standing in for it, later:
 * the real ezyVet OAuth + ezyCAB endpoints). Every method translates ezyVet's field names
 * into the canonical shapes defined in PMSAdapter — this is the ONLY file in the codebase
 * that should ever know about ezyVet's actual data structure.
 */
class EzyVetAdapter extends PMSAdapter {
  // config: { pmsCredentials, clinicName, ... } from tenants.pms_credentials.
  // Stored but unused while this adapter still serves mock data — becomes
  // the OAuth client id/secret once real ezyVet calls replace the mocks.
  constructor(config = {}) {
    super()
    this.config = config
  }

  async checkAvailability(date) {
    const toSlot = (s) => {
      const resource = RESOURCES.find(r => r.id === s.resource_id)
      return {
        start: s.start,
        end: s.end,
        resourceId: s.resource_id,
        resourceName: resource ? resource.name : 'unknown',
      }
    }

    const exact = AVAILABLE_SLOTS.filter(s => s.start.startsWith(date)).map(toSlot)
    if (exact.length > 0) {
      return { requestedDate: date, matchedDate: date, slots: exact }
    }

    // Nothing on the requested date. Look ahead in AVAILABLE_SLOTS ourselves and hand back
    // a real next-available date — never let the assistant invent one it hasn't verified.
    const future = AVAILABLE_SLOTS
      .filter(s => s.start.slice(0, 10) > date)
      .sort((a, b) => a.start.localeCompare(b.start))

    if (future.length === 0) {
      return { requestedDate: date, matchedDate: null, slots: [] }
    }

    const nextDate = future[0].start.slice(0, 10)
    const nextSlots = future.filter(s => s.start.startsWith(nextDate)).map(toSlot)
    return { requestedDate: date, matchedDate: nextDate, slots: nextSlots }
  }

  // contactId/animalId are optional — the voice booking flow doesn't collect them
  // today, so ordinary phone-in bookings still work exactly as before. reschedule()
  // below DOES pass them, so the new appointment stays linked to the same client/pet
  // as the one it's replacing.
  //
  // Persisting to APPOINTMENTS and returning `id` fixes the same class of bug flagged
  // for getAppointments/contact_id: without a top-level id, nothing created here could
  // ever be referenced again (by reschedule, a later cancel, or getAppointments) — the
  // LLM would have no id to hold onto, same failure mode, different method.
  async bookAppointment({ date, time, appointmentTypeId, resourceId, contactId = null, animalId = null }) {
    const resource = RESOURCES.find(r => r.id === resourceId)
    const type = APPOINTMENT_TYPES.find(t => t.id === appointmentTypeId)
    const id = 'appt-' + Date.now()
    const start = `${date} ${time}`
    const end = addMinutes(start, type ? type.duration : 30)

    APPOINTMENTS.push({
      id,
      contact_id: contactId,
      animal_id: animalId,
      appointment_type_id: appointmentTypeId,
      resource_id: resourceId,
      start,
      end,
      status: 'confirmed',
    })

    return {
      id,
      confirmationNumber: 'MOCK-' + Date.now(),
      date,
      time,
      serviceName: type ? type.name : 'Visit',
      resourceName: resource ? resource.name : 'unknown',
    }
  }

  async lookupContact(phone) {
// Compare last-10-digits on BOTH sides. The LLM formats what it heard
    // unpredictably — including spelled-out words ("one seven zero three...")
    // when the transcriber delivers digits as words. Convert words first,
    // then strip, then take the national 10-digit core.
    const WORD_DIGITS = {
      zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4',
      five: '5', six: '6', seven: '7', eight: '8', nine: '9',
    }
    const normalize = (raw) =>
      (raw || '')
        .toLowerCase()
        .split(/[\s-]+/)
        .map((w) => (WORD_DIGITS[w] !== undefined ? WORD_DIGITS[w] : w))
        .join('')
        .replace(/\D/g, '')
        .slice(-10)
    const cleanPhone = normalize(phone)
    const contact = CONTACTS.find(c => normalize(c.phone) === cleanPhone)
    if (!contact) return null

    const subjects = ANIMALS
      .filter(a => a.contact_id === contact.id)
      .map(a => ({ id: a.id, name: a.name, species: a.species }))

    return {
      id: contact.id,
      firstName: contact.first_name,
      lastName: contact.last_name,
      subjects,
    }
  }

  async getAppointmentTypes() {
    return APPOINTMENT_TYPES.map(t => ({
      id: t.id,
      name: t.name,
      durationMinutes: t.duration,
    }))
  }

  async getAppointments(contactId) {
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const upcoming = APPOINTMENTS.filter(
      a => a.contact_id === contactId &&
           a.status !== 'cancelled' &&
           a.start >= now
    )
    return upcoming.map(a => {
      const animal   = ANIMALS.find(an => an.id === a.animal_id)
      const type     = APPOINTMENT_TYPES.find(t => t.id === a.appointment_type_id)
      const resource = RESOURCES.find(r => r.id === a.resource_id)
      return {
        id:            a.id,
        animalName:    animal   ? animal.name    : 'Unknown',
        animalSpecies: animal   ? animal.species : 'Unknown',
        serviceName:   type     ? type.name      : 'Visit',
        resourceName:  resource ? resource.name  : 'Unknown',
        start:         a.start,
        end:           a.end,
        status:        a.status,
      }
    })
  }

  async cancelAppointment(appointmentId) {
    const appt = APPOINTMENTS.find(a => a.id === appointmentId)
    if (!appt) throw new Error(`Appointment ${appointmentId} not found`)
    if (appt.status === 'cancelled') throw new Error(`Appointment ${appointmentId} is already cancelled`)
    appt.status = 'cancelled'
    return { success: true, appointmentId }
  }

  // Shared with getAppointments' mapping — pulled out so rescheduleAppointment can
  // snapshot the OLD appointment's canonical shape before cancelling it out from
  // under itself.
  _toCanonicalAppointment(a) {
    const animal   = ANIMALS.find(an => an.id === a.animal_id)
    const type     = APPOINTMENT_TYPES.find(t => t.id === a.appointment_type_id)
    const resource = RESOURCES.find(r => r.id === a.resource_id)
    return {
      id:           a.id,
      animalName:   animal   ? animal.name   : 'Unknown',
      serviceName:  type     ? type.name     : 'Visit',
      resourceName: resource ? resource.name : 'Unknown',
      start:        a.start,
      end:          a.end,
    }
  }

  // ezyVet's mock has no native "update appointment" endpoint, so this composes
  // from the two existing methods — exactly the variance the adapter pattern
  // exists for. Ordering is mandatory, per NEXT_SESSION: create the new
  // appointment FIRST, cancel the old one SECOND. If creation throws, nothing
  // has changed and the caller still holds their original slot — that's the
  // whole reason for this order and it must never be reversed.
  async rescheduleAppointment(appointmentId, newSlot) {
    const oldAppt = APPOINTMENTS.find(a => a.id === appointmentId)
    if (!oldAppt) throw new Error(`Appointment ${appointmentId} not found`)
    if (oldAppt.status === 'cancelled') {
      throw new Error(`Appointment ${appointmentId} is already cancelled`)
    }

    const oldSnapshot = this._toCanonicalAppointment(oldAppt)

    // Step 1: create the new appointment. Preserves the same client/pet link
    // as the old one; appointmentTypeId/resourceId default to the old
    // appointment's values (same service, same provider) unless the caller
    // is also changing those.
    const newAppointment = await this.bookAppointment({
      date: newSlot.date,
      time: newSlot.time,
      appointmentTypeId: newSlot.appointmentTypeId || oldAppt.appointment_type_id,
      resourceId: newSlot.resourceId || oldAppt.resource_id,
      contactId: oldAppt.contact_id,
      animalId: oldAppt.animal_id,
    })

    // Step 2: cancel the old one, now that the new one is confirmed to exist.
    try {
      await this.cancelAppointment(appointmentId)
    } catch (cancelErr) {
      // Residual risk case, called out explicitly in NEXT_SESSION: the new
      // appointment exists but the old one failed to cancel. This is the
      // strictly SAFER failure mode than the reverse order (caller left with
      // nothing) — a duplicate booking, not a lost one — but it must be
      // surfaced as a flagged task, never silently swallowed.
      return {
        oldAppointment: oldSnapshot,
        newAppointment,
        status: 'created_but_old_not_cancelled',
        needsStaffAttention: true,
        staffMessage:
          `Reschedule created appointment ${newAppointment.id} but failed to cancel ` +
          `original appointment ${appointmentId} (${cancelErr.message}). Manual cleanup ` +
          `needed to avoid a duplicate booking.`,
      }
    }

    return { oldAppointment: oldSnapshot, newAppointment, status: 'rescheduled' }
  }
}

module.exports = EzyVetAdapter