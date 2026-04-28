/**
 * Bank Account Repository
 * Persistencia de cuentas bancarias verificadas del usuario.
 * IMPORTANTE: la tabla NO guarda el IBAN en claro; sólo su hash (SHA256).
 * El IBAN en claro se guarda "per order" en orders.iban para que el operador
 * manual pueda ejecutar la transferencia.
 */
import crypto from 'crypto';
import { pool } from '../config/database';

export interface BankAccountRow {
  id: string;
  user_id: string;
  iban_hash: string;
  bank_name: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Normaliza un IBAN: quita espacios y mayúsculas. */
export function normalizeIban(raw: string): string {
  return (raw || '').replace(/\s+/g, '').toUpperCase();
}

/** SHA256 del IBAN normalizado, hex. */
export function hashIban(raw: string): string {
  const normalized = normalizeIban(raw);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

class BankAccountRepository {
  async findAllByUser(userId: string): Promise<BankAccountRow[]> {
    const { rows } = await pool.query(
      `SELECT id, user_id, iban_hash, bank_name, created_at, updated_at
         FROM bank_accounts
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  }

  async findByUserAndHash(userId: string, ibanHash: string): Promise<BankAccountRow | null> {
    const { rows } = await pool.query(
      `SELECT id, user_id, iban_hash, bank_name, created_at, updated_at
         FROM bank_accounts
        WHERE user_id = $1 AND iban_hash = $2
        LIMIT 1`,
      [userId, ibanHash]
    );
    return rows[0] || null;
  }

  async findByIdForUser(id: string, userId: string): Promise<BankAccountRow | null> {
    const { rows } = await pool.query(
      `SELECT id, user_id, iban_hash, bank_name, created_at, updated_at
         FROM bank_accounts
        WHERE id = $1 AND user_id = $2
        LIMIT 1`,
      [id, userId]
    );
    return rows[0] || null;
  }

  /**
   * Crea (o actualiza el bank_name si ya existe la misma cuenta para ese user).
   * Devuelve el registro resultante.
   */
  async upsert(userId: string, iban: string, bankName: string | null): Promise<BankAccountRow> {
    const ibanHash = hashIban(iban);
    const { rows } = await pool.query(
      `INSERT INTO bank_accounts (user_id, iban_hash, bank_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, iban_hash)
         DO UPDATE SET bank_name = COALESCE(EXCLUDED.bank_name, bank_accounts.bank_name),
                       updated_at = NOW()
       RETURNING id, user_id, iban_hash, bank_name, created_at, updated_at`,
      [userId, ibanHash, bankName]
    );
    return rows[0];
  }

  async deleteForUser(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      'DELETE FROM bank_accounts WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return (rowCount ?? 0) > 0;
  }
}

export const bankAccountRepository = new BankAccountRepository();
