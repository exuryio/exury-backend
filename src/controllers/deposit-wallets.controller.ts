/**
 * Deposit Wallets Controller
 * Expone las direcciones de recepción de Exury agrupadas por activo y red.
 * Fuente de verdad: env var EXURY_DEPOSIT_WALLETS_JSON (JSON con la estructura
 * { [ASSET]: [ { value, label, address } ] }).
 *
 * No hay fallback local: producción debe publicar direcciones solo desde entorno.
 */
import { Request, Response } from 'express';
import { logger } from '../config/logger';

export interface DepositNetwork {
  value: string;
  label: string;
  address: string;
}

export type DepositWalletsMap = Record<string, DepositNetwork[]>;

let cached: DepositWalletsMap | null = null;

function resolveWallets(): DepositWalletsMap {
  if (cached) return cached;

  const raw = process.env.EXURY_DEPOSIT_WALLETS_JSON;
  if (!raw || raw.trim().length === 0) {
    throw new Error('EXURY_DEPOSIT_WALLETS_JSON is not configured');
  }

  try {
    const parsed = JSON.parse(raw) as DepositWalletsMap;
    if (parsed && typeof parsed === 'object') {
      cached = parsed;
      return cached;
    }
  } catch (err: any) {
    logger.error('EXURY_DEPOSIT_WALLETS_JSON no es JSON válido', {
      error: err?.message,
    });
  }

  throw new Error('EXURY_DEPOSIT_WALLETS_JSON is invalid');
}

export class DepositWalletsController {
  /**
   * GET /v1/deposit-wallets
   * Endpoint público: el sell page lo consume al cargar.
   */
  getDepositWallets(_req: Request, res: Response): void {
    try {
      res.json({ wallets: resolveWallets() });
    } catch (err: any) {
      logger.error('Deposit wallets are not configured', { error: err?.message });
      res.status(500).json({ error: 'Deposit wallets are not configured' });
    }
  }
}

export const depositWalletsController = new DepositWalletsController();
