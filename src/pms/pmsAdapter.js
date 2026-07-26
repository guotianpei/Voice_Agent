/**
 * PMSAdapter defines the contract every practice-management-system adapter must satisfy.
 * Route handlers should only ever call these four methods — never a PMS's raw data or API
 * directly. Every method returns canonical domain shapes (documented below), not PMS-specific
 * field names, so nothing above this layer needs to know which PMS is actually being called.
 */
class PMSAdapter {
  // async checkAvailability(date: 'YYYY-MM-DD') -> AvailabilityResult
  //   AvailabilityResult: { requestedDate, matchedDate, slots: TimeSlot[] }
  //   TimeSlot: { start, end, resourceId, resourceName }
  //   matchedDate === requestedDate when the requested date has openings.
  //   matchedDate is a different (later) date when the adapter had to look ahead.
  //   matchedDate is null when nothing is available on or after the requested date.
  async checkAvailability(date) {
    throw new Error('checkAvailability not implemented')
  }

  // async bookAppointment({ date, time, appointmentTypeId, resourceId }) -> Appointment
  //   Appointment: { confirmationNumber, date, time, serviceName, resourceName }
  async bookAppointment(params) {
    throw new Error('bookAppointment not implemented')
  }

  // async lookupContact(phone: string) -> Contact | null
  //   Contact: { id, firstName, lastName, subjects: [{ id, name, species }] }
  async lookupContact(phone) {
    throw new Error('lookupContact not implemented')
  }

  // async getAppointmentTypes() -> Service[]
  //   Service: { id, name, durationMinutes }
  async getAppointmentTypes() {
    throw new Error('getAppointmentTypes not implemented')
  }


  // async getAppointments(contactId: string) -> Appointment[]
  //   Appointment: { id, animalName, animalSpecies, serviceName, resourceName, start, status }
  async getAppointments(contactId) {
    throw new Error('getAppointments not implemented')
  }

  // async cancelAppointment(appointmentId: string) -> { success, appointmentId }
  async cancelAppointment(appointmentId) {
    throw new Error('cancelAppointment not implemented')
  }

  // async rescheduleAppointment(appointmentId: string, newSlot) -> RescheduleResult
  //   newSlot: { date, time, appointmentTypeId?, resourceId? } — appointmentTypeId/resourceId
  //     default to the old appointment's values when omitted (same service, same provider,
  //     new time).
  //   RescheduleResult: { oldAppointment, newAppointment, status }
  //     oldAppointment: { id, animalName, serviceName, resourceName, start, end }
  //     newAppointment: { id, confirmationNumber, date, time, serviceName, resourceName }
  //     status: 'rescheduled' | 'created_but_old_not_cancelled'
  //   A PMS with native appointment-update support should override this with a single
  //   API call. A PMS without one (like the mock ezyVet adapter today) composes it from
  //   bookAppointment + cancelAppointment — see EzyVetAdapter for the create-before-cancel
  //   ordering that makes that composition safe.
  async rescheduleAppointment(appointmentId, newSlot) {
    throw new Error('rescheduleAppointment not implemented')
  }
}

module.exports = PMSAdapter