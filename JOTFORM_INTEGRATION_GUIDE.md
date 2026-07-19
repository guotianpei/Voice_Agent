# Jotform Onboarding Integration Guide

## Overview

This guide walks through connecting the Jotform onboarding form to your Express middleware and database.

**Form ID:** `261987243746066`  
**Form URL:** https://form.jotform.com/261987243746066

---

## Step 1: Database Setup

### Create the tenant_configs table

Run the migration in your PostgreSQL database:

```bash
psql -U postgres -d voice_agent < 001_create_tenant_configs.sql
```

Verify the table was created:

```sql
SELECT * FROM tenant_configs;
-- Should return empty table with correct schema
```

---

## Step 2: Add Webhook Handler to Express

### Copy the webhook file into your project

```bash
cp /home/claude/jotform-webhook.ts src/routes/webhooks/jotformWebhook.ts
```

### Integrate into your Express app

**File:** `src/index.ts` or `src/app.ts`

```typescript
import express from 'express';
import jotformRouter from './routes/webhooks/jotformWebhook';

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/webhook', jotformRouter);

// ... other routes
```

### Verify the route is accessible

The webhook will be available at:

```
POST https://your-middleware-url.com/webhook/jotform
```

For GitHub Codespaces testing:

```
POST https://super-acorn-4q5xr46xgx7f464-3000.app.github.dev/webhook/jotform
```

---

## Step 3: Configure Webhook in Jotform UI

### Open Jotform Form Settings

1. Go to https://form.jotform.com/261987243746066
2. Click **Settings** (gear icon)
3. Left sidebar → **Integrations**
4. Search for **Webhooks**
5. Click **Add Integration**

### Configure Webhook

**Webhook URL:**
```
https://super-acorn-4q5xr46xgx7f464-3000.app.github.dev/webhook/jotform
```

(Replace with your actual middleware URL before production)

**Trigger:** `Form Submission`

**Data Format:** Raw (Jotform sends as JSON)

**Test the webhook:**
- Click **Send Test Data**
- Check your server logs — you should see:
  ```
  Received Jotform submission: { ... }
  ✅ Tenant config created: { tenantId: '...', clinic: 'Test Clinic' }
  ```

---

## Step 4: Load Tenant Config in Middleware

### Add config loader function

**File:** `src/config/tenantConfig.ts`

```typescript
import { pool } from '../db';

export async function loadTenantConfig(tenantId: string) {
  const result = await pool.query(
    'SELECT config FROM tenant_configs WHERE tenant_id = $1',
    [tenantId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Tenant config not found: ${tenantId}`);
  }

  return result.rows[0].config;
}
```

### Use in your routes

**Example:** `src/routes/toolCalls.ts`

```typescript
import { loadTenantConfig } from '../config/tenantConfig';

app.post('/tool-calls/appointment-types', async (req, res) => {
  const { tenant_id } = req.body;

  // Load clinic config
  const config = await loadTenantConfig(tenant_id);

  // Filter services based on clinic's enabled services
  const enabledServices = config.services.mappings
    .filter(s => s.enabled)
    .map(s => ({
      id: s.id,
      name: s.customer_facing_name,
      duration: s.duration_minutes
    }));

  res.json({ services: enabledServices });
});
```

---

## Step 5: Test End-to-End

### Test the form submission

1. Open the Jotform: https://form.jotform.com/261987243746066
2. Fill in minimal data:
   - Business Name: `Test Clinic`
   - Business Type: `Veterinary Clinic`
   - Contact Email: `test@clinic.com`
   - Contact Phone: `+1-703-555-1234`
   - Address: `123 Main St`
   - Services: Add one (e.g., "Annual Checkup | 30 | yes")
   - Business Hours: Add one day
   - Min Advance: `Immediately`
   - Max Advance: `90 days`
   - Scheduling System: `None / Paper Calendar`
   - Confirm both checkboxes
3. Click **Submit**

### Check the database

```sql
SELECT tenant_id, name, status, config 
FROM tenant_configs 
ORDER BY created_at DESC 
LIMIT 1;
```

Expected output:
```
 tenant_id                            |  name      | status     | config
 550e8400-e29b-41d4-a716-446655440000 | Test Clinic | configured | { "business_profile": {...}, "services": {...}, ... }
```

### Test loading the config

```typescript
const config = await loadTenantConfig('550e8400-e29b-41d4-a716-446655440000');
console.log(config.business_profile.name); // "Test Clinic"
console.log(config.services.mappings); // Array of services
```

---

## Step 6: Update Vapi Assistant Prompt

The Vapi assistant now receives `tenant_id` from the form data. Update the system prompt:

```
Today's date is [{{ now | strftime('%A, %B %d, %Y') }}].

You are a friendly and efficient appointment scheduling receptionist for {{ tenant_name }}.

Clinic Config:
- Timezone: {{ timezone }}
- Minimum advance booking: {{ min_advance_hours }} hours
- Maximum advance booking: {{ max_advance_days }} days
- Available services: {{ services | join(', ') }}
- Available providers: {{ providers | join(', ') }}

When the caller mentions a date like "next Monday" or "July 21st", pass their words exactly as they said it to checkAvailability — do not convert or interpret the date yourself.

Always call lookupContact first to identify the caller or pet.
```

---

## Webhook Response Examples

### Success (201)

```json
{
  "success": true,
  "tenant_id": "550e8400-e29b-41d4-a716-446655440000",
  "clinic_name": "Paws & Claws Vet",
  "message": "Clinic 'Paws & Claws Vet' onboarded successfully!"
}
```

### Validation Error (400)

```json
{
  "success": false,
  "error": "API URL is required for PMS integration",
  "details": "Please check the form data and resubmit"
}
```

---

## Troubleshooting

### Webhook not being called

1. Verify middleware is running and port is **Public** in Codespaces
2. Check Jotform integration settings — URL should be correct
3. Test with a simple `curl`:
   ```bash
   curl -X POST https://your-url/webhook/jotform \
     -H "Content-Type: application/json" \
     -d '{"business_name":"Test","contact_email":"test@test.com"}'
   ```

### "Tenant not found" error in tools

1. Verify tenant_id is being passed from Vapi to middleware
2. Check database:
   ```sql
   SELECT tenant_id, name FROM tenant_configs;
   ```
3. If missing, re-submit the Jotform

### Missing fields in config

1. Check that all required fields are filled in the Jotform
2. Review Jotform field names match the transformation function
3. Check server logs for parsing errors

---

## Next Steps

- **Phase 2:** Add knowledge base, escalation rules, SMS templates to Jotform
- **Phase 2:** Build admin portal to edit existing clinic configs
- **Phase 2:** Add ezyVet OAuth flow (clinic securely grants API access)
- **Future:** Multi-location support, team billing, analytics dashboard

---

## Form Structure Reference

If you need to edit the Jotform later, the pages and fields are:

```
PAGE 1: Business Information
  - business_name (text)
  - business_type (dropdown)
  - num_locations (number)
  - contact_name (text)
  - contact_email (email)
  - business_phone (phone)
  - business_address (text)

PAGE 2: Services Configuration
  - services (repeating: name|duration|enabled)
  - services_requiring_approval (long text)

PAGE 3: Business Hours
  - business_hours (repeating: day|open|close|closed)
  - holidays (long text)

PAGE 4: Appointment Rules
  - min_advance_hours (dropdown)
  - max_advance_days (dropdown)
  - hide_appointments (checkboxes)

PAGE 5: Staff / Providers
  - multiple_providers (yes/no)
  - staff (repeating: name|role|services|available_days)

PAGE 6: Scheduling Software
  - scheduling_software (dropdown)
  - software_name_other (text, conditional)
  - api_url (text, conditional)
  - oauth_client_id (text, conditional)
  - oauth_client_secret (password, conditional)

PAGE 7: Final Review
  - confirmed_accuracy (checkbox)
  - ready_to_launch (checkbox)
```
