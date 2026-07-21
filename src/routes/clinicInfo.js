'use strict';

/**
 * clinicInfo.js — dedicated route for the getClinicInfo Vapi apiRequest tool.
 * tenantResolver sets req.tenant (from tenant_id = {{assistant.id}}). The
 * clinic's onboarding data lives on req.tenant.config; onboardingMapper
 * translates it into the canonical clinicInfo shape the engine consumes.
 */

const express = require('express');
const router = express.Router();

const tenantResolver = require('../middleware/tenantResolver');
const { mapOnboardingToClinicInfo } = require('../tenants/onboardingMapper');
const { getClinicInfo } = require('../tenants/clinicInfoService');
const { formatClinicInfo } = require('./clinicInfoFormatter');

const VALID_TOPICS = ['hours', 'address', 'doctors', 'services', 'logistics', 'general'];

router.post('/', tenantResolver, (req, res) => {
  let topic = String(req.body.topic || 'general').toLowerCase();
  if (!VALID_TOPICS.includes(topic)) topic = 'general';

  // Single fail-soft boundary: any missing/malformed field in the whole chain
  // degrades to the safe fallback + a log line, never a 500 on a live call.
  try {
    const clinicInfo = mapOnboardingToClinicInfo(req.tenant && req.tenant.config);
    if (!clinicInfo || !clinicInfo.hours || !clinicInfo.hours.regular) {
      throw new Error('tenant.config missing or unmappable');
    }
    const info = getClinicInfo(clinicInfo, topic, new Date());
    const message = formatClinicInfo(topic, info, clinicInfo);
    return res.json({ resolved: true, topic, ...info, message });
  } catch (err) {
    console.error('[getClinicInfo]', req.tenant && req.tenant.tenantId, topic, '-', err.message);
    return res.json({
      resolved: false,
      message: "I'm sorry, I can't pull up the clinic's details right now."
    });
  }
});

module.exports = router;
