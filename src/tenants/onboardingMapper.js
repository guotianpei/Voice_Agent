'use strict';

/**
 * onboardingMapper.js
 * Adapter between the Jotform onboarding `config` shape (as stored on
 * tenant.config) and the canonical clinicInfo shape the clinic-info engine
 * consumes. Same pattern as the PMS adapters: don't reshape data at rest,
 * don't rewrite the engine — translate between them here.
 *
 * Handles the two onboarding format quirks:
 *   - times are 12-hour with a space ("09 AM") -> 24-hour "HH:MM"
 *   - each day is a single {open,close} object -> array of intervals
 */

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// "09 AM" | "9:30 PM" | "22:00" -> "HH:MM" (24h). Returns null if unparseable.
function to24h(str) {
  if (!str) return null;
  const s = String(str).trim();
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const min = ampm[2] || '00';
    const period = ampm[3].toUpperCase();
    if (period === 'AM') { if (h === 12) h = 0; }
    else if (h !== 12) { h += 12; }
    return `${String(h).padStart(2, '0')}:${min}`;
  }
  const h24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) return `${String(parseInt(h24[1], 10)).padStart(2, '0')}:${h24[2]}`;
  return null;
}

function formatPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return p || null;
}

function mapHours(businessHours) {
  const regular = {};
  for (const day of WEEKDAYS) {
    const v = businessHours && businessHours[day];
    if (v && v.open && v.close) {
      const open = to24h(v.open);
      const close = to24h(v.close);
      regular[day] = (open && close) ? [{ open, close }] : []; // unparseable -> closed
    } else {
      regular[day] = []; // null / missing -> closed
    }
  }
  return { regular, exceptions: {} }; // holidays not collected yet -> no exceptions
}

function mapDoctors(staff) {
  const docs = (staff && staff.doctors) || [];
  return docs
    .filter(d => d && d.name)
    .map(d => ({ name: d.name, title: d.role || '' }));
}

function mapServices(services) {
  const mappings = (services && services.mappings) || [];
  return mappings
    .filter(m => m && m.enabled !== false && m.customer_facing_name)
    .map(m => m.customer_facing_name);
}

/**
 * @param {object} config  the tenant.config blob from onboarding
 * @returns canonical clinicInfo, or null if config is absent
 */
function mapOnboardingToClinicInfo(config) {
  if (!config) return null;
  const bp = config.business_profile || {};
  return {
    displayName: bp.name || null,
    phone: formatPhone(bp.phone),
    address: bp.address ? { formatted: bp.address } : null,
    timezone: bp.timezone || 'America/New_York',
    hours: mapHours(config.business_hours),
    doctors: mapDoctors(config.staff),
    services: mapServices(config.services),
    logistics: {} // not captured in onboarding
  };
}

module.exports = { mapOnboardingToClinicInfo, to24h, formatPhone };
