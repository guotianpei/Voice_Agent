#!/bin/bash
set -e

mkdir -p src/db src/tenants src/middleware migrations

cat > .gitignore << 'EOF'
node_modules/
.env
.env.local
*.log
EOF

cat > .env.example << 'EOF'
# Copy to .env for local (non-Codespaces) dev only.
# In Codespaces, set this as a repo secret instead:
# Settings -> Secrets and variables -> Codespaces -> New repository secret
DATABASE_URL=postgresql://user:password@ep-xxxx.neon.tech/dbname?sslmode=require
EOF

cat > src/db/pool.js << 'EOF'
const { Pool } = require('pg')

/**
 * Single shared connection pool, built from DATABASE_URL. Never reads or logs
 * the connection string itself — if this throws "DATABASE_URL is not set",
 * the fix is the Codespaces secret, not a code change.
 */
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. In Codespaces: Settings -> Secrets and variables -> ' +
    'Codespaces -> New repository secret, then rebuild the Codespace.'
  )
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // required for Neon
})

module.exports = pool
EOF

cat > migrations/001_create_tenants.sql << 'EOF'
-- Tenant config: one row per clinic. tenant_id must match the Vapi
-- assistant.id injected as a static parameter on every tool call
-- (see docs.vapi.ai/tools/static-variables-and-aliases).
create table if not exists tenants (
  tenant_id       text primary key,
  clinic_name     text not null,
  vertical        text not null default 'veterinary',
  pms_type        text not null,       -- 'mock' | 'ezyvet' | ...
  pms_credentials jsonb,               -- null until real PMS integration lands
  created_at      timestamptz not null default now()
);

-- Seed row for local/pilot testing against the mock adapter.
-- Replace tenant_id with your real Vapi assistant ID once you wire it up.
insert into tenants (tenant_id, clinic_name, vertical, pms_type, pms_credentials)
values ('mock-clinic-1', 'Test Clinic', 'veterinary', 'ezyvet', null)
on conflict (tenant_id) do nothing;
EOF

cat > src/tenants/tenantStore.js << 'EOF'
const pool = require('../db/pool')

/**
 * Looks up a tenant by ID. Returns null if not found — callers must treat
 * null as "reject the request," never fall back to a default tenant.
 */
async function getTenantConfig(tenantId) {
  const { rows } = await pool.query(
    'select tenant_id, clinic_name, vertical, pms_type, pms_credentials from tenants where tenant_id = $1',
    [tenantId]
  )
  if (rows.length === 0) return null

  const row = rows[0]
  return {
    tenantId: row.tenant_id,
    clinicName: row.clinic_name,
    vertical: row.vertical,
    pmsType: row.pms_type,
    pmsCredentials: row.pms_credentials,
  }
}

module.exports = { getTenantConfig }
EOF

cat > src/middleware/tenantResolver.js << 'EOF'
const { getTenantConfig } = require('../tenants/tenantStore')

/**
 * Resolves req.body.tenant_id (injected by Vapi as a static parameter —
 * {{ assistant.id }} — so it never comes from anything the caller said)
 * into req.tenant. Missing or unknown tenant_id hard-fails here rather
 * than falling back to a default clinic, since that fallback is exactly
 * the bug that would leak one clinic's data into another's call.
 */
async function tenantResolver(req, res, next) {
  const tenantId = req.body?.tenant_id

  if (!tenantId) {
    return res.status(400).json({
      error: 'Missing tenant_id. Check the Vapi tool\'s Static Body Fields config.',
    })
  }

  const tenant = await getTenantConfig(tenantId)
  if (!tenant) {
    return res.status(404).json({ error: `Unknown tenant_id: ${tenantId}` })
  }

  req.tenant = tenant
  next()
}

module.exports = tenantResolver
EOF

cat > src/pms/adapterRegistry.js << 'EOF'
const EzyVetAdapter = require('./ezyVetAdapter')

/**
 * Maps a PMS type string to an adapter class. get() instantiates a fresh
 * adapter per call, configured with that tenant's credentials — no shared
 * state between clinics. Adding a new PMS from here on is: write an adapter
 * class, register its constructor below. Nothing else changes.
 */
const adapterClasses = {
  ezyvet: EzyVetAdapter,
}

function get(pmsType, config) {
  const AdapterClass = adapterClasses[pmsType]
  if (!AdapterClass) throw new Error('No adapter registered for PMS type: ' + pmsType)
  return new AdapterClass(config)
}

module.exports = { get }
EOF

cat > src/pms/ezyVetAdapter.js << 'EOF'
const PMSAdapter = require('./pmsAdapter')
const { APPOINTMENT_TYPES, RESOURCES, AVAILABLE_SLOTS, CONTACTS, ANIMALS } = require('../mocks/pmsData')

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
EOF

cat > src/routes/toolCalls.js << 'EOF'
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
EOF

cat > src/index.js << 'EOF'
require('dotenv').config()
const express = require('express')
const app = express()

app.use(express.json())

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Vapi server webhook - handles call events
app.post('/webhook', (req, res) => {
  const { message } = req.body
  console.log('Webhook event:', message?.type)

  if (message?.type === 'assistant-request') {
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    const threeMonths = new Date()
    threeMonths.setMonth(threeMonths.getMonth() + 3)
    const windowEnd = threeMonths.toISOString().split('T')[0]

    return res.json({
      assistantOverrides: {
        variableValues: {
          today: todayStr,
          appointmentWindowEnd: windowEnd
        }
      }
    })
  }

  res.json({ received: true })
})

const toolCalls = require('./routes/toolCalls')
app.use('/tool-calls', toolCalls)

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Middleware running on port ${PORT}`)
})
EOF

npm install pg dotenv --save

git rm -r --cached node_modules > /dev/null 2>&1 || true

echo ""
echo "Done. Review with 'git status', then:"
echo "  git add -A && git commit -m 'Add multi-tenant framework: tenant resolver, Postgres-backed config, per-tenant adapter factory' && git push"
