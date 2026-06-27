const express = require('express')
const router = express.Router()
const { APPOINTMENT_TYPES, RESOURCES, AVAILABLE_SLOTS, CONTACTS, ANIMALS } = require('../mocks/pmsData')

router.post('/', (req, res) => {
  const toolCallList = req.body.toolCallList || []
  console.log('Tool call received:', JSON.stringify(toolCallList, null, 2))

  const results = toolCallList.map(toolCall => {
    const { id, name, arguments: args } = toolCall

    switch (name) {

      case 'checkAvailability': {
        const slots = AVAILABLE_SLOTS.filter(s => s.start.startsWith(args.date))
        const message = slots.length > 0
          ? 'Available slots on ' + args.date + ': ' + slots.map(s => {
              const resource = RESOURCES.find(r => r.id === s.resource_id)
              return s.start.split(' ')[1] + ' with ' + (resource ? resource.name : 'unknown')
            }).join(', ')
          : 'No availability on ' + args.date + ', please try another date.'
        return { toolCallId: id, result: message }
      }

      case 'bookAppointment': {
        const resource = RESOURCES.find(r => r.id === args.resource_id)
        const type = APPOINTMENT_TYPES.find(t => t.id === args.appointment_type_id)
        const message = 'Appointment confirmed: ' + (type ? type.name : 'Visit') + ' on ' + args.date + ' at ' + args.time + ' with ' + (resource ? resource.name : 'unknown') + '. Confirmation number: MOCK-' + Date.now() + '.'
        return { toolCallId: id, result: message }
      }

      case 'lookupContact': {
        const contact = CONTACTS.find(c => c.phone === args.phone.replace(/\D/g, ''))
        if (!contact) return { toolCallId: id, result: 'No existing client found for this phone number.' }
        const animals = ANIMALS.filter(a => a.contact_id === contact.id)
        const petList = animals.map(a => a.name + ' (' + a.species + ')').join(' and ')
        return { toolCallId: id, result: 'Found client ' + contact.first_name + ' ' + contact.last_name + ' with pets: ' + petList + '.' }
      }

      case 'getAppointmentTypes': {
        const list = APPOINTMENT_TYPES.map(t => t.name).join(', ')
        return { toolCallId: id, result: 'Available appointment types: ' + list + '.' }
      }

      default:
        return { toolCallId: id, result: 'Unknown tool: ' + name }
    }
  })

  res.json({ results })
})

module.exports = router