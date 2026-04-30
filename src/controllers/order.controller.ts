/**
 * Order Controller
 * Handles order-related API requests.
 * PayDo: crear orden no llama a PayDo. Retiro SEPA (venta) se inicia en POST /orders/:id/sell/payout.
 *
 * Ventas SEPA: el IBAN en claro puede vivir en orders.iban; bank_accounts guarda hash + banco + titular
 * (ver migración 006 y BankAccountRepository). Mantener ambos mundos alineados en createOrder / sell/payout.
 */
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { orderRepository } from '../repositories/order.repository';
import { pricingService } from '../services/pricing/pricing.service';
import { orderService } from '../services/order.service';
import { getOrCreateAnonymousUserId } from '../repositories/user.repository';
import { OrderStatus, Order } from '../types';
import { logger } from '../config/logger';
import { pool } from '../config/database';
// IBAN: normalizeIban + isValidIban (mismo criterio que BankAccountController; hash en DB, texto plano en orders.iban).
import {
  bankAccountRepository,
  isValidIban,
  normalizeIban,
} from '../repositories/bank-account.repository';
import { userWalletRepository } from '../repositories/user-wallet.repository';

/** Referencia obligatoria: siempre 5 dígitos (ej. 00001, 00005) */
function formatReference(orderNumber: number): string {
  return String(orderNumber).padStart(5, '0');
}

/**
 * Sanea una orden antes de devolverla al cliente.
 * - Quita información sensible/PII: `iban` (texto plano) y `fee` (coste interno).
 * - Mantiene un flag `has_iban` para que la UI sepa que ya hay un IBAN registrado
 *   sin necesidad de exponerlo. El IBAN sigue viviendo en DB para el operador.
 * Cualquier endpoint que devuelva órdenes al cliente debe pasar por aquí.
 */
function sanitizeOrderForClient(order: Order, orderNumber: number) {
  return {
    id: order.id,
    order_id: order.id,
    order_number: orderNumber,
    quote_id: order.quoteId,
    type: order.type,
    base: order.base,
    asset: order.asset,
    fiat_amount: order.fiatAmount,
    amount: order.fiatAmount,
    crypto_amount: order.cryptoAmount,
    exchange_rate: order.exchangeRate,
    status: order.status,
    reference: formatReference(orderNumber),
    has_iban: Boolean(order.iban),
    bank_account_id: order.bankAccountId ?? null,
    user_wallet_id: order.userWalletId ?? null,
    payment_id: order.paymentId ?? null,
    created_at: order.createdAt,
    updated_at: order.updatedAt,
  };
}

export class OrderController {
  /**
   * POST /v1/orders
   * Crear orden: recibe quote_id, guarda la orden y devuelve id al frontend.
   */
  async createOrder(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();

    try {
      const {
        quote_id,
        type,
        amount_eur,
        amount_crypto,
        // Sell: IBAN en claro opcional aquí; si viene, obligatorio enviar también banco + titular
        // para poder hacer upsert en bank_accounts (reglas NOT NULL). Alternativa: solo bank_account_id.
        iban: rawIban,
        bank_name: sellBankName,
        account_holder_name: sellAccountHolderName,
        bank_account_id,
        // Buy: wallet de destino ya guardada por el usuario.
        user_wallet_id,
        // Buy: alternativa a user_wallet_id — persistimos en caliente.
        wallet_address,
        wallet_network,
      } = req.body;
      const userId = (req as any).user?.id || (await getOrCreateAnonymousUserId());

      if (!quote_id) {
        res.status(400).json({ error: 'quote_id is required' });
        return;
      }

      const orderType = type === 'sell' ? 'sell' : 'buy';
      if (type !== undefined && type !== 'buy' && type !== 'sell') {
        res.status(400).json({ error: "type must be 'buy' or 'sell'" });
        return;
      }

      const isValid = await pricingService.validateQuote(quote_id);
      if (!isValid) {
        res.status(410).json({ error: 'Quote has expired or is invalid' });
        return;
      }

      const quote = await pricingService.getQuote(quote_id);
      if (!quote) {
        res.status(404).json({ error: 'Quote not found' });
        return;
      }

      const requestedEur = Number(amount_eur);
      const requestedCrypto = Number(amount_crypto);
      const hasValidSellAmounts =
        orderType === 'sell' &&
        Number.isFinite(requestedEur) &&
        Number.isFinite(requestedCrypto) &&
        requestedEur > 0 &&
        requestedCrypto > 0;

      const fiatAmount = hasValidSellAmounts ? requestedEur : quote.amount;
      const cryptoAmount = hasValidSellAmounts ? requestedCrypto : quote.cryptoAmount;
      const exchangeRate = cryptoAmount > 0 ? fiatAmount / cryptoAmount : quote.exchangeRate;
      const fee = hasValidSellAmounts ? fiatAmount * 0.005 : quote.fee;

      // --- Resolución de bank_account_id (sell) / user_wallet_id (buy) ---
      let bankAccountId: string | null = null;
      let userWalletId: string | null = null;
      let ibanForOrder: string | null = null;

      if (orderType === 'sell') {
        if (typeof rawIban === 'string' && rawIban.trim().length > 0) {
          // Guardamos IBAN en la orden para el operador y sincronizamos bank_accounts (hash + banco + titular).
          ibanForOrder = normalizeIban(rawIban);
          if (!isValidIban(ibanForOrder)) {
            res.status(400).json({ error: 'Invalid IBAN format' });
            return;
          }
          const bn =
            typeof sellBankName === 'string' && sellBankName.trim().length > 0
              ? sellBankName.trim()
              : '';
          const hn =
            typeof sellAccountHolderName === 'string' &&
            sellAccountHolderName.trim().length > 0
              ? sellAccountHolderName.trim()
              : '';
          if (!bn || !hn) {
            res.status(400).json({
              error:
                'bank_name and account_holder_name are required when iban is provided',
            });
            return;
          }
          const up = await bankAccountRepository.upsert(userId, ibanForOrder, bn, hn);
          bankAccountId = up.id;
        } else if (typeof bank_account_id === 'string' && bank_account_id.length > 0) {
          const acc = await bankAccountRepository.findByIdForUser(bank_account_id, userId);
          if (!acc) {
            res.status(400).json({ error: 'bank_account_id does not belong to user' });
            return;
          }
          bankAccountId = acc.id;
          // bank_accounts solo tiene hash: orders.iban sigue vacío hasta que el cliente envíe el IBAN
          // en POST .../sell/payout (allí se persiste y se re-hace upsert con titular/banco).
        }
      }

      if (orderType === 'buy') {
        if (typeof user_wallet_id === 'string' && user_wallet_id.length > 0) {
          const w = await userWalletRepository.findByIdForUser(user_wallet_id, userId);
          if (!w) {
            res.status(400).json({ error: 'user_wallet_id does not belong to user' });
            return;
          }
          userWalletId = w.id;
        } else if (
          typeof wallet_address === 'string' &&
          wallet_address.trim().length > 0 &&
          typeof wallet_network === 'string' &&
          wallet_network.trim().length > 0
        ) {
          const up = await userWalletRepository.upsert(
            userId,
            wallet_address,
            wallet_network,
            null
          );
          userWalletId = up.id;
        }
      }

      await client.query('BEGIN');

      const orderId = uuidv4();
      const order = await orderRepository.create({
        id: orderId,
        userId,
        quoteId: quote_id,
        type: orderType,
        base: quote.base,
        asset: quote.asset,
        fiatAmount,
        cryptoAmount,
        exchangeRate,
        fee,
        status: OrderStatus.QUOTE_LOCKED,
        iban: ibanForOrder,
        bankAccountId,
        userWalletId,
      });

      await client.query('COMMIT');

      const orderNumber = order.orderNumber;
      res.status(201).json({
        id: orderId,
        order_id: orderId,
        order_number: orderNumber,
        reference: formatReference(orderNumber),
        status: OrderStatus.QUOTE_LOCKED,
      });
    } catch (error: any) {
      await client.query('ROLLBACK');
      logger.error('Error creating order', { error: error.message });
      res.status(500).json({
        error: 'Failed to create order',
        message: error.message,
      });
    } finally {
      client.release();
    }
  }

  /**
   * GET /v1/orders/:id
   * Devuelve la orden (importe, estado, referencia).
   */
  async getOrder(
    req: Request,
    res: Response,
    expectedType?: 'buy' | 'sell'
  ): Promise<void> {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id || (await getOrCreateAnonymousUserId());

      const order = await orderRepository.findById(id);
      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      if (order.userId !== userId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      // Si la ruta usada declara un tipo (/orders/sell/:id o /orders/buy/:id)
      // y la orden no coincide, devolvemos 404 para no filtrar la existencia
      // de órdenes de otro tipo bajo la misma URL.
      if (expectedType && order.type !== expectedType) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      const orderNumber = order.orderNumber;
      if (orderNumber === 0) {
        logger.warn('order_number is 0: run migration 005_order_number.sql in production', { orderId: order.id });
      }
      res.json(sanitizeOrderForClient(order, orderNumber));
    } catch (error: any) {
      logger.error('Error getting order', { error: error.message });
      res.status(500).json({
        error: 'Failed to get order',
        message: error.message,
      });
    }
  }

  /**
   * GET /v1/orders
   * Get user's orders
   */
  async getUserOrders(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id || (await getOrCreateAnonymousUserId());

      const orders = await orderRepository.findByUserId(userId);

      // Saneamos cada orden para que el listado tampoco filtre IBAN/fee.
      res.json({
        orders: orders.map((o) => sanitizeOrderForClient(o, o.orderNumber)),
      });
    } catch (error: any) {
      logger.error('Error getting user orders', { error: error.message });
      res.status(500).json({
        error: 'Failed to get orders',
        message: error.message,
      });
    }
  }

  /**
   * POST /v1/orders/:id/sell/payout
   * Tras verificar depósito crypto en custodia: ejecuta venta en Binance y retiro SEPA vía PayDo.
   *
   * Antes del payout debemos tener IBAN efectivo + banco + titular para cumplir bank_accounts:
   * - Si el body trae iban nuevo: validamos formato y exigimos bank_name + account_holder_name en el body.
   * - Si no hay iban en el body pero la orden ya tiene orders.iban: reutilizamos ese valor.
   * - Si faltan banco/titular en el body pero la orden tiene bank_account_id: los leemos del registro guardado.
   * - upsert en bank_accounts y, si la orden aún no tenía iban, lo grabamos en orders antes de PayDo.
   */
  async initiateSellPayout(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const {
        iban: rawIban,
        bank_name: bodyBankName,
        account_holder_name: bodyHolderName,
      } = req.body as {
        iban?: string;
        bank_name?: string;
        account_holder_name?: string;
      };
      const userId = (req as any).user?.id || (await getOrCreateAnonymousUserId());

      // Solo strings con contenido tras trim; si vienen vacíos, más abajo intentamos leer banco/titular desde bank_accounts.
      const trimNonEmpty = (v: unknown): string =>
        typeof v === 'string' && v.trim().length > 0 ? v.trim() : '';

      const existing = await orderRepository.findById(id);
      if (!existing) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      if (existing.userId !== userId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Si el front envía iban en este POST, sustituye / complementa el valor guardado en la orden.
      const sendingNewIban =
        typeof rawIban === 'string' && rawIban.trim().length > 0;

      let effectiveIban: string | null = null;
      if (sendingNewIban) {
        effectiveIban = normalizeIban(rawIban!);
        if (!isValidIban(effectiveIban)) {
          res.status(400).json({ error: 'Invalid IBAN format' });
          return;
        }
      } else {
        // Reutilización del flujo “IBAN ya capturado al crear la orden”.
        effectiveIban = existing.iban ?? null;
      }

      if (!effectiveIban) {
        res.status(400).json({ error: 'iban is required' });
        return;
      }

      let bankName = trimNonEmpty(bodyBankName);
      let holderName = trimNonEmpty(bodyHolderName);

      // Si el cliente no repite banco/titular, intentamos hidratar desde la cuenta ya vinculada a la orden.
      if (!bankName || !holderName) {
        if (existing.bankAccountId) {
          const acc = await bankAccountRepository.findByIdForUser(
            existing.bankAccountId,
            userId
          );
          if (acc) {
            bankName = acc.bank_name;
            holderName = acc.account_holder_name;
          }
        }
      }

      if (!bankName || !holderName) {
        res.status(400).json({
          error: 'bank_name and account_holder_name are required',
        });
        return;
      }

      // Mantiene bank_accounts coherente con el último IBAN efectivo del payout (misma huella usuario + hash).
      await bankAccountRepository.upsert(userId, effectiveIban, bankName, holderName);

      // Caso creación solo con bank_account_id: aquí es la primera vez que guardamos el texto plano en orders.
      if (!existing.iban) {
        await orderRepository.update(id, { iban: effectiveIban });
      }

      const result = await orderService.executeSellPayout(id, userId, effectiveIban);
      res.status(200).json(result);
    } catch (error: any) {
      const msg = error?.message || 'Failed to initiate sell payout';
      logger.error('Error initiating sell payout', { error: msg });
      if (msg.includes('Order not found')) {
        res.status(404).json({ error: msg });
        return;
      }
      if (msg.includes('Access denied')) {
        res.status(403).json({ error: msg });
        return;
      }
      res.status(400).json({ error: msg });
    }
  }
}

export const orderController = new OrderController();

