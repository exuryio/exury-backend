/**
 * Order Service
 * Business logic for order processing
 */
import { orderRepository } from '../repositories/order.repository';
// Removed unused import
import { binanceService } from './binance/binance.service';
import { ledgerService } from './ledger/ledger.service';
import { transactionRepository } from '../repositories/transaction.repository';
import { OrderStatus, TransactionType, PaymentStatus } from '../types';
import { logger } from '../config/logger';
import { v4 as uuidv4 } from 'uuid';

class OrderService {
  /**
   * Process order after payment confirmation
   */
  async processOrderAfterPayment(orderId: string): Promise<void> {
    try {
      const order = await orderRepository.findById(orderId);

      if (!order) {
        throw new Error('Order not found');
      }

      if (order.status !== OrderStatus.PAYMENT_RECEIVED) {
        throw new Error(`Order is not in payment_received status: ${order.status}`);
      }

      const isSellOrder = order.type === 'sell';
      const binanceOrder = isSellOrder
        ? await binanceService.executeSell(order.asset, order.cryptoAmount)
        : await binanceService.executeBuy(order.asset, order.fiatAmount);

      // Update order with Binance order ID
      await orderRepository.update(order.id, {
        binanceOrderId: binanceOrder.orderId.toString(),
        status: OrderStatus.COMPLETED,
      });

      const transactionType = isSellOrder
        ? TransactionType.SELL
        : TransactionType.BUY;

      // Create transaction for crypto trade
      const cryptoTransactionId = uuidv4();
      await transactionRepository.create({
        id: cryptoTransactionId,
        userId: order.userId,
        orderId: order.id,
        type: transactionType,
        asset: order.asset,
        amount: order.cryptoAmount,
        status: PaymentStatus.COMPLETED,
        binanceTransactionId: binanceOrder.orderId.toString(),
      });

      // Create ledger entry for crypto
      await ledgerService.createEntry(
        order.userId,
        cryptoTransactionId,
        order.asset,
        order.cryptoAmount,
        transactionType
      );

      logger.info('Order processed successfully', {
        orderId: order.id,
        binanceOrderId: binanceOrder.orderId,
      });
    } catch (error: any) {
      logger.error('Error processing order', {
        error: error.message,
        orderId,
      });
      throw error;
    }
  }
}

export const orderService = new OrderService();

