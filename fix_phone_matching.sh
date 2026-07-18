#!/bin/bash
set -e

# Patch lookupContact in ezyVetAdapter.js to match on last-10-digits instead of
# exact string, so "1703555-1234", "+17035551234", "7035551234" all match.
node - << 'EOF'
const fs = require('fs')
const path = 'src/pms/ezyVetAdapter.js'
let src = fs.readFileSync(path, 'utf8')

const oldBlock = /async lookupContact\(phone\) \{[\s\S]*?const contact = CONTACTS\.find\([^\n]*\)\n/
const newBlock = `async lookupContact(phone) {
    // Compare last-10-digits on BOTH sides: the LLM formats what it heard
    // unpredictably ("1703555-1234", "+17035551234", "7035551234"), so any
    // exact-format match will randomly fail. The national 10-digit core is
    // the only stable identity.
    const normalize = (raw) => (raw || '').replace(/\\D/g, '').slice(-10)
    const cleanPhone = normalize(phone)
    const contact = CONTACTS.find(c => normalize(c.phone) === cleanPhone)
`
if (!oldBlock.test(src)) {
  console.error('Pattern not found — lookupContact may already be patched. No change made.')
  process.exit(0)
}
src = src.replace(oldBlock, newBlock)
fs.writeFileSync(path, src)
console.log('Patched lookupContact to last-10-digit matching.')
EOF

node --check src/pms/ezyVetAdapter.js && echo "SYNTAX OK"
echo "Restart the server: Ctrl+C then node src/index.js"
