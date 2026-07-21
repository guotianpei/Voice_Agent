'use strict';

/**
 * clinicInfoFormatter.js
 * Voice phrasing for clinic-info responses — the phrasing layer, kept separate
 * from data (clinicInfoService) exactly like responseFormatter is separate from
 * PMS logic. Keep this file as-is, OR fold formatClinicInfo() into
 * src/routes/responseFormatter.js to match your existing phrasing layer; the
 * route only needs formatClinicInfo() from somewhere.
 *
 * The route returns BOTH the structured data AND this message string, so the
 * model has a ready phrase and the grounded facts behind it.
 */

// Speech-friendly join: "a", "a and b", "a, b, and c".
function sayList(items) {
  const xs = (items || []).filter(Boolean);
  if (xs.length === 0) return '';
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`;
}

function whenPhrase(nextOpen) {
  if (!nextOpen) return null;
  return nextOpen.dayLabel === 'today'
    ? `today at ${nextOpen.time}`
    : `${nextOpen.dayLabel} at ${nextOpen.time}`;
}

function hoursMessage(info, clinicInfo) {
  const name = clinicInfo.displayName;
  if (info.isOpenNow) {
    return info.closesAt
      ? `Yes, ${name} is open right now, until ${info.closesAt}.`
      : `Yes, ${name} is open right now.`;
  }
  const when = whenPhrase(info.nextOpen);
  return when
    ? `We're closed right now. ${name} reopens ${when}.`
    : `We're closed right now.`;
}

function formatClinicInfo(topic, info, clinicInfo) {
  switch (topic) {
    case 'hours':
      return hoursMessage(info, clinicInfo);

    case 'address':
      return `${clinicInfo.displayName} is at ${info.formattedAddress}.`;

    case 'doctors': {
      const names = (info.doctors || []).map(d => d.name);
      return names.length
        ? `Our veterinarians are ${sayList(names)}.`
        : `I'm sorry, I don't have that on hand.`;
    }

    case 'services':
      return (info.services || []).length
        ? `We offer ${sayList(info.services)}.`
        : `I'm sorry, I don't have our service list on hand.`;

    case 'logistics': {
      const l = info.logistics || {};
      // These are full sentences, so join with spaces (not a list join),
      // ensuring each ends with a period.
      const parts = [l.parking, l.entrance, l.accessibility]
        .filter(Boolean)
        .map(s => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`));
      return parts.length ? parts.join(' ') : `I'm sorry, I don't have that on hand.`;
    }

    case 'general':
    default: {
      const open = info.isOpenNow
        ? (info.closesAt ? `We're open until ${info.closesAt}.` : `We're open now.`)
        : (whenPhrase(info.nextOpen)
            ? `We're currently closed; we reopen ${whenPhrase(info.nextOpen)}.`
            : `We're currently closed.`);
      return `${clinicInfo.displayName}, ${info.formattedAddress}. ${open} You can reach us at ${clinicInfo.phone}.`;
    }
  }
}

module.exports = { formatClinicInfo };
