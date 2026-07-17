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
