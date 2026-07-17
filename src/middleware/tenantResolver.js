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
