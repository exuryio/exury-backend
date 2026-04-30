/**
 * Bank Account Repository
 * Persistencia de cuentas bancarias verificadas del usuario.
 * IMPORTANTE: la tabla NO guarda el IBAN en claro; sólo su hash (SHA256).
 * El IBAN en claro se guarda "per order" en orders.iban para que el operador
 * manual pueda ejecutar la transferencia.
 */
import crypto from 'crypto';
import { pool } from '../config/database';

/** Fila de bank_accounts: identidad bancaria por usuario sin guardar IBAN en claro. */
export interface BankAccountRow {
  id: string;
  user_id: string;
  /** SHA256 del IBAN normalizado (hex); deduplica por usuario con UNIQUE(user_id, iban_hash). */
  iban_hash: string;
  /** Nombre del banco asociado al IBAN (obligatorio en DB tras migración 006). */
  bank_name: string;
  /** Titular de la cuenta tal como lo declara el usuario (obligatorio en DB tras migración 006). */
  account_holder_name: string;
  created_at: Date;
  updated_at: Date;
}

/** Normaliza un IBAN: elimina espacios y pasa a mayúsculas (formato único antes de validar y hashear). */
export function normalizeIban(raw: string): string {
  return (raw || '').replace(/\s+/g, '').toUpperCase();
}

/** SHA256 del IBAN normalizado, hex. */
export function hashIban(raw: string): string {
  const normalized = normalizeIban(raw);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * IBAN ya normalizado: dos letras de código país (ISO) + entre 13 y 32 dígitos BBAN (longitud total 15–34).
 * Misma regla en cuentas bancarias, creación de orden sell y payout (antes vivía solo en OrderService).
 */
export function isValidIban(value: string): boolean {
  return /^[A-Z]{2}\d{13,32}$/.test(value);
}

class BankAccountRepository {
  async findAllByUser(userId: string): Promise<BankAccountRow[]> {
    const { rows } = await pool.query(
      `SELECT id, user_id, iban_hash, bank_name, account_holder_name, created_at, updated_at
         FROM bank_accounts
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  }

  async findByUserAndHash(userId: string, ibanHash: string): Promise<BankAccountRow | null> {
    const { rows } = await pool.query(
      `SELECT id, user_id, iban_hash, bank_name, account_holder_name, created_at, updated_at
         FROM bank_accounts
        WHERE user_id = $1 AND iban_hash = $2
        LIMIT 1`,
      [userId, ibanHash]
    );
    return rows[0] || null;
  }

  async findByIdForUser(id: string, userId: string): Promise<BankAccountRow | null> {
    const { rows } = await pool.query(
      `SELECT id, user_id, iban_hash, bank_name, account_holder_name, created_at, updated_at
         FROM bank_accounts
        WHERE id = $1 AND user_id = $2
        LIMIT 1`,
      [id, userId]
    );
    return rows[0] || null;
  }

  /**
   * Inserta o actualiza por (user_id, iban_hash).
   * En conflicto se sobrescriben banco y titular con los valores enviados (última verdad del cliente).
   */
  async upsert(
    userId: string,
    iban: string,
    bankName: string,
    accountHolderName: string
  ): Promise<BankAccountRow> {
    const ibanHash = hashIban(iban);
    const { rows } = await pool.query(
      `INSERT INTO bank_accounts (user_id, iban_hash, bank_name, account_holder_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, iban_hash)
         DO UPDATE SET bank_name = EXCLUDED.bank_name,
                       account_holder_name = EXCLUDED.account_holder_name,
                       updated_at = NOW()
       RETURNING id, user_id, iban_hash, bank_name, account_holder_name, created_at, updated_at`,
      [userId, ibanHash, bankName, accountHolderName]
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
