require('dotenv').config()
const express = require('express')
const app = express()

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`>>> ${req.method} ${req.path}`, JSON.stringify(req.body))
  next()
})

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Clinic info route
app.use('/getClinicInfo', require('./routes/clinicInfo'));

// Tool calls (appointment booking, lookup, etc.)
const toolCalls = require('./routes/toolCalls')
app.use('/tool-calls', toolCalls)

// Jotform webhook - handles form submissions
const jotformWebhook = require('./routes/webhooks/jotformWebhook');
app.use('/webhook/jotform', jotformWebhook)

// SMS webhook - AI Agent Control commands from clinic staff
const smsWebhook = require('./routes/webhooks/smsWebhook');
app.use('/webhook', smsWebhook)

// Vapi server webhook - handles call events
const { resolveEffectiveState, incrementUsage } = require('./tenants/agentControl');
const { getTenantConfig } = require('./tenants/tenantStore');

app.post('/webhook', async (req, res) => {
  const { message } = req.body
  console.log('Webhook event:', message?.type)

  if (message?.type === 'assistant-request') {
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    const threeMonths = new Date()
    threeMonths.setMonth(threeMonths.getMonth() + 3)
    const windowEnd = threeMonths.toISOString().split('T')[0]

    // Resolve tenant from call metadata
    const tenantId = message?.call?.assistantId || null;

    try {
      // Check agent control state
      if (tenantId) {
        const tenant = await getTenantConfig(tenantId);
        const { active, reason } = await resolveEffectiveState(
          tenantId,
          tenant?.config || null
        );

        console.log(`Agent control: tenant=${tenantId} active=${active} reason=${reason}`);

        if (!active) {
          // Agent is OFF — return transfer destination instead of assistant
          const poolModule = require('./db/pool');
          const pool = poolModule.pool || poolModule;
          const { rows } = await pool.query(
            'SELECT off_behavior, off_forward_number FROM agent_control WHERE tenant_id = $1',
            [tenantId]
          );
          const control = rows[0];
          const forwardTo = control?.off_forward_number || process.env.DEFAULT_VOICEMAIL_NUMBER || '+18005550100';

          return res.json({
            destination: {
              type: 'number',
              number: forwardTo,
              message: 'Our office is currently unavailable. Please leave a message and we will call you back shortly.',
            }
          });
        }

        // Agent is ON — increment usage and return assistant
        await incrementUsage(tenantId);
      }
    } catch (err) {
      // Fail safe: if state check errors, let the call through
      console.error('Agent control check failed, failing open:', err.message);
    }

    return res.json({
      assistantOverrides: {
        variableValues: {
          today: todayStr,
          appointmentWindowEnd: windowEnd
        }
      }
    })
  }

  res.json({ received: true })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Middleware running on port ${PORT}`)
})