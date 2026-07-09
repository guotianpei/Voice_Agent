const PMSAdapter = require('./pmsAdapter')
const { APPOINTMENT_TYPES, RESOURCES, AVAILABLE_SLOTS, CONTACTS, ANIMALS } = require('../mocks/pmsData')

/**
 * EzyVetAdapter — talks to ezyVet (currently: the mock data standing in for it, later:
 * the real ezyVet OAuth + ezyCAB endpoints). Every method translates ezyVet's field names
 * into the canonical shapes defined in PMSAdapter — this is the ONLY file in the codebase
 * that should ever know about ezyVet's actual data structure.
 */
class EzyVetAdapter extends PMSAdapter {
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

  async bookAppointment({ date, time, appointmentTypeId, resourceId }) {
    const resource = RESOURCES.find(r => r.id === resourceId)
    const type = APPOINTMENT_TYPES.find(t => t.id === appointmentTypeId)
    return {
      confirmationNumber: 'MOCK-' + Date.now(),
      date,
      time,
      serviceName: type ? type.name : 'Visit',
      resourceName: resource ? resource.name : 'unknown',
    }
  }

  async lookupContact(phone) {
    const cleanPhone = (phone || '').replace(/\D/g, '')
    const contact = CONTACTS.find(c => c.phone === cleanPhone)
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
}

module.exports = EzyVetAdapter