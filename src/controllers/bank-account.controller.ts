/**
 * Bank Account Controller
 * Endpoints para que el usuario liste, guarde y borre sus cuentas bancarias
 * "verificadas". El IBAN nunca se devuelve (solo se usa para calcular el hash).
 *
 * Regla de negocio: cada alta debe incluir IBAN + nombre del banco + titular; la tabla
 * bank_accounts guarda hash + esos metadatos para operaciones SEPA sin exponer el IBAN por API.
 */
import { Request, Response } from 'express';
import {
  bankAccountRepository,
  normalizeIban,
  isValidIban,
} from '../repositories/bank-account.repository';
import { logger } from '../config/logger';

function getAuthUserId(req: Request): string {
  const user = (req as any).user;
  if (!user?.id) throw new Error('UNAUTHENTICATED');
  return user.id as string;
}

export class BankAccountController {
  /** GET /v1/users/me/bank-accounts */
  async list(req: Request, res: Response): Promise<void> {
    try {
      const userId = getAuthUserId(req);
      const rows = await bankAccountRepository.findAllByUser(userId);
      res.json({
        accounts: rows.map((r) => ({
          id: r.id,
          bank_name: r.bank_name,
          account_holder_name: r.account_holder_name,
          created_at: r.created_at,
        })),
      });
    } catch (err: any) {
      if (err?.message === 'UNAUTHENTICATED') {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      logger.error('Error listando bank_accounts', { error: err?.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * POST /v1/users/me/bank-accounts
   * body: { iban, bank_name, account_holder_name } — los tres obligatorios (strings no vacíos tras trim).
   * Persistencia vía repositorio: upsert por hash del IBAN normalizado.
   */
  async create(req: Request, res: Response): Promise<void> {
    try {
      const userId = getAuthUserId(req);
      const { iban, bank_name, account_holder_name } = req.body || {};

      if (!iban || typeof iban !== 'string') {
        res.status(400).json({ error: 'iban is required' });
        return;
      }
      const normalized = normalizeIban(iban);
      if (!isValidIban(normalized)) {
        res.status(400).json({ error: 'Invalid IBAN format' });
        return;
      }

      // Metadatos obligatorios alineados con columnas NOT NULL en bank_accounts (migración 006).
      const bankName =
        typeof bank_name === 'string' && bank_name.trim().length > 0 ? bank_name.trim() : '';
      const holderName =
        typeof account_holder_name === 'string' && account_holder_name.trim().length > 0
          ? account_holder_name.trim()
          : '';

      if (!bankName) {
        res.status(400).json({ error: 'bank_name is required' });
        return;
      }
      if (!holderName) {
        res.status(400).json({ error: 'account_holder_name is required' });
        return;
      }

      const row = await bankAccountRepository.upsert(userId, normalized, bankName, holderName);
      res.status(201).json({
        id: row.id,
        bank_name: row.bank_name,
        account_holder_name: row.account_holder_name,
        created_at: row.created_at,
      });
    } catch (err: any) {
      if (err?.message === 'UNAUTHENTICATED') {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      logger.error('Error creando bank_account', { error: err?.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /** DELETE /v1/users/me/bank-accounts/:id */
  async remove(req: Request, res: Response): Promise<void> {
    try {
      const userId = getAuthUserId(req);
      const { id } = req.params;
      const ok = await bankAccountRepository.deleteForUser(id, userId);
      if (!ok) {
        res.status(404).json({ error: 'Bank account not found' });
        return;
      }
      res.status(204).send();
    } catch (err: any) {
      if (err?.message === 'UNAUTHENTICATED') {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      logger.error('Error eliminando bank_account', { error: err?.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const bankAccountController = new BankAccountController();
