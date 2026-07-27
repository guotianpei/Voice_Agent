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
  formatReschedule,
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

  // `result` is what the assistant SPEAKS. `slots` is the same data in
  // structured form — specifically so resource_id travels alongside each
  // slot as a real field, not something the model has to reverse-engineer
  // from a doctor's name in the spoken text. Fixes the gap flagged in
  // buildAssistantPayload.js: bookAppointment needs resource_id, and until
  // now the ONLY place it existed was inside the prose string.
  res.json({
    result: formatAvailability(availability),
    slots: availability.slots.map((s) => ({
      start: s.start,
      end: s.end,
      resource_id: s.resourceId,
      resource_name: s.resourceName,
    })),
  })
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

// GET APPOINTMENTS
router.post('/get-appointments', async (req, res) => {
  try {
    const { contact_id } = req.body
    if (!contact_id) return res.status(400).json({ error: 'contact_id is required' })

    const adapter = adapterRegistry.get(req.tenant.pmsType, req.tenant.pmsCredentials)
    const appointments = await adapter.getAppointments(contact_id)

    if (appointments.length === 0) {
      return res.json({
        found: false,
        message: "I don't see any upcoming appointments on file for you.",
        appointments: [],
      })
    }

    const list = appointments.map(a => {
      const [date, time] = a.start.split(' ')
      return `${a.animalName}'s ${a.serviceName} on ${date} at ${time} with ${a.resourceName} (ID: ${a.id})`
    }).join('; ')

    return res.json({
      found: true,
      count: appointments.length,
      appointments,
      message: `I found ${appointments.length} upcoming appointment${appointments.length > 1 ? 's' : ''}: ${list}.`,
    })
  } catch (err) {
    console.error('getAppointments error:', err.message)
    return res.status(500).json({ error: 'Could not retrieve appointments' })
  }
})

// CANCEL APPOINTMENT
router.post('/cancel-appointment', async (req, res) => {
  try {
    const { appointment_id } = req.body
    if (!appointment_id) return res.status(400).json({ error: 'appointment_id is required' })

    const adapter = adapterRegistry.get(req.tenant.pmsType, req.tenant.pmsCredentials)
    const result = await adapter.cancelAppointment(appointment_id)

    return res.json({
      success: true,
      appointmentId: result.appointmentId,
      message: "Your appointment has been cancelled. Is there anything else I can help you with, like scheduling a new appointment?",
    })
  } catch (err) {
    console.error('cancelAppointment error:', err.message)
    return res.status(500).json({ error: err.message || 'Could not cancel appointment' })
  }
})


// RESCHEDULE APPOINTMENT
// Disambiguation (which appointment the caller means) happens in the system
// prompt using getAppointments' results before this is ever called — exactly
// two upcoming appointments: ask which one; three or more: hand off to staff.
// This route always takes one specific appointment_id, already resolved.
router.post('/reschedule-appointment', async (req, res) => {
  try {
    const { appointment_id, time, appointment_type_id, resource_id } = req.body
    if (!appointment_id) return res.status(400).json({ error: 'appointment_id is required' })

    const date = resolveDate(req.body.date)
    if (!date) {
      return res.status(400).json({ error: `Could not understand date: "${req.body.date}"` })
    }

    // Same clinic-hours/booking-window gate as booking a fresh appointment —
    // an appointment already existing shouldn't let a reschedule bypass the
    // rule that a fresh booking would've been rejected under.
    const verdict = validateRequestedDate(req.tenant.config, date)
    if (!verdict.ok) {
      return res.json({ result: verdict.message })
    }

    const adapter = adapterRegistry.get(req.tenant.pmsType, req.tenant.pmsCredentials)
    const outcome = await adapter.rescheduleAppointment(appointment_id, {
      date,
      time,
      appointmentTypeId: appointment_type_id,
      resourceId: resource_id,
    })

    return res.json({ ...outcome, result: formatReschedule(outcome) })
  } catch (err) {
    console.error('rescheduleAppointment error:', err.message)
    return res.status(500).json({ error: err.message || 'Could not reschedule appointment' })
  }
})

router.post('/lookup-contact', async (req, res) => {
  const adapter = adapterRegistry.get(req.tenant.pmsType, req.tenant.pmsCredentials)
  const contact = await adapter.lookupContact(req.body.phone)
  if (!contact) {
    return res.json({ result: formatContactLookup(null) })
  }
  res.json({ 
    result: formatContactLookup(contact),
    contact_id: contact.id
  })
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