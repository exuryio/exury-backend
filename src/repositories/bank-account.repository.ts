import { pool } from '../config/database';
import { logger } from '../config/logger';
import {
  decryptIban,
  encryptIban,
  hashIban,
  maskIban,
} from '../utils/iban-crypto';

export interface BankAccountRow {
  id: string;
  user_id: string;
  iban_encrypted: string;
  holder_name: string;
  bank_name: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface BankAccountDto {
  id: string;
  holder_name: string;
  bank_name: string | null;
  iban: string;
  iban_masked: string;
  created_at: string;
}

class BankAccountRepository {
  async upsertForUser(
    userId: string,
    iban: string,
    holderName: string,
    bankName: string | null
  ): Promise<BankAccountRow> {
    const ibanHash = hashIban(iban);
    const ibanEncrypted = encryptIban(iban);

    const query = `
      INSERT INTO bank_accounts (user_id, iban_hash, iban_encrypted, holder_name, bank_name)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, iban_hash)
      DO UPDATE SET
        iban_encrypted = EXCLUDED.iban_encrypted,
        holder_name = EXCLUDED.holder_name,
        bank_name = EXCLUDED.bank_name,
        updated_at = NOW()
      RETURNING *
    `;

    const result = await pool.query<BankAccountRow>(query, [
      userId,
      ibanHash,
      ibanEncrypted,
      holderName,
      bankName,
    ]);

    return result.rows[0];
  }

  async findByUserId(userId: string): Promise<BankAccountDto[]> {
    const result = await pool.query<BankAccountRow>(
      `SELECT * FROM bank_accounts WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId]
    );

    return result.rows.map((row) => {
      const iban = decryptIban(row.iban_encrypted);
      return {
        id: row.id,
        holder_name: row.holder_name,
        bank_name: row.bank_name,
        iban,
        iban_masked: maskIban(iban),
        created_at: row.created_at.toISOString(),
      };
    });
  }

  async findByIdForUser(id: string, userId: string): Promise<BankAccountRow | null> {
    const result = await pool.query<BankAccountRow>(
      `SELECT * FROM bank_accounts WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return result.rows[0] ?? null;
  }

  async deleteForUser(id: string, userId: string): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM bank_accounts WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async attachToOrder(
    orderId: string,
    userId: string,
    bankAccountId: string,
    iban: string,
    holderName: string,
    bankName: string | null
  ): Promise<void> {
    const result = await pool.query(
      `UPDATE orders
       SET iban = $1,
           holder_name = $2,
           bank_name = $3,
           bank_account_id = $4,
           updated_at = NOW()
       WHERE id = $5 AND user_id = $6`,
      [iban.replace(/\s+/g, '').toUpperCase(), holderName, bankName, bankAccountId, orderId, userId]
    );

    if ((result.rowCount ?? 0) === 0) {
      logger.warn('attachToOrder: order not found or not owned by user', {
        orderId,
        userId,
      });
    }
  }
}

export const bankAccountRepository = new BankAccountRepository();
