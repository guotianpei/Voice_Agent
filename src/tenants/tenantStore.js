const pool = require('../db/pool')

/**
 * Looks up a tenant by ID. Returns null if not found — callers must treat
 * null as "reject the request," never fall back to a default tenant.
 *
 * Joins tenant_configs (populated by the Jotform onboarding webhook) so the
 * clinic's self-served configuration rides along as `config`. A tenant with
 * no onboarding row gets config: null and all routes behave as before.
 */
async function getTenantConfig(tenantId) {
  const { rows } = await pool.query(
    `select t.tenant_id, t.clinic_name, t.vertical, t.pms_type, t.pms_credentials,
            c.config as onboarding_config
       from tenants t
       left join tenant_configs c on c.tenant_id = t.tenant_id
      where t.tenant_id = $1`,
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
    config: row.onboarding_config || null,
  }
}

module.exports = { getTenantConfig }
