/**
 * Order Controller
 * Handles order-related API requests.
 * PayDo se usa solo en el webhook cuando el banco avisa; crear orden no depende de PayDo.
 */
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { orderRepository } from '../repositories/order.repository';
import { pricingService } from '../services/pricing/pricing.service';
import { getOrCreateAnonymousUserId } from '../repositories/user.repository';
import { OrderStatus } from '../types';
import { logger } from '../config/logger';
import { pool } from '../config/database';

/** Referencia obligatoria: siempre 5 dígitos (ej. 00001, 00005) */
function formatReference(orderNumber: number): string {
  return String(orderNumber).padStart(5, '0');
}

export class OrderController {
  /**
   * POST /v1/orders
   * Crear orden: recibe quote_id, guarda la orden y devuelve id al frontend.
   */
  async createOrder(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();

    try {
      const { quote_id, type, amount_eur, amount_crypto } = req.body;
      const userId =
        (req as any).user?.id || (await getOrCreateAnonymousUserId());

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
  async getOrder(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userId =
        (req as any).user?.id || (await getOrCreateAnonymousUserId());

      const order = await orderRepository.findById(id);
      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      if (order.userId !== userId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const orderNumber = order.orderNumber;
      if (orderNumber === 0) {
        logger.warn('order_number is 0: run migration 005_order_number.sql in production', { orderId: order.id });
      }
      res.json({
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
        fee: order.fee,
        status: order.status,
        reference: formatReference(orderNumber),
        iban: null,
        payment_id: order.paymentId ?? null,
        created_at: order.createdAt,
        updated_at: order.updatedAt,
      });
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
      const userId =
        (req as any).user?.id || (await getOrCreateAnonymousUserId());

      const orders = await orderRepository.findByUserId(userId);

      res.json({ orders });
    } catch (error: any) {
      logger.error('Error getting user orders', { error: error.message });
      res.status(500).json({
        error: 'Failed to get orders',
        message: error.message,
      });
    }
  }
}

export const orderController = new OrderController();

