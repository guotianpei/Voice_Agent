-- Tenant config: one row per clinic. tenant_id must match the Vapi
-- assistant.id injected as a static parameter on every tool call
-- (see docs.vapi.ai/tools/static-variables-and-aliases).
create table if not exists tenants (
  tenant_id       text primary key,
  clinic_name     text not null,
  vertical        text not null default 'veterinary',
  pms_type        text not null,       -- 'mock' | 'ezyvet' | ...
  pms_credentials jsonb,               -- null until real PMS integration lands
  created_at      timestamptz not null default now()
);

-- Seed row for local/pilot testing against the mock adapter.
-- Replace tenant_id with your real Vapi assistant ID once you wire it up.
insert into tenants (tenant_id, clinic_name, vertical, pms_type, pms_credentials)
values ('mock-clinic-1', 'Test Clinic', 'veterinary', 'ezyvet', null)
on conflict (tenant_id) do nothing;
