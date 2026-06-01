import { type Response } from 'express';
import { pool } from '../config/database';
import { bankAccountRepository } from '../repositories/bank-account.repository';
import { userExistsById } from '../repositories/user.repository';
import { AuthenticatedRequest } from '../types/authenticatedRequest';
import { logger } from '../config/logger';
import { normalizeIban } from '../utils/iban-crypto';

const ANONYMOUS_EMAIL = 'anonymous@exury.io';

function isValidIban(iban: string): boolean {
  const n = normalizeIban(iban);
  return /^[A-Z]{2}\d{13,32}$/.test(n);
}

async function requireRealUserId(req: AuthenticatedRequest): Promise<string | null> {
  const userId = req.user?.userId;
  if (!userId || !(await userExistsById(userId))) {
    return null;
  }

  const result = await pool.query<{ email: string }>(
    'SELECT email FROM users WHERE id = $1',
    [userId]
  );
  const email = result.rows[0]?.email?.toLowerCase();
  if (!email || email === ANONYMOUS_EMAIL) {
    return null;
  }

  return userId;
}

export class BankAccountController {
  /** GET /v1/users/me/bank-accounts */
  async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = await requireRealUserId(req);
      if (!userId) {
        res.status(401).json({
          error: 'Authentication required',
          message: 'Inicia sesión para ver tus cuentas bancarias guardadas.',
        });
        return;
      }

      const accounts = await bankAccountRepository.findByUserId(userId);
      res.json({ accounts });
    } catch (error: any) {
      logger.error('list bank accounts failed', { error: error.message });
      res.status(500).json({ error: 'Failed to load bank accounts' });
    }
  }

  /** POST /v1/users/me/bank-accounts */
  async save(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = await requireRealUserId(req);
      if (!userId) {
        res.status(401).json({
          error: 'Authentication required',
          message: 'Inicia sesión para guardar tu cuenta bancaria de forma segura.',
        });
        return;
      }

      const { iban, holder_name, bank_name, order_id } = req.body as {
        iban?: string;
        holder_name?: string;
        bank_name?: string;
        order_id?: string;
      };

      if (!iban || !holder_name?.trim()) {
        res.status(400).json({
          error: 'iban and holder_name are required',
        });
        return;
      }

      if (!isValidIban(iban)) {
        res.status(400).json({ error: 'Invalid IBAN format' });
        return;
      }

      const normalized = normalizeIban(iban);
      const account = await bankAccountRepository.upsertForUser(
        userId,
        normalized,
        holder_name.trim(),
        bank_name?.trim() || null
      );

      if (order_id) {
        await bankAccountRepository.attachToOrder(
          order_id,
          userId,
          account.id,
          normalized,
          holder_name.trim(),
          bank_name?.trim() || null
        );
      }

      res.status(201).json({
        id: account.id,
        holder_name: account.holder_name,
        bank_name: account.bank_name,
        iban: normalized,
        created_at: account.created_at,
      });
    } catch (error: any) {
      logger.error('save bank account failed', { error: error.message });
      res.status(500).json({ error: 'Failed to save bank account' });
    }
  }

  /** DELETE /v1/users/me/bank-accounts/:id */
  async remove(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = await requireRealUserId(req);
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const deleted = await bankAccountRepository.deleteForUser(
        req.params.id,
        userId
      );
      if (!deleted) {
        res.status(404).json({ error: 'Bank account not found' });
        return;
      }

      res.status(204).send();
    } catch (error: any) {
      logger.error('delete bank account failed', { error: error.message });
      res.status(500).json({ error: 'Failed to delete bank account' });
    }
  }
}

export const bankAccountController = new BankAccountController();
