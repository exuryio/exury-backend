-- Cuentas bancarias del usuario (flujo venta) + datos bancarios en la orden
CREATE TABLE IF NOT EXISTS bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  iban_hash VARCHAR(64) NOT NULL,
  iban_encrypted TEXT NOT NULL,
  holder_name VARCHAR(255) NOT NULL,
  bank_name VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, iban_hash)
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_user_id ON bank_accounts(user_id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS iban VARCHAR(34);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS holder_name VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES bank_accounts(id);
