const express = require('express')
const router = express.Router()
const adapterRegistry = require('../pms/adapterRegistry')
const tenantResolver = require('../middleware/tenantResolver')
const resolveDate = require('../utils/resolveDate')
const {
  validateRequestedDate,
  configuredAppointmentTypes,
  filterSlotsByStaff,
} = require('../config/businessRules')
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
  const date = resolveDate(req.body.date)
  if (!date) {
    return res.status(400).json({ error: `Could not understand date: "${req.body.date}"` })
  }

  // Clinic-configured rules (business hours, booking window) gate the PMS
  // call: no point asking the PMS about a day the clinic is closed. The
  // rejection is returned as `result` so the assistant SPEAKS it, rather
  // than as an HTTP error the assistant would have to improvise around.
  const verdict = validateRequestedDate(req.tenant.config, date)
  if (!verdict.ok) {
    return res.json({ result: verdict.message })
  }

  // PMS returns raw availability; the clinic's staff config then filters it
  // down to voice-bookable providers on their configured days.
  const availability = filterSlotsByStaff(req.tenant.config, await adapter.checkAvailability(date))
  res.json({ result: formatAvailability(availability) })
})

router.post('/book-appointment', async (req, res) => {
  const adapter = adapterRegistry.get(req.tenant.pmsType, req.tenant.pmsCredentials)
  const { time, appointment_type_id, resource_id } = req.body
  const date = resolveDate(req.body.date)
  if (!date) {
    return res.status(400).json({ error: `Could not understand date: "${req.body.date}"` })
  }

  // Same gate as check-availability: booking must not bypass clinic rules,
  // even if the assistant skipped the availability step.
  const verdict = validateRequestedDate(req.tenant.config, date)
  if (!verdict.ok) {
    return res.json({ result: verdict.message })
  }

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
  // Clinic-configured services take precedence over whatever the PMS lists:
  // the config is the clinic's chosen public menu (display names, what's
  // bookable by voice), while the PMS list is their internal catalog.
  const fromConfig = configuredAppointmentTypes(req.tenant.config)
  if (fromConfig) {
    return res.json({ result: formatAppointmentTypes(fromConfig) })
  }

  const adapter = adapterRegistry.get(req.tenant.pmsType, req.tenant.pmsCredentials)
  const types = await adapter.getAppointmentTypes()
  res.json({ result: formatAppointmentTypes(types) })
})

module.exports = router