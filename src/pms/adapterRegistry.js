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
