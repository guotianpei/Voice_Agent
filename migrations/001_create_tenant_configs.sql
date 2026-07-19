-- Migration: Create tenant_configs table
-- Purpose: Store clinic onboarding and configuration data as JSONB
-- Supports: Multi-tenant, flexible schema, auditable changes

CREATE TABLE IF NOT EXISTS tenant_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Identifiers
  tenant_id UUID NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  timezone VARCHAR(50) NOT NULL DEFAULT 'America/New_York',
  
  -- Configuration (flexible JSONB structure)
  config JSONB NOT NULL,
  
  -- Status tracking
  status VARCHAR(50) NOT NULL DEFAULT 'draft', 
  -- draft | configured | live | paused | archived
  
  -- Audit trail
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by VARCHAR(255), -- email or system identifier
  
  -- Versioning (for future rollback capability)
  version INT DEFAULT 1,
  
  -- Constraints
  CONSTRAINT fk_tenant FOREIGN KEY (tenant_id) 
    REFERENCES tenants(id) ON DELETE CASCADE
);

-- Indexes for fast lookup
CREATE INDEX idx_tenant_configs_tenant_id 
  ON tenant_configs(tenant_id);

CREATE INDEX idx_tenant_configs_status 
  ON tenant_configs(status);

CREATE INDEX idx_tenant_configs_created_at 
  ON tenant_configs(created_at DESC);

-- JSONB operator indexes for efficient filtering
CREATE INDEX idx_tenant_configs_pms_type 
  ON tenant_configs USING GIN (config -> 'scheduling_software');

CREATE INDEX idx_tenant_configs_business_type 
  ON tenant_configs USING GIN (config -> 'business_profile');

-- Utility function: auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION update_tenant_configs_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update timestamp
DROP TRIGGER IF EXISTS trigger_update_tenant_configs_timestamp ON tenant_configs;
CREATE TRIGGER trigger_update_tenant_configs_timestamp
BEFORE UPDATE ON tenant_configs
FOR EACH ROW
EXECUTE FUNCTION update_tenant_configs_timestamp();

-- Ensure tenants table exists (referenced by FK)
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tenants_created_at ON tenants(created_at DESC);
