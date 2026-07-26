#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { provisionAssistant } = require('../src/provisioning/provisionAssistant');

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error('Usage: node bin/provision-tenant.js <tenant_id>');
    process.exit(1);
  }

  const { assistantId, mode, meta } = await provisionAssistant(tenantId);

  console.log(`Assistant ${mode} for tenant "${tenantId}": ${assistantId}`);
  console.log(`  greeting source: ${meta.greetingSource}`);
  console.log(`  keyterms: ${meta.keytermCount}${meta.keytermsTruncated ? ' (truncated)' : ''}`);
  if (meta.droppedBaselineCount > 0) {
    console.log(`  dropped ${meta.droppedBaselineCount} baseline term(s) to stay under the cap`);
  }
}

main().catch((err) => {
  console.error('Provisioning failed:', err.message);
  process.exit(1);
});
