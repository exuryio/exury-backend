/**
 * User Wallet Controller
 * Endpoints para que el usuario gestione sus wallets propias (destino para buy,
 * origen declarado en sell). La dirección se guarda en claro porque es pública
 * on-chain y necesitamos leerla para transferir/auditar.
 */
import { Request, Response } from 'express';
import { userWalletRepository } from '../repositories/user-wallet.repository';
import { logger } from '../config/logger';

function getAuthUserId(req: Request): string {
  const user = (req as any).user;
  if (!user?.id) throw new Error('UNAUTHENTICATED');
  return user.id as string;
}

function isLikelyAddress(value: string): boolean {
  // Permisivo: 16-128 chars, alfanuméricos + posibles prefijos 0x / bc1.
  return typeof value === 'string' && value.trim().length >= 16 && value.trim().length <= 128;
}

export class UserWalletController {
  /** GET /v1/users/me/wallets */
  async list(req: Request, res: Response): Promise<void> {
    try {
      const userId = getAuthUserId(req);
      const rows = await userWalletRepository.findAllByUser(userId);
      res.json({
        wallets: rows.map((r) => ({
          id: r.id,
          address: r.address,
          network: r.network,
          name: r.name,
          created_at: r.created_at,
        })),
      });
    } catch (err: any) {
      if (err?.message === 'UNAUTHENTICATED') {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      logger.error('Error listando user_wallets', { error: err?.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /** POST /v1/users/me/wallets  body: { address, network, name? } */
  async create(req: Request, res: Response): Promise<void> {
    try {
      const userId = getAuthUserId(req);
      const { address, network, name } = req.body || {};

      if (!address || typeof address !== 'string' || !isLikelyAddress(address)) {
        res.status(400).json({ error: 'Invalid wallet address' });
        return;
      }
      if (!network || typeof network !== 'string') {
        res.status(400).json({ error: 'network is required' });
        return;
      }

      const walletName =
        typeof name === 'string' && name.trim().length > 0 ? name.trim() : null;

      const row = await userWalletRepository.upsert(userId, address, network, walletName);
      res.status(201).json({
        id: row.id,
        address: row.address,
        network: row.network,
        name: row.name,
        created_at: row.created_at,
      });
    } catch (err: any) {
      if (err?.message === 'UNAUTHENTICATED') {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      logger.error('Error creando user_wallet', { error: err?.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /** DELETE /v1/users/me/wallets/:id */
  async remove(req: Request, res: Response): Promise<void> {
    try {
      const userId = getAuthUserId(req);
      const { id } = req.params;
      const ok = await userWalletRepository.deleteForUser(id, userId);
      if (!ok) {
        res.status(404).json({ error: 'Wallet not found' });
        return;
      }
      res.status(204).send();
    } catch (err: any) {
      if (err?.message === 'UNAUTHENTICATED') {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      logger.error('Error eliminando user_wallet', { error: err?.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const userWalletController = new UserWalletController();
