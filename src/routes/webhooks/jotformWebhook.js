/**
 * Jotform Webhook Handler & Config Transformation
 * Maps Jotform's internal field names (q3_q3_textbox1, etc.) to tenant config.
 */

const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const upload = multer();

const poolModule = require('../../db/pool');
const pool = poolModule.pool || poolModule;

const router = express.Router();

/* ---------- helpers ---------- */

// Find a value by key prefix, e.g. key('q3_') matches 'q3_q3_textbox1'.
// Using the qN_ prefix is more stable than full internal names.
function byPrefix(data, prefix) {
  const k = Object.keys(data).find((key) => key.startsWith(prefix));
  return k !== undefined ? data[k] : undefined;
}

// Jotform sends compound fields (name/phone/address) as objects
function flat(val) {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'object') {
    // phone: {full} or {area, phone}; name: {first, last}; address: {addr_line1, city, state, postal}
    if (val.full) return String(val.full).trim();
    return Object.values(val)
      .map((v) => String(v).trim())
      .filter(Boolean)
      .join(' ');
  }
  return String(val).trim();
}

// ConfigurableList widgets send a JSON string: [{"Column Name":"value",...}, ...]
function parseWidgetList(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

// Get a column from a widget row by fuzzy label match
function col(row, ...labels) {
  const keys = Object.keys(row || {});
  for (const label of labels) {
    const k = keys.find((key) => key.toLowerCase().includes(label.toLowerCase()));
    if (k) return String(row[k] ?? '').trim();
  }
  return '';
}

/* ---------- transformation ---------- */

function transformJotformToConfig(data) {
  // Business profile
  const rawType = flat(byPrefix(data, 'q4_'));
  const businessProfile = {
    name: flat(byPrefix(data, 'q3_')),
    type: rawType.toLowerCase().includes('groom') ? 'pet_grooming' : 'veterinary_clinic',
    phone: flat(byPrefix(data, 'q8_')).replace(/[^\d+]/g, ''),
    address: flat(byPrefix(data, 'q9_')),
    timezone: 'America/New_York',
    contact_name: flat(byPrefix(data, 'q6_')),
    contact_email: flat(byPrefix(data, 'q7_')),
    num_locations: parseInt(flat(byPrefix(data, 'q5_')), 10) || 1,
    _status: 'complete',
  };

  if (!businessProfile.name) throw new Error('Business name is required');
  if (!businessProfile.contact_email) throw new Error('Contact email is required');

  // Services (widget q11): columns Service Name | Duration (minutes) | Enabled for booking
  const serviceRows = parseWidgetList(byPrefix(data, 'q11_'));
  const serviceMappings = serviceRows
    .map((row, idx) => ({
      id: `svc_${String(idx + 1).padStart(3, '0')}`,
      customer_facing_name: col(row, 'service name', 'name'),
      duration_minutes: parseInt(col(row, 'duration'), 10) || 30,
      enabled: col(row, 'enabled').toLowerCase() !== 'no',
    }))
    .filter((s) => s.customer_facing_name);

  if (serviceMappings.length === 0) {
    throw new Error('At least one service is required');
  }

  const servicesRequiringApproval = flat(byPrefix(data, 'q12_'));

  // Business hours (widget q16): Day | Open Time | Close Time | Closed
  const hourRows = parseWidgetList(byPrefix(data, 'q16_'));
  const businessHours = { _status: 'complete' };
  const daysOfWeek = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

hourRows.forEach((row) => {
    const day = col(row, 'day').toLowerCase();
    const open = col(row, 'open');
    const close = col(row, 'close');
    const closed = col(row, 'closed').toLowerCase() === 'yes';

    // Skip untouched filler rows (no times entered, not marked closed)
    if (!open && !close && !closed) return;

    // Never overwrite a filled day with a later duplicate row
    if (daysOfWeek.includes(day) && businessHours[day] === undefined) {
      businessHours[day] = closed ? null : { open, close };
    }
  });

  const holidays = flat(byPrefix(data, 'q18_'));

  // Scheduling rules (q21 min notice radio, q22 max window radio, q23-27 hide checkboxes)
  const minLabel = flat(byPrefix(data, 'q21_')).toLowerCase();
  const minAdvanceMap = {
    immediately: 0,
    '1 hour': 1,
    '2 hours': 2,
    'same day not allowed': 24,
  };
  const maxDays = parseInt(flat(byPrefix(data, 'q22_')), 10) || 90;

  const hideFlags = ['q23_', 'q24_', 'q25_', 'q26_', 'q27_']
    .map((p) => flat(byPrefix(data, p)).toLowerCase())
    .join('|');

  const schedulingRules = {
    min_advance_hours: minAdvanceMap[minLabel] !== undefined ? minAdvanceMap[minLabel] : 0,
    max_advance_days: maxDays,
    hide_emergency_slots: hideFlags.includes('emergency'),
    hide_staff_only: hideFlags.includes('staff'),
    hide_internal_blocks: hideFlags.includes('internal'),
    hide_provider_specific: hideFlags.includes('provider'),
    _status: 'complete',
  };

  // Providers (widget q30): Provider Name | Role/Title | Services they provide | Available Days
  const providerRows = parseWidgetList(byPrefix(data, 'q30_'));
  const staff = {
    doctors: providerRows
      .map((row, idx) => ({
        id: `doc_${String(idx + 1).padStart(3, '0')}`,
        name: col(row, 'provider name', 'name'),
        role: col(row, 'role'),
        services: col(row, 'services')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        available_days: col(row, 'available')
          .split(/[,\n]/)
          .map((d) => d.toLowerCase().trim())
          .filter((d) => daysOfWeek.includes(d)),
      }))
      .filter((s) => s.name),
    _status: 'complete',
  };

  // Scheduling software (q34 radio, q36-38 textboxes: software name / API URL / OAuth ID)
  const softwareType = flat(byPrefix(data, 'q34_'));
  const otherName = flat(byPrefix(data, 'q36_'));
  const schedulingSoftware = {
    type: softwareType,
    name: softwareType.toLowerCase() === 'other' && otherName ? otherName : softwareType,
    _status: 'complete',
  };

  const pmsSystems = ['ezyvet', 'avimark', 'cornerstone'];
  if (pmsSystems.includes(softwareType.toLowerCase())) {
    schedulingSoftware.credentials = {
      api_url: flat(byPrefix(data, 'q37_')),
      oauth_client_id: flat(byPrefix(data, 'q38_')),
      // NOTE: no OAuth secret field exists on the form currently
    };
  }

  return {
    business_profile: businessProfile,
    services: {
      mappings: serviceMappings,
      requiring_approval: servicesRequiringApproval,
      _status: 'complete',
    },
    business_hours: businessHours,
    holidays: { notes: holidays, _status: holidays ? 'complete' : 'incomplete' },
    scheduling_rules: schedulingRules,
    staff,
    scheduling_software: schedulingSoftware,
  };
}

/* ---------- route ---------- */

router.post('/jotform', upload.none(), async (req, res) => {
  try {
    let formData = req.body || {};

    if (typeof formData.rawRequest === 'string') {
      try {
        formData = JSON.parse(formData.rawRequest);
      } catch (e) {
        console.warn('Could not parse rawRequest, using body as-is');
      }
    } else if (formData.rawRequest) {
      formData = formData.rawRequest;
    }

    console.log('📥 Jotform submission received. Keys:', Object.keys(formData));

    const config = transformJotformToConfig(formData);
    const tenantId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO tenant_configs
         (tenant_id, name, timezone, config, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        tenantId,
        config.business_profile.name,
        config.business_profile.timezone,
        JSON.stringify(config),
        'configured',
        `clinic:${config.business_profile.contact_email}`,
      ]
    );

    console.log('✅ Tenant config created:', {
      tenantId,
      clinic: config.business_profile.name,
    });

    res.status(201).json({
      success: true,
      tenant_id: tenantId,
      clinic_name: config.business_profile.name,
    });
  } catch (error) {
    console.error('❌ Jotform webhook error:', error.message);
    res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;