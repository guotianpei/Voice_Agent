const EzyVetAdapter = require('./ezyVetAdapter')

/**
 * Maps a PMS type string to a live adapter instance. When tenant config + the database
 * exist (your next step), route handlers will look up tenant.pmsType and call
 * registry.get(tenant.pmsType) instead of the hardcoded 'ezyvet' used today. Adding a
 * new PMS from here on is: write an adapter class, register it below. Nothing else changes.
 */
const adapters = {
  ezyvet: new EzyVetAdapter(),
}

function get(pmsType) {
  const adapter = adapters[pmsType]
  if (!adapter) throw new Error('No adapter registered for PMS type: ' + pmsType)
  return adapter
}

module.exports = { get }