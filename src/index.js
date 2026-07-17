require('dotenv').config()
const express = require('express')
const app = express()

app.use(express.json())

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

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
