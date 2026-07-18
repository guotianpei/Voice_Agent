#!/bin/bash
set -e

mkdir -p src/utils

cat > src/utils/resolveDate.js << 'EOF'
const chrono = require('chrono-node')

/**
 * Resolves whatever the caller said ("next Monday", "July 21st", "tomorrow",
 * or an already-clean "2026-07-20") into a YYYY-MM-DD string, using the
 * server's own clock as the reference — never the LLM's arithmetic. This is
 * why the checkAvailability tool schema should stop asking the assistant to
 * pre-convert dates: pass along the caller's own words instead, and let this
 * function do the one thing LLMs are unreliable at.
 */
function resolveDate(raw, referenceDate = new Date()) {
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  const parsed = chrono.parseDate(raw, referenceDate)
  if (!parsed) return null

  const y = parsed.getFullYear()
  const m = String(parsed.getMonth() + 1).padStart(2, '0')
  const d = String(parsed.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

module.exports = resolveDate
EOF

cat > src/routes/toolCalls.js << 'EOF'
const express = require('express')
const router = express.Router()
const adapterRegistry = require('../pms/adapterRegistry')
const tenantResolver = require('../middleware/tenantResolver')
const resolveDate = require('../utils/resolveDate')
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
  const availability = await adapter.checkAvailability(date)
  res.json({ result: formatAvailability(availability) })
})

router.post('/book-appointment', async (req, res) => {
  const adapter = adapterRegistry.get(req.tenant.pmsType, req.tenant.pmsCredentials)
  const { time, appointment_type_id, resource_id } = req.body
  const date = resolveDate(req.body.date)
  if (!date) {
    return res.status(400).json({ error: `Could not understand date: "${req.body.date}"` })
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
  const adapter = adapterRegistry.get(req.tenant.pmsType, req.tenant.pmsCredentials)
  const types = await adapter.getAppointmentTypes()
  res.json({ result: formatAppointmentTypes(types) })
})

module.exports = router
EOF

npm install chrono-node --save

echo ""
echo "Done. git add -A && git commit -m 'Resolve caller dates server-side with chrono-node instead of relying on LLM arithmetic' && git push"
