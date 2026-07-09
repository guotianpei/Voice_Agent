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
}

module.exports = PMSAdapter