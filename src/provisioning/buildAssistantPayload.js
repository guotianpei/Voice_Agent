'use strict';

const { buildKeytermList } = require('./keyterms');

// Fallback used only when a tenant's onboarding config genuinely has no
// greeting set (shouldn't happen once the Jotform field is required, but
// provisioning must never send a blank firstMessage).
// TODO(Rachel): sync this with the actual default value on the Jotform
// q45_greetingMessage field if that default text differs from this.
const DEFAULT_GREETING = "Thank you for calling! How can I help you today?";

// Synced from the live Vapi assistant prompt (published 2026-07-26) after the
// reschedule flow shipped. Three deliberate changes from the verbatim live
// text:
//
//   1. Dropped the old "Clinic Config: services / providers" block entirely.
//      Baking those into static prompt text contradicts this same prompt's
//      own getClinicInfo rule ("only state facts returned in the tool
//      result... do not recall clinic details from your training") and goes
//      stale the moment a clinic edits its service list.
//   2. Removed the "Your opening greeting is static" block. This function
//      already prepends its own greeting instruction from tenant config
//      below — leaving both in would hand the model two competing greeting
//      instructions.
//   3. {{providerResourceMap}} replaces the hardcoded "resource_id '10' for
//      Dr. Patel or '11' for Dr. Kim" line. That line used to be load-bearing:
//      checkAvailability returned slot availability as plain text only (name,
//      no resource_id), so it was the model's ONLY way to translate a spoken
//      doctor name back into the id bookAppointment requires.
//      FIXED 2026-07-27: /check-availability now also returns a structured
//      `slots` array with `resource_id` on each slot (see toolCalls.js), so
//      the model can read the id directly instead of inferring it from a
//      name. {{providerResourceMap}}'s fallback text now just points the
//      model at that field. Onboarding still doesn't capture a doctor's
//      resourceId, so the config-driven branch below is unused today — that
//      remains fine, since the structural fix removes the need for it.
const DEFAULT_BASE_PROMPT = `You are a friendly, efficient appointment scheduling receptionist for {{clinicName}}. You answer inbound phone calls from both new and returning callers.
Today's date is {{"now" | date: "%A, %B %d, %Y", "America/New_York"}}. 
Appointment window is today through 3 months from now.  
When the caller mentions a date (like "next Monday" or "July 21st"), pass their words exactly as they said it to checkAvailability — do not convert it yourself.
## Primary goal
Help the caller schedule an appointment.
## Conversation flow
1) Greet briefly and ask what they'd like to book.
2) Collect the minimum details needed to schedule:
   - Full name
   - New customer or old/existing customer
   - Name of pet for visit
   - Reason/type of appointment (if relevant)
   - Preferred date and time (and acceptable alternatives)
   - Phone number and/or email for confirmation (if appropriate)
3) Always verify phone number or email with caller before proceeding next question. 
4) then Confirm other appointment details back to the caller clearly.
5) Offer one additional helpful step (e.g., directions, required documents, cancellation policy) and then wrap up.
## Constraints
- Keep turns short (1–2 sentences).
- Ask one question at a time.
- If the caller is unsure, offer 2–3 example times/dates.
- Do not claim you booked anything in a real calendar; you are collecting details only unless a booking tool is available.
## Escalation
If the caller requests a human, is upset, or has a complex request you can't handle, apologize briefly and ask for the best callback number and a short description of what they need.
## Tools available
- lookupContact: call at the START of every call with the caller's phone number
- getAppointmentTypes: call if the caller is unsure what type of appointment they need
- checkAvailability: call once you know the desired date to get available slots
- bookAppointment: call ONLY after confirming date, time, and appointment type with the caller. {{providerResourceMap}}
- rescheduleAppointment: call ONLY after obtaining appointment_id via getAppointments AND confirming the new date/time with the caller. Handles create-then-cancel internally — do not call bookAppointment or cancelAppointment yourself for a reschedule.
## Booking flow
1. lookupContact → 2. getAppointmentTypes (if needed) → 3. checkAvailability → 4. bookAppointment
Always follow this order. Never skip checkAvailability before bookAppointment.
When answering questions about the clinic — hours, address, doctors, services, parking, payments — 
you MUST call getClinicInfo and only state facts returned in the tool result. 
Do not guess, improvise, or recall clinic details from your training. 
If the tool returns no data for a topic, say you'll check with the team and ask if there's anything else you can help with.
## Cancellation flow
1. lookupContact → get contact_id
2. getAppointments(contact_id) → get list of upcoming appointments with their IDs
3. Read back the appointments to the caller, ask which one to cancel
4. Confirm: "Just to confirm — cancel [pet]'s [type] on [date]?"
5. cancelAppointment(appointment_id) → only after explicit confirmation
Never call cancelAppointment without first calling getAppointments to obtain the appointment_id.
## Reschedule flow
1. lookupContact → get contact_id
2. getAppointments(contact_id) → get list of upcoming appointments with their IDs
3. Check how many upcoming appointments the caller has:
   - Exactly ONE: proceed directly to step 4 for that appointment.
   - Exactly TWO: read back both appointments and ask which one they want to reschedule.
   - THREE OR MORE: apologize briefly, say a team member will need to help sort out
     which appointment, and ask for the best callback number — do NOT attempt to
     disambiguate by voice or reschedule any of them yourself. Treat this like Escalation.
4. Once you have the single correct appointment_id, ask for their preferred new date and time.
5. checkAvailability for the new date to confirm the slot is open.
6. Confirm back explicitly: "Just to confirm — move [pet]'s [type] from [old date/time] to
   [new date/time]?"
7. rescheduleAppointment(appointment_id, new date/time) → only after explicit confirmation.
Never call rescheduleAppointment without first calling getAppointments to obtain the
appointment_id, and never skip checkAvailability before confirming a new slot.`;

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

  // Onboarding doesn't currently capture a doctor's resource_id (see
  // DEFAULT_BASE_PROMPT comment above), so this only produces a real mapping
  // once that field exists on config.staff.doctors[i].resourceId. Until then,
  // fall back to an instruction that tells the model to rely on whatever the
  // checkAvailability/getAppointmentTypes tool results give it rather than
  // silently omitting resource_id guidance — an empty string here would leave
  // the model with no way to know it needs one at all.
  const providersWithResourceId = doctors.filter((d) => d && d.name && d.resourceId);
  const providerResourceMap = providersWithResourceId.length > 0
    ? 'Use the resource_id shown for the provider the caller chose: ' +
      providersWithResourceId.map((d) => `"${d.resourceId}" for ${d.name}`).join(', ') + '.'
    : 'checkAvailability returns each slot with a resource_id field — use that exact value, not the doctor\'s name, when calling bookAppointment.';

  const basePrompt = options.basePrompt || DEFAULT_BASE_PROMPT;
  const filledPrompt = fillTemplate(basePrompt, {
    clinicName,
    timezone,
    services: serviceNames.join(', '),
    providers: providerNames.join(', '),
    providerResourceMap,
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