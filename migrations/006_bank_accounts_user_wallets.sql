-- Migration 006
-- Persistencia de datos bancarios y wallets del usuario (flujo manual de pago/depósito).
--   * bank_accounts: HASH (SHA256) del IBAN + nombre del banco + titular de la cuenta (obligatorios).
--     El IBAN en claro NO vive en esta tabla; se usa "per order" en orders.iban.
--   * user_wallets: dirección + red + nombre opcional (las direcciones son públicas on-chain,
--     no requieren hashing).
--   * orders: nuevas columnas para ligar la orden con la cuenta/wallet correspondiente
--     y guardar el IBAN de destino del payout SEPA.

CREATE TABLE IF NOT EXISTS bank_accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  iban_hash   TEXT NOT NULL,
  bank_name   TEXT,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, iban_hash)
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_user ON bank_accounts(user_id);

-- ---------------------------------------------------------------------------
-- Evolución de bank_accounts (sin nueva migración separada):
-- En instalaciones antiguas la tabla pudo crearse solo con bank_name opcional y
-- sin account_holder_name. Los pasos siguientes son idempotentes:
--   1) Añadir columna de titular si falta.
--   2) Rellenar valores placeholder donde falten datos (filas legacy antes del NOT NULL).
--   3) Forzar NOT NULL para que el API/backend siempre persista banco + titular junto al hash.
-- Si ejecutáis este script de nuevo en una BD ya alineada, los UPDATE no tocan filas válidas
-- y los ALTER COLUMN son seguros.
-- ---------------------------------------------------------------------------
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS account_holder_name TEXT;

UPDATE bank_accounts
SET bank_name = 'Unknown bank'
WHERE bank_name IS NULL OR TRIM(bank_name) = '';

UPDATE bank_accounts
SET account_holder_name = 'Unknown holder'
WHERE account_holder_name IS NULL OR TRIM(account_holder_name) = '';

ALTER TABLE bank_accounts
  ALTER COLUMN bank_name SET NOT NULL,
  ALTER COLUMN account_holder_name SET NOT NULL;

CREATE TABLE IF NOT EXISTS user_wallets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address     TEXT NOT NULL,
  network     TEXT NOT NULL,
  name        TEXT,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, address, network)
);

CREATE INDEX IF NOT EXISTS idx_user_wallets_user ON user_wallets(user_id);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES bank_accounts(id),
  ADD COLUMN IF NOT EXISTS user_wallet_id  UUID REFERENCES user_wallets(id),
  ADD COLUMN IF NOT EXISTS iban            TEXT;
