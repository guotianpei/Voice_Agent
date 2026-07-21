'use strict';

/**
 * tenantConfig.example.js
 * Example tenant record. The `clinicInfo` block is the new part — static,
 * non-PMS facts the getClinicInfo tool serves directly from config.
 *
 * `hours.regular` is keyed by lowercase weekday; an empty array = closed.
 * Multiple intervals per day model lunch closures. `hours.exceptions` is
 * keyed by YYYY-MM-DD (clinic-local) and overrides that day entirely — an
 * empty array closes the clinic (holiday), a populated array is a special
 * schedule (early close).
 *
 * The `doctors` names double as the single source of truth for the Deepgram
 * keyterm proper-noun list (assembled at provisioning), so you never maintain
 * clinic names in two places.
 */

module.exports = {
  tenantId: 'cedar-hollow',
  businessType: 'veterinary',

  clinicInfo: {
    displayName: 'Cedar Hollow Animal Hospital',
    phone: '(434) 555-0199',
    address: {
      line1: '128 Cedar Hollow Road',
      line2: 'Suite B',
      city: 'Charlottesville',
      state: 'VA',
      postalCode: '22902',
      country: 'US'
    },
    timezone: 'America/New_York', // IANA zone — drives all open/closed math

    hours: {
      regular: {
        sunday: [],
        monday: [{ open: '08:00', close: '12:00' }, { open: '13:00', close: '17:30' }],
        tuesday: [{ open: '08:00', close: '17:30' }],
        wednesday: [{ open: '08:00', close: '17:30' }],
        thursday: [{ open: '08:00', close: '17:30' }],
        friday: [{ open: '08:00', close: '17:00' }],
        saturday: [{ open: '09:00', close: '13:00' }]
      },
      exceptions: {
        '2026-07-03': [],                                   // closed — Independence Day (observed)
        '2026-12-24': [{ open: '08:00', close: '12:00' }],  // Christmas Eve — early close
        '2026-12-25': []                                    // closed — Christmas
      }
    },

    doctors: [
      { name: 'Dr. Priya Raman', title: 'DVM', focus: 'Internal medicine' },
      { name: 'Dr. Marcus Webb', title: 'DVM', focus: 'Surgery' },
      { name: 'Dr. Ellen Ortiz', title: 'DVM' }
    ],

    services: [
      'Wellness exams', 'Vaccinations', 'Dental cleanings',
      'Soft-tissue surgery', 'Diagnostics & bloodwork', 'Microchipping'
    ],

    logistics: {
      parking: 'Free lot on the north side of the building; overflow street parking on Cedar Hollow Road.',
      entrance: 'Main entrance faces the parking lot; a separate cat-only entrance is on the left.',
      accessibility: 'Ramp access at the main entrance.'
    }
  }
};
