'use strict';

/**
 * clinicHours.js
 * Pure, dependency-free helpers for computing a clinic's real-time
 * open/closed status from tenant config.
 *
 * Design note: the voice agent must never reason about "now" vs. a raw
 * hours string — LLMs hallucinate time math. These helpers return concrete,
 * pre-computed fields so the getClinicInfo tool hands the model facts, not
 * arithmetic. Same grounding approach used for checkAvailability.
 *
 * Not handled (by design, for the day-clinic MVP): intervals that cross
 * midnight (overnight/emergency hours). All intervals are assumed same-day.
 */

const WEEKDAY_KEYS = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'
];

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function formatTime(hhmm) {
  let [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h}:00 ${period}` : `${h}:${String(m).padStart(2, '0')} ${period}`;
}

function formatIntervals(intervals) {
  if (!intervals || intervals.length === 0) return 'Closed';
  return intervals.map(i => `${formatTime(i.open)}\u2013${formatTime(i.close)}`).join(', ');
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Extract clinic-local wall-clock parts using the clinic's IANA timezone,
 * independent of the server's timezone.
 */
function clinicLocalParts(now, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = fmt.formatToParts(now).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0; // some engines emit "24" at midnight
  return {
    weekday: parts.weekday.toLowerCase(),          // "monday"
    isoDate: `${parts.year}-${parts.month}-${parts.day}`, // YYYY-MM-DD
    minutes: hour * 60 + parseInt(parts.minute, 10)
  };
}

/**
 * Resolve the effective intervals for a weekday/date, applying any
 * date-specific exception (holiday closure, early close, etc.).
 * An exception key present with an empty array means "closed that day".
 */
function effectiveIntervals(clinicInfo, weekday, isoDate) {
  const hours = clinicInfo && clinicInfo.hours;
  if (!hours || !hours.regular) return [];   // no hours configured → treat as closed/unknown
  const exceptions = hours.exceptions || {};
  if (Object.prototype.hasOwnProperty.call(exceptions, isoDate)) {
    return exceptions[isoDate] || [];
  }
  return hours.regular[weekday] || [];
}

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekdayForIso(isoDate) {
  return WEEKDAY_KEYS[new Date(`${isoDate}T00:00:00Z`).getUTCDay()];
}

/**
 * Main entry point. Returns a single structured object the getClinicInfo
 * tool can return verbatim to the model.
 */
function getHoursContext(clinicInfo, now = new Date()) {
  const tz = clinicInfo.timezone;
  const { weekday, isoDate, minutes } = clinicLocalParts(now, tz);
  const todayIntervals = effectiveIntervals(clinicInfo, weekday, isoDate);

  let isOpenNow = false;
  let currentInterval = null;
  for (const iv of todayIntervals) {
    if (minutes >= toMinutes(iv.open) && minutes < toMinutes(iv.close)) {
      isOpenNow = true;
      currentInterval = iv;
      break;
    }
  }

  // Only compute nextOpen when currently closed.
  let nextOpen = null;
  if (!isOpenNow) {
    // A later interval today (e.g. reopening after lunch)?
    for (const iv of todayIntervals) {
      if (toMinutes(iv.open) > minutes) {
        nextOpen = { dayLabel: 'today', weekday, isoDate, time: formatTime(iv.open) };
        break;
      }
    }
    // Otherwise scan forward up to 7 days.
    if (!nextOpen) {
      for (let i = 1; i <= 7; i++) {
        const d = addDays(isoDate, i);
        const wd = weekdayForIso(d);
        const ivs = effectiveIntervals(clinicInfo, wd, d);
        if (ivs.length > 0) {
          nextOpen = {
            dayLabel: i === 1 ? 'tomorrow' : capitalize(wd),
            weekday: wd,
            isoDate: d,
            time: formatTime(ivs[0].open)
          };
          break;
        }
      }
    }
  }

  return {
    isOpenNow,
    todayHours: formatIntervals(todayIntervals),
    todayIntervals,
    closesAt: currentInterval ? formatTime(currentInterval.close) : null,
    nextOpen,          // null when currently open; otherwise { dayLabel, time, ... }
    weekday,
    localDate: isoDate,
    timezone: tz
  };
}

module.exports = { getHoursContext, formatIntervals, formatTime };
