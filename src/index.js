require('dotenv').config()
const express = require('express')
const app = express()
const jotformWebhook = require('./routes/webhooks/jotformWebhook');

app.use(express.json());
app.use('/getClinicInfo', require('./routes/clinicInfo'));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`>>> ${req.method} ${req.path}`, JSON.stringify(req.body))
  next()
})

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Jotform webhook - handles form submissions
app.use('/webhook', jotformWebhook)

// Vapi server webhook - handles call events
app.post('/webhook', (req, res) => {
  const { message } = req.body
  console.log('Webhook event:', message?.type)

  if (message?.type === 'assistant-request') {
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    const threeMonths = new Date()
    threeMonths.setMonth(threeMonths.getMonth() + 3)
    const windowEnd = threeMonths.toISOString().split('T')[0]

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

const toolCalls = require('./routes/toolCalls')
app.use('/tool-calls', toolCalls)

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Middleware running on port ${PORT}`)
})
