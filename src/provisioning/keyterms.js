'use strict';

/**
 * keyterms.js
 * Pure function — tenant config in, Deepgram keyterm list out. No network calls.
 *
 * Deepgram's keyterm cap (nova-3 family) is 100 terms per request. When the combined
 * baseline + clinic list would exceed that, clinic-specific terms ALWAYS win — they're
 * the names a caller will actually say and a generic model will actually mishear
 * ("Dr. Okonkwo", "Cedar Hollow Animal Hospital"). The generic baseline is truncated
 * first, and never the other way around.
 */

const KEYTERM_CAP = 100;

// Shared baseline: vaccine names, common meds/procedures, frequently-heard breed
// names. This list is deliberately generic-veterinary, not clinic-specific — it's
// the same for every tenant, which is why per-clinic terms must take priority when
// the two lists together blow the cap.
const BASELINE_VET_TERMS = [
  // Vaccines
  'rabies vaccine', 'DHPP', 'FVRCP', 'bordetella', 'leptospirosis vaccine',
  'canine influenza vaccine', 'feline leukemia vaccine', 'lyme vaccine',
  // Common medications
  'apoquel', 'cytopoint', 'rimadyl', 'gabapentin', 'trazodone', 'metacam',
  'heartgard', 'nexgard', 'simparica', 'bravecto', 'clavamox', 'metronidazole',
  'prednisone', 'tramadol',
  // Common procedures / visit types
  'spay', 'neuter', 'dental cleaning', 'wellness exam', 'annual exam',
  'bloodwork', 'x-ray', 'ultrasound', 'microchipping', 'nail trim',
  'euthanasia', 'anal gland expression', 'skin biopsy', 'fecal exam',
  'heartworm test', 'ear infection', 'urinary tract infection',
  // Frequently-heard breed names
  'labrador retriever', 'golden retriever', 'german shepherd', 'french bulldog',
  'chihuahua', 'dachshund', 'poodle', 'shih tzu', 'boxer', 'beagle',
  'maine coon', 'siamese', 'ragdoll', 'domestic shorthair',
];

// Pull per-clinic proper nouns out of the tenant's onboarding config. Kept
// defensive (every field optional) since a tenant mid-onboarding may have a
// partial config.
function clinicSpecificTerms(config) {
  const bp = (config && config.business_profile) || {};
  const staff = (config && config.staff) || {};
  const services = (config && config.services) || {};

  const terms = [];

  if (bp.name) terms.push(bp.name);

  const doctors = staff.doctors || [];
  for (const d of doctors) {
    if (d && d.name) terms.push(d.name);
  }

  const serviceMappings = services.mappings || [];
  for (const m of serviceMappings) {
    if (m && m.enabled !== false && m.customer_facing_name) {
      terms.push(m.customer_facing_name);
    }
  }

  // Drug brands are clinic-specific when the clinic stocks/prefers particular
  // brands; onboarding doesn't collect this yet, so this is a no-op today and
  // becomes real once that field exists — left here so callers don't need to
  // change when it does.
  const drugBrands = config && config.drug_brands;
  if (Array.isArray(drugBrands)) {
    for (const brand of drugBrands) {
      if (brand) terms.push(brand);
    }
  }

  return terms;
}

// Case-sensitive de-dupe (Deepgram guidance: send each keyword once).
function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const term of list) {
    const key = term.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * @param {object} config  tenant.config (the onboarding blob)
 * @returns {{ keyterms: string[], truncated: boolean, droppedBaselineCount: number }}
 */
function buildKeytermList(config) {
  const clinicTerms = dedupe(clinicSpecificTerms(config));
  const baseline = dedupe(BASELINE_VET_TERMS.filter((t) => !clinicTerms.includes(t)));

  const room = KEYTERM_CAP - clinicTerms.length;

  // Clinic list alone already at/over cap: clinic terms win outright, baseline
  // is dropped entirely. Never truncate the clinic list to make room for
  // baseline terms — that's the one thing this function must never do.
  if (room <= 0) {
    return {
      keyterms: clinicTerms.slice(0, KEYTERM_CAP),
      truncated: clinicTerms.length > KEYTERM_CAP,
      droppedBaselineCount: baseline.length,
    };
  }

  const keptBaseline = baseline.slice(0, room);
  return {
    keyterms: [...clinicTerms, ...keptBaseline],
    truncated: baseline.length > keptBaseline.length,
    droppedBaselineCount: baseline.length - keptBaseline.length,
  };
}

module.exports = { buildKeytermList, KEYTERM_CAP, BASELINE_VET_TERMS };
