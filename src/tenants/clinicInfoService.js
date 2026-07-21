'use strict';

/**
 * clinicInfoService.js
 * Selects the requested slice of clinic info and returns STRUCTURED data.
 * No phrasing here (that's the formatter) and no PMS/adapter calls — clinic
 * info is tenant config, never ezyVet. Hours are grounded via clinicHours so
 * the model never reasons about "now" itself.
 */

const { getHoursContext, formatIntervals } = require('./clinicHours');

const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function formatAddress(a) {
  if (!a) return null;
  if (a.formatted) return a.formatted; // onboarding stores address as one flat string
  const l2 = a.line2 ? `, ${a.line2}` : '';
  return `${a.line1}${l2}, ${a.city}, ${a.state} ${a.postalCode}`;
}

function weeklyHours(clinicInfo) {
  return DAY_ORDER.map(d => ({
    day: d,
    hours: formatIntervals(clinicInfo.hours.regular[d])
  }));
}

/**
 * @param {object} clinicInfo  the tenant's clinicInfo block
 * @param {string} topic       hours | address | doctors | services | logistics | general
 * @param {Date}   now
 */
function getClinicInfo(clinicInfo, topic, now = new Date()) {
  switch (topic) {
    case 'hours': {
      const ctx = getHoursContext(clinicInfo, now);
      return { ...ctx, weekly: weeklyHours(clinicInfo) };
    }
    case 'address':
      return {
        address: clinicInfo.address,
        formattedAddress: formatAddress(clinicInfo.address)
      };
    case 'doctors':
      return { doctors: clinicInfo.doctors || [] };
    case 'services':
      return { services: clinicInfo.services || [] };
    case 'logistics':
      return { logistics: clinicInfo.logistics || {} };
    case 'general':
    default: {
      const ctx = getHoursContext(clinicInfo, now);
      return {
        displayName: clinicInfo.displayName,
        phone: clinicInfo.phone,
        formattedAddress: formatAddress(clinicInfo.address),
        isOpenNow: ctx.isOpenNow,
        todayHours: ctx.todayHours,
        closesAt: ctx.closesAt,
        nextOpen: ctx.nextOpen
      };
    }
  }
}

module.exports = { getClinicInfo, formatAddress, weeklyHours };
