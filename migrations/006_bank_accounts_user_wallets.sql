-- Migration 005
-- Persistencia de datos bancarios y wallets del usuario (flujo manual de pago/depósito).
--   * bank_accounts: sólo guarda HASH (SHA256) del IBAN + nombre del banco por usuario.
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
