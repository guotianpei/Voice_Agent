/**
 * Turns canonical domain objects (returned by any adapter) into the natural-language
 * `result` string Vapi speaks back to the caller. Kept separate from the adapter layer
 * on purpose: phrasing is a voice/business-vertical concern, not a PMS concern — a
 * grooming shop's phrasing will eventually differ from a vet clinic's even when both
 * are working from the exact same adapter response shape.
 */
function formatAvailability({ requestedDate, matchedDate, slots }) {
  const list = slots.map(s => s.start.split(' ')[1] + ' with ' + s.resourceName).join(', ')

  if (matchedDate === requestedDate) {
    return 'Available slots on ' + requestedDate + ': ' + list
  }
  if (matchedDate) {
    return 'No availability on ' + requestedDate + '. The next available date is ' +
      matchedDate + ': ' + list
  }
  return 'No availability on ' + requestedDate + ' or any upcoming dates in our system right now.'
}

function formatBookingConfirmation(appointment) {
  return 'Appointment confirmed: ' + appointment.serviceName + ' on ' + appointment.date +
    ' at ' + appointment.time + ' with ' + appointment.resourceName +
    '. Confirmation number: ' + appointment.confirmationNumber + '.'
}

function formatContactLookup(contact) {
  if (!contact) return 'No existing client found for this phone number.'
  const petList = contact.subjects.map(s => s.name + ' (' + s.species + ')').join(' and ')
  return 'Found client ' + contact.firstName + ' ' + contact.lastName + ' with pets: ' + petList + '.'
}

function formatAppointmentTypes(types) {
  const list = types.map(t => t.name).join(', ')
  return 'Available appointment types: ' + list + '.'
}

// Reschedule is the highest-risk hallucination surface in the product — the LLM is
// holding an OLD date and a NEW date at once. Every date/time/name spoken here comes
// directly from oldAppointment/newAppointment as returned by the adapter; nothing is
// re-derived or guessed at in this function.
function formatReschedule({ oldAppointment, newAppointment, status, staffMessage }) {
  if (status === 'created_but_old_not_cancelled') {
    return 'Your new appointment is booked for ' + newAppointment.date + ' at ' + newAppointment.time +
      ' with ' + newAppointment.resourceName + ', confirmation number ' + newAppointment.confirmationNumber +
      '. I ran into an issue cancelling your original appointment, so our staff will follow up to make sure ' +
      'nothing is double-booked.'
  }

  const [oldDate, oldTime] = oldAppointment.start.split(' ')
  return 'Done — I moved ' + oldAppointment.animalName + '\'s ' + oldAppointment.serviceName +
    ' from ' + oldDate + ' at ' + oldTime + ' to ' + newAppointment.date + ' at ' + newAppointment.time +
    ' with ' + newAppointment.resourceName + '. New confirmation number: ' + newAppointment.confirmationNumber + '.'
}

module.exports = {
  formatAvailability,
  formatBookingConfirmation,
  formatContactLookup,
  formatAppointmentTypes,
  formatReschedule,
}