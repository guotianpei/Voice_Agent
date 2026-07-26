-- Adds the column provisionAssistant.js reads/writes to know whether a tenant
-- already has a Vapi assistant (PATCH) or needs one created (POST).
alter table tenants add column if not exists vapi_assistant_id text;
