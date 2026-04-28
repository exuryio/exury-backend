/**
 * PayDo Webhook Controller
 * Handles PayDo webhook events
 */
import { Request, Response } from 'express';
import { paydoService } from '../services/paydo/paydo.service';
import { orderRepository } from '../repositories/order.repository';
import { transactionRepository } from '../repositories/transaction.repository';
// Removed unused import
import { ledgerService } from '../services/ledger/ledger.service';
import { OrderStatus, PaymentStatus, TransactionType } from '../types';
import { logger } from '../config/logger';
import { pool } from '../config/database';

export class PayDoController {
  /**
   * POST /v1/payments/paydo/webhook
   * Handle PayDo webhook events
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();

    try {
      // Verify webhook signature
      const signature = req.headers['x-paydo-signature'] as string;
      const payload = JSON.stringify(req.body);

      if (
        process.env.NODE_ENV === 'production' &&
        !paydoService.verifyWebhookSignature(payload, signature)
      ) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      const webhook = req.body;
      const { event, data } = webhook;

      logger.info('PayDo webhook received', { event, paymentId: data.id });

      await client.query('BEGIN');

      // Find transaction by PayDo payment ID
      const txRow = await transactionRepository.findById(data.reference || '');

      if (!txRow) {
        // Try to find by PayDo transaction ID
        const transactions = await pool.query(
          'SELECT * FROM transactions WHERE paydo_transaction_id = $1',
          [data.id]
        );

        if (transactions.rows.length === 0) {
          logger.warn('Transaction not found for PayDo payment', {
            paymentId: data.id,
          });
          await client.query('COMMIT');
          res.status(200).json({ received: true });
          return;
        }

        // Process the transaction (fila SQL: order_id, user_id en snake_case)
        await this.processPayment(
          transactions.rows[0],
          data.status,
          client
        );
      } else {
        // Repositorio devuelve camelCase; normalizamos para processPayment
        await this.processPayment(
          {
            id: txRow.id,
            order_id: txRow.orderId,
            user_id: txRow.userId,
            type: txRow.type,
            amount: txRow.amount,
          },
          data.status,
          client
        );
      }

      await client.query('COMMIT');

      res.status(200).json({ received: true });
    } catch (error: any) {
      await client.query('ROLLBACK');
      logger.error('Error processing PayDo webhook', {
        error: error.message,
        body: req.body,
      });
      res.status(500).json({ error: 'Webhook processing failed' });
    } finally {
      client.release();
    }
  }

  /**
   * Process payment status update
   */
  private async processPayment(
    transaction: any,
    status: string,
    _client: any
  ): Promise<void> {
    // Update transaction status
    let newStatus: PaymentStatus;
    if (status === 'completed' || status === 'success') {
      newStatus = PaymentStatus.COMPLETED;
    } else if (status === 'failed') {
      newStatus = PaymentStatus.FAILED;
    } else {
      newStatus = PaymentStatus.PROCESSING;
    }

    await transactionRepository.update(transaction.id, {
      status: newStatus,
    });

    const orderId = transaction.order_id ?? transaction.orderId;
    const userId = transaction.user_id ?? transaction.userId;
    const txType = String(transaction.type || '').toLowerCase();

    // If payment completed, process the order
    if (newStatus !== PaymentStatus.COMPLETED || !orderId) {
      return;
    }

    const order = await orderRepository.findById(orderId);
    if (!order) {
      return;
    }

    // Venta (sell): retiro SEPA completado → orden cerrada (crypto ya liquidado en executeSellPayout)
    if (
      order.type === 'sell' &&
      (txType === 'withdrawal' || txType === TransactionType.WITHDRAWAL)
    ) {
      if (order.status === OrderStatus.PAYMENT_PENDING) {
        // Update order status
        await orderRepository.update(order.id, {
          status: OrderStatus.COMPLETED,
        });
        // No ledger EUR: el SEPA va al banco del usuario; el SELL crypto ya está en ledger
        logger.info('Sell order completed after PayDo withdrawal', {
          orderId: order.id,
          transactionId: transaction.id,
        });
      }
      return;
    }

    // Compra (buy): depósito EUR recibido → ledger + Binance buy (no aplicar a retiros)
    if (
      order.type === 'buy' &&
      order.status === OrderStatus.PAYMENT_PENDING &&
      txType !== 'withdrawal' &&
      txType !== TransactionType.WITHDRAWAL
    ) {
      // Update order status
      await orderRepository.update(order.id, {
        status: OrderStatus.PAYMENT_RECEIVED,
      });

      // Create ledger entry for EUR deposit
      await ledgerService.createEntry(
        userId,
        transaction.id,
        'EUR',
        Number(transaction.amount),
        TransactionType.DEPOSIT
      );

      // Execute Binance buy order using order service
      try {
        const { orderService } = await import('../services/order.service');
        await orderService.processOrderAfterPayment(order.id);
      } catch (error: any) {
        logger.error('Error executing Binance order', {
          error: error.message,
          orderId: order.id,
        });
        await orderRepository.update(order.id, {
          status: OrderStatus.FAILED,
        });
      }
    }
  }
}

export const paydoController = new PayDoController();
