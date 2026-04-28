/**
 * User Wallet Repository
 * Wallets del usuario (destino para buy, origen declarado en sell).
 * Las direcciones on-chain son públicas, no se hashean; se guardan en claro
 * para poder operar manualmente (transferir al usuario en un buy, verificar
 * origen en un sell).
 */
import { pool } from '../config/database';

export interface UserWalletRow {
  id: string;
  user_id: string;
  address: string;
  network: string;
  name: string | null;
  created_at: Date;
  updated_at: Date;
}

function normalizeAddress(raw: string): string {
  return (raw || '').trim();
}

function normalizeNetwork(raw: string): string {
  return (raw || '').trim().toLowerCase();
}

class UserWalletRepository {
  async findAllByUser(userId: string): Promise<UserWalletRow[]> {
    const { rows } = await pool.query(
      `SELECT id, user_id, address, network, name, created_at, updated_at
         FROM user_wallets
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  }

  async findByIdForUser(id: string, userId: string): Promise<UserWalletRow | null> {
    const { rows } = await pool.query(
      `SELECT id, user_id, address, network, name, created_at, updated_at
         FROM user_wallets
        WHERE id = $1 AND user_id = $2
        LIMIT 1`,
      [id, userId]
    );
    return rows[0] || null;
  }

  async upsert(
    userId: string,
    address: string,
    network: string,
    name: string | null
  ): Promise<UserWalletRow> {
    const addr = normalizeAddress(address);
    const net = normalizeNetwork(network);
    const { rows } = await pool.query(
      `INSERT INTO user_wallets (user_id, address, network, name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, address, network)
         DO UPDATE SET name = COALESCE(EXCLUDED.name, user_wallets.name),
                       updated_at = NOW()
       RETURNING id, user_id, address, network, name, created_at, updated_at`,
      [userId, addr, net, name]
    );
    return rows[0];
  }

  async deleteForUser(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      'DELETE FROM user_wallets WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    return (rowCount ?? 0) > 0;
  }
}

export const userWalletRepository = new UserWalletRepository();
