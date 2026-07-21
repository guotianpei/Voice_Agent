CREATE TABLE IF NOT EXISTS agent_control (
  tenant_id             TEXT         PRIMARY KEY REFERENCES tenants(tenant_id),
  mode                  VARCHAR(20)  NOT NULL DEFAULT 'auto',
  override_expiry       TIMESTAMPTZ,
  deployment_intent     VARCHAR(30)  NOT NULL DEFAULT 'after_hours_coverage',
  off_behavior          VARCHAR(20)  NOT NULL DEFAULT 'voicemail',
  off_forward_number    VARCHAR(20),
  authorized_numbers    TEXT[]       NOT NULL DEFAULT '{}',
  usage_count           INTEGER      NOT NULL DEFAULT 0,
  usage_cap             INTEGER      NOT NULL DEFAULT 500,
  manager_number        VARCHAR(20),
  alerts_enabled        BOOLEAN      NOT NULL DEFAULT false,
  last_changed_by       VARCHAR(50),
  last_changed_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_control_authorized_numbers 
  ON agent_control USING GIN (authorized_numbers);
