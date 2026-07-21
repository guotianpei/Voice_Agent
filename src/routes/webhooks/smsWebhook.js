'use strict';

/**
 * smsWebhook.js
 * Handles inbound SMS from clinic staff to control the AI voice agent.
 * Twilio sends form-encoded POST: From, To, Body fields.
 *
 * Commands: ON | OFF | OFF <duration> | STATUS | HELP
 * Tenant resolved by From number (Option A — single HaloVox number).
 */

const express = require('express');
const router = express.Router();

const {
  getControlState,
  setControlState,
  resolveTenantByPhone,
  getUsageSummary,
  expiryFromDuration,
} = require('../../tenants/agentControl');

const poolModule = require('../../db/pool');
const pool = poolModule.pool || poolModule;

// ---------- TwiML response helper ----------
// Twilio expects TwiML XML; for SMS we return <Response><Message>...</Message></Response>

function twiml(text) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${text}</Message></Response>`;
}

// ---------- Command parser ----------
// Forgiving: case-insensitive, tolerates punctuation and surrounding words

function parseCommand(body) {
  const s = body.trim().toUpperCase().replace(/[!?.]+$/, '');

  // OFF <duration> — must check before bare OFF
  const offDuration = s.match(/\bOFF\s+(\d+\s*[HM](?:\s*\d+\s*[HM])?)/);
  if (offDuration) return { cmd: 'OFF_DURATION', arg: offDuration[1].trim() };

  // Bare ON / OFF / STATUS / HELP — tolerant of surrounding words
  if (/\bON\b/.test(s) && !/\bOFF\b/.test(s)) return { cmd: 'ON' };
  if (/\bOFF\b/.test(s)) return { cmd: 'OFF' };
  if (/\bSTATUS\b/.test(s)) return { cmd: 'STATUS' };
  if (/\bHELP\b/.test(s)) return { cmd: 'HELP' };

  // Natural language fallbacks
  if (/TURN.*(ON|BACK ON|RESUME)/.test(s)) return { cmd: 'ON' };
  if (/TURN.*(OFF|PAUSE|STOP)/.test(s)) return { cmd: 'OFF' };
  if (/(PAUSE|STOP|DISABLE)/.test(s)) return { cmd: 'OFF' };
  if (/(RESUME|ENABLE|START)/.test(s)) return { cmd: 'ON' };

  return { cmd: 'UNKNOWN' };
}

// ---------- Format expiry in clinic-local time ----------

function formatExpiry(expiry, timezone) {
  if (!expiry) return null;
  return new Date(expiry).toLocaleString('en-US', {
    timeZone: timezone || 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

// ---------- Fetch clinic timezone ----------

async function getClinicTimezone(tenantId) {
  try {
    const { rows } = await pool.query(
      `SELECT c.config->>'business_profile' as bp
       FROM tenant_configs c WHERE c.tenant_id = $1`,
      [tenantId]
    );
    if (rows[0]?.bp) {
      const bp = JSON.parse(rows[0].bp);
      return bp.timezone || 'America/New_York';
    }
  } catch (e) {
    // ignore
  }
  return 'America/New_York';
}

// ---------- Command handlers ----------

async function handleOn(tenantId, state, timezone) {
  await setControlState(tenantId, {
    mode: 'force_on',
    override_expiry: null,
    last_changed_by: 'sms',
  });
  return 'HaloVox is now answering all calls. Text OFF to pause anytime.';
}

async function handleOff(tenantId, state, timezone) {
  await setControlState(tenantId, {
    mode: 'force_off',
    override_expiry: null,
    last_changed_by: 'sms',
  });
  const behavior = state?.off_behavior === 'voicemail' ? 'New calls will go to voicemail.' : 'New calls will be forwarded.';
  return `HaloVox is paused. ${behavior} Text ON to resume anytime.`;
}

async function handleOffDuration(tenantId, state, timezone, durationStr) {
  const expiry = expiryFromDuration(durationStr);
  if (!expiry) {
    return 'Sorry, I didn\'t understand that duration. Try: OFF 2H, OFF 30M, OFF 1H30M.';
  }
  await setControlState(tenantId, {
    mode: 'force_off_until',
    override_expiry: expiry.toISOString(),
    last_changed_by: 'sms',
  });
  const resumeAt = formatExpiry(expiry, timezone);
  const behavior = state?.off_behavior === 'voicemail' ? 'New calls will go to voicemail.' : 'New calls will be forwarded.';
  return `HaloVox is paused until ${resumeAt}. ${behavior} Text ON to resume early anytime.`;
}

async function handleStatus(tenantId, state, timezone) {
  if (!state) {
    return 'HaloVox status: active (default). Text HELP for commands.';
  }

  const usage = await getUsageSummary(tenantId);
  const usageStr = usage
    ? `You've used ${usage.usage_count} of ${usage.usage_cap} included calls this month.`
    : '';

  let statusStr;
  if (state.mode === 'force_on') {
    statusStr = 'HaloVox is answering all calls (manually enabled).';
  } else if (state.mode === 'force_off') {
    statusStr = 'HaloVox is paused (manually disabled).';
  } else if (state.mode === 'force_off_until') {
    const resumeAt = formatExpiry(state.override_expiry, timezone);
    statusStr = `HaloVox is paused until ${resumeAt}.`;
  } else {
    statusStr = 'HaloVox is following its schedule (auto mode).';
  }

  return [statusStr, usageStr].filter(Boolean).join(' ');
}

function handleHelp() {
  return [
    'HaloVox commands:',
    'ON — resume answering calls',
    'OFF — pause until you text ON',
    'OFF 2H — pause for 2 hours',
    'STATUS — check current state & usage',
    'HELP — show this menu',
  ].join('\n');
}

function handleUnknown() {
  return [
    'Sorry, I didn\'t recognize that. HaloVox commands:',
    'ON, OFF, OFF 2H, STATUS, HELP',
  ].join('\n');
}

// ---------- Route ----------

router.post('/sms', async (req, res) => {
  res.set('Content-Type', 'text/xml');

  try {
    const from = (req.body.From || '').replace(/\D/g, '').slice(-10);
    const body = req.body.Body || '';

    if (!from || !body) {
      return res.send(twiml('Missing sender or message body.'));
    }

    // Resolve tenant by sender phone (Option A)
    const tenantId = await resolveTenantByPhone(from);
    if (!tenantId) {
      console.warn(`SMS from unauthorized number: ${from}`);
      return res.send(twiml('This number isn\'t set up to control HaloVox. Please contact your administrator.'));
    }

    const state = await getControlState(tenantId);
    const timezone = await getClinicTimezone(tenantId);
    const { cmd, arg } = parseCommand(body);

    console.log(`📱 SMS command from ${from} (tenant ${tenantId}): ${cmd} ${arg || ''}`);

    let reply;
    switch (cmd) {
      case 'ON':           reply = await handleOn(tenantId, state, timezone); break;
      case 'OFF':          reply = await handleOff(tenantId, state, timezone); break;
      case 'OFF_DURATION': reply = await handleOffDuration(tenantId, state, timezone, arg); break;
      case 'STATUS':       reply = await handleStatus(tenantId, state, timezone); break;
      case 'HELP':         reply = handleHelp(); break;
      default:             reply = handleUnknown();
    }

    return res.send(twiml(reply));

  } catch (err) {
    console.error('SMS webhook error:', err.message);
    return res.send(twiml('Something went wrong. Please try again or call the clinic directly.'));
  }
});

module.exports = router;