'use strict';

const poolModule = require('../db/pool');
const pool = poolModule.pool || poolModule;
const { getHoursContext } = require('./clinicHours');

/**
 * agentControl.js
 * Runtime state resolver for AI Agent Control feature.
 * Determines effective on/off state for a tenant's voice agent.
 *
 * Effective state = resolve(schedule, override)
 * Override always wins. Auto-expiry reverts to schedule.
 */

// ---------- DB helpers ----------

async function getControlState(tenantId) {
  const { rows } = await pool.query(
    'SELECT * FROM agent_control WHERE tenant_id = $1',
    [tenantId]
  );
  return rows[0] || null;
}

async function setControlState(tenantId, fields) {
  const keys = Object.keys(fields);
  const values = Object.values(fields);
  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  await pool.query(
    `UPDATE agent_control SET ${setClauses}, last_changed_at = NOW() WHERE tenant_id = $1`,
    [tenantId, ...values]
  );
}

async function createControlState(tenantId, overrides = {}) {
  await pool.query(
    `INSERT INTO agent_control (tenant_id, mode, deployment_intent, off_behavior, authorized_numbers, usage_cap)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [
      tenantId,
      overrides.mode || 'auto',
      overrides.deployment_intent || 'after_hours_coverage',
      overrides.off_behavior || 'voicemail',
      overrides.authorized_numbers || [],
      overrides.usage_cap || 500,
    ]
  );
}

// ---------- Tenant resolution (Option A) ----------
// Find which tenant owns an authorized phone number

async function resolveTenantByPhone(phone) {
  const normalized = phone.replace(/\D/g, '').slice(-10);
  const { rows } = await pool.query(
    `SELECT tenant_id FROM agent_control
     WHERE authorized_numbers @> ARRAY[$1]::text[]
        OR authorized_numbers @> ARRAY[$2]::text[]`,
    [normalized, '+1' + normalized]
  );
  return rows[0]?.tenant_id || null;
}

// ---------- State resolver ----------

function isExpired(expiry) {
  if (!expiry) return false;
  return new Date(expiry) <= new Date();
}

/**
 * Resolve effective agent state for a tenant.
 * Returns { active: bool, reason: string, state: object }
 */
async function resolveEffectiveState(tenantId, clinicConfig) {
  const state = await getControlState(tenantId);

  // No control record → fail safe: default to active
  if (!state) {
    return { active: true, reason: 'no_control_record', state: null };
  }

  // Auto-expire overrides
  let mode = state.mode;
  if (mode === 'force_off_until' && isExpired(state.override_expiry)) {
    mode = 'auto';
    await setControlState(tenantId, { mode: 'auto', override_expiry: null });
  }

  if (mode === 'force_on') {
    return { active: true, reason: 'force_on', state };
  }

  if (mode === 'force_off' || mode === 'force_off_until') {
    return { active: false, reason: mode, state };
  }

  // Auto mode: follow clinic schedule
  if (mode === 'auto') {
    if (!clinicConfig) {
      return { active: true, reason: 'auto_no_config', state };
    }
    const hoursCtx = getHoursContext(clinicConfig);
    const intent = state.deployment_intent;

    if (intent === 'always_on') {
      return { active: true, reason: 'always_on', state };
    }

    if (intent === 'after_hours_coverage') {
      return { active: !hoursCtx.isOpenNow, reason: 'after_hours_coverage', state };
    }

    if (intent === 'during_hours') {
      return { active: hoursCtx.isOpenNow, reason: 'during_hours', state };
    }

    return { active: true, reason: 'auto_unknown_intent', state };
  }

  return { active: true, reason: 'fallback', state };
}

// ---------- Usage tracking ----------

async function incrementUsage(tenantId) {
  await pool.query(
    'UPDATE agent_control SET usage_count = usage_count + 1 WHERE tenant_id = $1',
    [tenantId]
  );
}

async function getUsageSummary(tenantId) {
  const state = await getControlState(tenantId);
  if (!state) return null;
  return {
    usage_count: state.usage_count,
    usage_cap: state.usage_cap,
    percent: Math.round((state.usage_count / state.usage_cap) * 100),
  };
}

// ---------- Duration parser ----------
// Parses "2H", "30M", "1H30M" → milliseconds

function parseDuration(str) {
  if (!str) return null;
  const s = str.toUpperCase().trim();
  const hours = s.match(/(\d+)\s*H/);
  const mins = s.match(/(\d+)\s*M/);
  if (!hours && !mins) return null;
  const ms = ((hours ? parseInt(hours[1]) : 0) * 60 + (mins ? parseInt(mins[1]) : 0)) * 60 * 1000;
  return ms > 0 ? ms : null;
}

function expiryFromDuration(durationStr) {
  const ms = parseDuration(durationStr);
  if (!ms) return null;
  return new Date(Date.now() + ms);
}

module.exports = {
  getControlState,
  setControlState,
  createControlState,
  resolveTenantByPhone,
  resolveEffectiveState,
  incrementUsage,
  getUsageSummary,
  parseDuration,
  expiryFromDuration,
};