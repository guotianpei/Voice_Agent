const express = require('express')
const router = express.Router()
const adapterRegistry = require('../pms/adapterRegistry')
const tenantResolver = require('../middleware/tenantResolver')
const {
  formatAvailability,
  formatBookingConfirmation,
  formatContactLookup,
  formatAppointmentTypes,
} = require('./responseFormatter')

// Every route resolves its tenant from tenant_id (a Vapi static parameter —
// see src/middleware/tenantResolver.js) before touching any adapter.
router.use(tenantResolver)

router.post('/check-availability', async (req, res) => {
  const adapter = adapterRegistry.get(req.tenant.pmsType, req.tenant.pmsCredentials)
  const { date } = req.body
  const availability = await adapter.checkAvailability(date)
  res.json({ result: formatAvailability(availability) })
})

router.post('/book-appointment', async (req, res) => {
  const adapter = adapterRegistry.get(req.tenant.pmsType, req.tenant.pmsCredentials)
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
  const adapter = adapterRegistry.get(req.tenant.pmsType, req.tenant.pmsCredentials)
  const contact = await adapter.lookupContact(req.body.phone)
  res.json({ result: formatContactLookup(contact) })
})

router.post('/appointment-types', async (req, res) => {
  const adapter = adapterRegistry.get(req.tenant.pmsType, req.tenant.pmsCredentials)
  const types = await adapter.getAppointmentTypes()
  res.json({ result: formatAppointmentTypes(types) })
})

module.exports = router
