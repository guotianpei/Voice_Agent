const express = require('express')
const router = express.Router()
const { APPOINTMENT_TYPES, RESOURCES, AVAILABLE_SLOTS, CONTACTS, ANIMALS } = require('../mocks/pmsData')

router.post('/check-availability', (req, res) => {
  const { date } = req.body
  const slots = AVAILABLE_SLOTS.filter(s => s.start.startsWith(date))
  const message = slots.length > 0
    ? 'Available slots on ' + date + ': ' + slots.map(s => {
        const resource = RESOURCES.find(r => r.id === s.resource_id)
        return s.start.split(' ')[1] + ' with ' + (resource ? resource.name : 'unknown')
      }).join(', ')
    : 'No availability on ' + date + ', please try another date.'
  res.json({ result: message })
})

router.post('/book-appointment', (req, res) => {
  const { date, time, appointment_type_id, resource_id } = req.body
  const resource = RESOURCES.find(r => r.id === resource_id)
  const type = APPOINTMENT_TYPES.find(t => t.id === appointment_type_id)
  const message = 'Appointment confirmed: ' + (type ? type.name : 'Visit') + ' on ' + date + ' at ' + time + ' with ' + (resource ? resource.name : 'unknown') + '. Confirmation number: MOCK-' + Date.now() + '.'
  res.json({ result: message })
})

router.post('/lookup-contact', (req, res) => {
  const cleanPhone = (req.body.phone || '').replace(/\D/g, '')
  const contact = CONTACTS.find(c => c.phone === cleanPhone)
  if (!contact) return res.json({ result: 'No existing client found for this phone number.' })
  const animals = ANIMALS.filter(a => a.contact_id === contact.id)
  const petList = animals.map(a => a.name + ' (' + a.species + ')').join(' and ')
  res.json({ result: 'Found client ' + contact.first_name + ' ' + contact.last_name + ' with pets: ' + petList + '.' })
})

router.post('/appointment-types', (req, res) => {
  const list = APPOINTMENT_TYPES.map(t => t.name).join(', ')
  res.json({ result: 'Available appointment types: ' + list + '.' })
})

module.exports = router