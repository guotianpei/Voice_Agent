'use strict';

const { getTenantConfig, setVapiAssistantId } = require('../tenants/tenantStore');
const { buildAssistantPayload } = require('./buildAssistantPayload');

const VAPI_API_BASE = 'https://api.vapi.ai';

function requireApiKey() {
  const key = process.env.VAPI_API_KEY;
  if (!key) {
    throw new Error(
      'VAPI_API_KEY is not set. In Codespaces: Settings -> Secrets and variables -> ' +
      'Codespaces -> New repository secret, then rebuild the Codespace.'
    );
  }
  return key;
}

async function callVapi(method, path, body) {
  const res = await fetch(`${VAPI_API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${requireApiKey()}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`Vapi ${method} ${path} failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

/**
 * Provisions (creates or updates) the Vapi assistant for one tenant. This is
 * a MANUAL, one-clinic-at-a-time command for pilot volume — see NEXT_SESSION
 * decision. It's written so the Jotform webhook can call this same function
 * later without a refactor: nothing here assumes it's being run from a CLI.
 *
 * - First run for a tenant: POST /assistant, store the returned id.
 * - Any later run for the same tenant (e.g. re-provisioning after a config
 *   edit): PATCH /assistant/{id} using the stored id — never creates a
 *   second assistant for the same clinic.
 *
 * @param {string} tenantId
 * @param {object} [options]  passed through to buildAssistantPayload
 *   (basePrompt, toolIds, transcriberModel, voice)
 * @returns {{ assistantId: string, mode: 'created'|'updated', meta: object }}
 */
async function provisionAssistant(tenantId, options = {}) {
  const tenant = await getTenantConfig(tenantId);
  if (!tenant) throw new Error(`Unknown tenant_id: ${tenantId}`);

  const { payload, meta } = buildAssistantPayload(tenant, options);

  if (tenant.vapiAssistantId) {
    await callVapi('PATCH', `/assistant/${tenant.vapiAssistantId}`, payload);
    return { assistantId: tenant.vapiAssistantId, mode: 'updated', meta };
  }

  const created = await callVapi('POST', '/assistant', payload);
  if (!created.id) {
    throw new Error(`Vapi create-assistant response had no id: ${JSON.stringify(created)}`);
  }
  await setVapiAssistantId(tenantId, created.id);
  return { assistantId: created.id, mode: 'created', meta };
}

module.exports = { provisionAssistant };
