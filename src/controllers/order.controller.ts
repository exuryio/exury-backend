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

export class OrderController {
  /**
   * POST /v1/orders
   * Crear orden: recibe quote_id, guarda la orden y devuelve id al frontend.
   */
  async createOrder(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();

    try {
      const { quote_id } = req.body;
      const userId =
        (req as any).user?.id || (await getOrCreateAnonymousUserId());

      if (!quote_id) {
        res.status(400).json({ error: 'quote_id is required' });
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

      await client.query('BEGIN');

      const orderId = uuidv4();
      const order = await orderRepository.create({
        id: orderId,
        userId,
        quoteId: quote_id,
        type: 'buy',
        base: quote.base,
        asset: quote.asset,
        fiatAmount: quote.amount,
        cryptoAmount: quote.cryptoAmount,
        exchangeRate: quote.exchangeRate,
        fee: quote.fee,
        status: OrderStatus.QUOTE_LOCKED,
      });

      await client.query('COMMIT');

      const orderNumber = order.orderNumber;
      res.status(201).json({
        id: orderId,
        order_id: orderId,
        order_number: orderNumber,
        reference: String(orderNumber),
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
        reference: String(orderNumber),
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

