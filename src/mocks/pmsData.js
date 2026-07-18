// Fake clinic data - simulates what ezyVet would return
const APPOINTMENT_TYPES = [
  { id: '1', name: 'Wellness Exam', duration: 30 },
  { id: '2', name: 'Sick Visit',    duration: 30 },
  { id: '3', name: 'Vaccination',   duration: 15 },
]

const RESOURCES = [
  { id: '10', name: 'Dr. Patel' },
  { id: '11', name: 'Dr. Kim'   },
]

const AVAILABLE_SLOTS = [
  { start: '2026-07-20 09:00', end: '2026-07-20 09:30', resource_id: '10' },
  { start: '2026-07-20 11:00', end: '2026-07-20 11:30', resource_id: '10' },
  { start: '2026-07-20 14:00', end: '2026-07-20 14:30', resource_id: '11' },
  { start: '2026-07-21 10:00', end: '2026-07-21 10:30', resource_id: '10' },
  { start: '2026-07-21 15:00', end: '2026-07-21 15:30', resource_id: '11' },
]

const CONTACTS = [
  { id: '101', first_name: 'Sarah', last_name: 'Johnson', phone: '17035551234' },
]

const ANIMALS = [
  { id: '201', name: 'Bella', species: 'Canine', contact_id: '101' },
  { id: '202', name: 'Max',   species: 'Feline', contact_id: '101' },
]

module.exports = { APPOINTMENT_TYPES, RESOURCES, AVAILABLE_SLOTS, CONTACTS, ANIMALS }