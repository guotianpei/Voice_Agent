'use strict';

const { buildKeytermList } = require('./keyterms');

// Fallback used only when a tenant's onboarding config genuinely has no
// greeting set (shouldn't happen once the Jotform field is required, but
// provisioning must never send a blank firstMessage).
// TODO(Rachel): sync this with the actual default value on the Jotform
// q45_greetingMessage field if that default text differs from this.
const DEFAULT_GREETING = "Thank you for calling! How can I help you today?";

// TODO(Rachel): this is a placeholder base prompt reconstructed from the
// JOTFORM_INTEGRATION_GUIDE.md scaffold doc, NOT pulled from your live Vapi
// assistant. Paste your actual current system prompt in here (or pass
// `basePrompt` into buildAssistantPayload) before this goes anywhere near a
// real call — the greeting/keyterm injection logic below doesn't care what
// the rest of the prompt says, but it does assume the greeting instruction
// gets prepended to whatever prompt you give it.
const DEFAULT_BASE_PROMPT = `You are a friendly and efficient appointment scheduling receptionist for {{clinicName}}.

Clinic Config:
- Timezone: {{timezone}}
- Available services: {{services}}
- Available providers: {{providers}}

When the caller mentions a date like "next Monday" or "July 21st", pass their words exactly
as they said it to checkAvailability — do not convert or interpret the date yourself.

Always call lookupContact first to identify the caller or pet.`;

function fillTemplate(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : ''
  );
}

/**
 * @param {object} tenant  { tenantId, clinicName, config } — config is the raw
 *   onboarding blob (tenant.config from tenantStore.getTenantConfig).
 * @param {object} [options]
 * @param {string} [options.basePrompt]   overrides DEFAULT_BASE_PROMPT
 * @param {string[]} [options.toolIds]    Vapi tool IDs to attach (check-availability,
 *   book-appointment, lookup-contact, appointment-types, get-clinic-info, ...).
 *   Left empty by default — attach after assistant creation per the NEXT_SESSION
 *   decision for reschedule's tool, and pass the full set here once you have the
 *   static tool IDs from the Vapi dashboard.
 * @param {string} [options.transcriberModel]  defaults to 'nova-3'
 * @param {object} [options.voice]  Vapi voice block; left as a placeholder default
 * @returns {object} Vapi POST /assistant payload
 */
function buildAssistantPayload(tenant, options = {}) {
  const config = tenant.config || {};
  const bp = config.business_profile || {};

  const greeting = bp.greeting || DEFAULT_GREETING;
  const clinicName = bp.name || tenant.clinicName || 'the clinic';
  const timezone = bp.timezone || 'America/New_York';

  const services = (config.services && config.services.mappings) || [];
  const serviceNames = services
    .filter((s) => s && s.enabled !== false && s.customer_facing_name)
    .map((s) => s.customer_facing_name);

  const doctors = (config.staff && config.staff.doctors) || [];
  const providerNames = doctors.filter((d) => d && d.name).map((d) => d.name);

  const basePrompt = options.basePrompt || DEFAULT_BASE_PROMPT;
  const filledPrompt = fillTemplate(basePrompt, {
    clinicName,
    timezone,
    services: serviceNames.join(', '),
    providers: providerNames.join(', '),
  });

  // Greeting is a spoken instruction prepended to the system prompt, not just
  // set as firstMessage — this guarantees the assistant opens with the
  // clinic's exact wording even under 'assistant-speaks-first' mode where
  // Vapi speaks firstMessage verbatim, AND keeps the model aware of what it
  // already said if the caller responds before the model's next turn.
  const systemPrompt = `Open every call by saying exactly: "${greeting}"\n\n${filledPrompt}`;

  const { keyterms, truncated, droppedBaselineCount } = buildKeytermList(config);

  const payload = {
    name: `${clinicName} — HaloVox`,
    firstMessage: greeting,
    firstMessageMode: 'assistant-speaks-first',
    model: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'system', content: systemPrompt }],
    },
    transcriber: {
      provider: 'deepgram',
      model: options.transcriberModel || 'nova-3',
      language: 'en',
      keyterm: keyterms,
    },
    voice: options.voice || { provider: '11labs', voiceId: 'placeholder-voice-id' },
  };

  if (options.toolIds && options.toolIds.length > 0) {
    payload.model.toolIds = options.toolIds;
  }

  return {
    payload,
    meta: {
      tenantId: tenant.tenantId,
      greetingSource: bp.greeting ? 'config' : 'default-fallback',
      keytermCount: keyterms.length,
      keytermsTruncated: truncated,
      droppedBaselineCount,
    },
  };
}

module.exports = { buildAssistantPayload, DEFAULT_GREETING, DEFAULT_BASE_PROMPT };
