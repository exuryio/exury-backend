/**
 * Deposit Wallets Controller
 * Expone las direcciones de recepción de Exury agrupadas por activo y red.
 * Fuente de verdad: env var EXURY_DEPOSIT_WALLETS_JSON (JSON con la estructura
 * { [ASSET]: [ { value, label, address } ] }).
 *
 * Si la env var no está definida, caemos a la estructura por defecto declarada
 * en este archivo. Esto permite:
 *   - Rotar direcciones sin redeployar el frontend.
 *   - Mantener las direcciones fuera del repositorio del frontend.
 */
import { Request, Response } from 'express';
import { logger } from '../config/logger';

export interface DepositNetwork {
  value: string;
  label: string;
  address: string;
}

export type DepositWalletsMap = Record<string, DepositNetwork[]>;

/**
 * Fallback local usado en desarrollo si la env var no está seteada.
 * En prod (Railway) se sobreescribe con EXURY_DEPOSIT_WALLETS_JSON.
 */
const DEFAULT_WALLETS: DepositWalletsMap = {
  USDC: [
    { value: 'bsc', label: 'BSC (BEP20)', address: '0x142b9c77feb86e3bce7914052e5b9a2196013201' },
    { value: 'sol', label: 'SOL (Solana)', address: 'GYHQofW1YP1kr9sAuGfTfnRrxQte7K1rPvmd9cuETkbE' },
    { value: 'eth', label: 'ETH (ERC20)', address: '0x142b9c77feb86e3bce7914052e5b9a2196013201' },
    { value: 'pol', label: 'POL (Polygon PoS)', address: '0x142b9c77feb86e3bce7914052e5b9a2196013201' },
    { value: 'algo', label: 'ALGO (Algorand)', address: 'ABCMNKINCIC3ANZTGNPYVKGLBW5QXCYLLL7MGA4PE7SOG4VYEEUBREJ4GI' },
    { value: 'avaxc', label: 'AVAX C-Chain', address: '0x142b9c77feb86e3bce7914052e5b9a2196013201' },
  ],
  BTC: [
    { value: 'bsc', label: 'BSC (BEP20)', address: '0x142b9c77feb86e3bce7914052e5b9a2196013201' },
    { value: 'eth', label: 'ETH (ERC20)', address: '0x142b9c77feb86e3bce7914052e5b9a2196013201' },
    { value: 'segwitbtc', label: 'SegWit BTC', address: 'bc1qh7t24jwelfm0zjv4x94vxxxyrkhuyqkvltuh39' },
  ],
  ETH: [
    { value: 'bsc', label: 'BSC (BEP20)', address: '0x142b9c77feb86e3bce7914052e5b9a2196013201' },
    { value: 'eth', label: 'ETH (ERC20)', address: '0x142b9c77feb86e3bce7914052e5b9a2196013201' },
    { value: 'arbitrum', label: 'Arbitrum', address: '0x142b9c77feb86e3bce7914052e5b9a2196013201' },
    { value: 'base', label: 'Base', address: '0x142b9c77feb86e3bce7914052e5b9a2196013201' },
  ],
  BNB: [
    { value: 'bsc', label: 'BSC (BEP20)', address: '0x142b9c77feb86e3bce7914052e5b9a2196013201' },
  ],
};

let cached: DepositWalletsMap | null = null;

function resolveWallets(): DepositWalletsMap {
  if (cached) return cached;

  const raw = process.env.EXURY_DEPOSIT_WALLETS_JSON;
  if (raw && raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw) as DepositWalletsMap;
      if (parsed && typeof parsed === 'object') {
        cached = parsed;
        return cached;
      }
    } catch (err: any) {
      logger.error('EXURY_DEPOSIT_WALLETS_JSON no es JSON válido; usando fallback', {
        error: err?.message,
      });
    }
  }

  cached = DEFAULT_WALLETS;
  return cached;
}

export class DepositWalletsController {
  /**
   * GET /v1/deposit-wallets
   * Endpoint público: el sell page lo consume al cargar.
   */
  getDepositWallets(_req: Request, res: Response): void {
    res.json({ wallets: resolveWallets() });
  }
}

export const depositWalletsController = new DepositWalletsController();
