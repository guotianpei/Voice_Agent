const express = require('express')
const router = express.Router()
const adapterRegistry = require('../pms/adapterRegistry')
const {
  formatAvailability,
  formatBookingConfirmation,
  formatContactLookup,
  formatAppointmentTypes,
} = require('./responseFormatter')

// Hardcoded for now — becomes tenant-resolved (via assistant ID / phone number lookup)
// once tenant config + the database exist. That's the only line that changes later.
const adapter = adapterRegistry.get('ezyvet')

router.post('/check-availability', async (req, res) => {
  const { date } = req.body
  const availability = await adapter.checkAvailability(date)
  res.json({ result: formatAvailability(availability) })
})

router.post('/book-appointment', async (req, res) => {
  const { date, time, appointment_type_id, resource_id } = req.body
  const appointment = await adapter.bookAppointment({
    date,
    time,
    appointmentTypeId: appointment_type_id,
    resourceId: resource_id,
  })
  res.json({ result: formatBookingConfirmation(appointment) })
})

router.post('/lookup-contact', async (req, res) => {
  const contact = await adapter.lookupContact(req.body.phone)
  res.json({ result: formatContactLookup(contact) })
})

router.post('/appointment-types', async (req, res) => {
  const types = await adapter.getAppointmentTypes()
  res.json({ result: formatAppointmentTypes(types) })
})

module.exports = router