/**
 * Order Service
 * Business logic for order processing.
 *
 * executeSellPayout valida el IBAN con las mismas reglas que cuentas bancarias y órdenes (isValidIban),
 * para que PayDo no reciba un formato que ya hubiésemos rechazado antes en HTTP.
 */
import { orderRepository } from '../repositories/order.repository';
import { binanceService } from './binance/binance.service';
import { ledgerService } from './ledger/ledger.service';
import { transactionRepository } from '../repositories/transaction.repository';
import { paydoService } from './paydo/paydo.service';
import { OrderStatus, TransactionType, PaymentStatus } from '../types';
import { logger } from '../config/logger';
import { v4 as uuidv4 } from 'uuid';
import { normalizeIban, isValidIban } from '../repositories/bank-account.repository';

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

      if (order.type === 'sell') {
        throw new Error(
          'Sell orders use executeSellPayout; do not call processOrderAfterPayment'
        );
      }

      if (order.status !== OrderStatus.PAYMENT_RECEIVED) {
        throw new Error(`Order is not in payment_received status: ${order.status}`);
      }

      const binanceOrder = await binanceService.executeBuy(
        order.asset,
        order.fiatAmount
      );

      // Update order with Binance order ID
      await orderRepository.update(order.id, {
        binanceOrderId: binanceOrder.orderId.toString(),
        status: OrderStatus.COMPLETED,
      });

      // Create transaction for crypto trade
      const cryptoTransactionId = uuidv4();
      await transactionRepository.create({
        id: cryptoTransactionId,
        userId: order.userId,
        orderId: order.id,
        type: TransactionType.BUY,
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
        TransactionType.BUY
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

  /**
   * Sell: Binance sell + retiro SEPA PayDo (llamar cuando el depósito crypto esté verificado).
   */
  async executeSellPayout(
    orderId: string,
    userId: string,
    ibanRaw: string
  ): Promise<{
    payment_id: string;
    withdrawal_transaction_id: string;
    crypto_transaction_id: string;
    binance_order_id: string;
  }> {
    // El controller ya validó y persistió; repetimos aquí como red de seguridad antes de PayDo.
    const iban = normalizeIban(ibanRaw.trim());
    if (!isValidIban(iban)) {
      throw new Error('Invalid IBAN');
    }

    const order = await orderRepository.findById(orderId);
    if (!order) {
      throw new Error('Order not found');
    }
    if (order.userId !== userId) {
      throw new Error('Access denied');
    }
    if (order.type !== 'sell') {
      throw new Error('Order is not a sell order');
    }
    if (order.status !== OrderStatus.QUOTE_LOCKED) {
      throw new Error(
        `Order must be in ${OrderStatus.QUOTE_LOCKED} to execute payout; current: ${order.status}`
      );
    }

    const binanceOrder = await binanceService.executeSell(
      order.asset,
      order.cryptoAmount
    );

    // Create transaction for crypto trade (sell)
    const cryptoTransactionId = uuidv4();
    await transactionRepository.create({
      id: cryptoTransactionId,
      userId: order.userId,
      orderId: order.id,
      type: TransactionType.SELL,
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
      TransactionType.SELL
    );

    const withdrawalTxId = uuidv4();
    await transactionRepository.create({
      id: withdrawalTxId,
      userId: order.userId,
      orderId: order.id,
      type: TransactionType.WITHDRAWAL,
      asset: 'EUR',
      amount: order.fiatAmount,
      status: PaymentStatus.PENDING,
    });

    const paydoPayment = await paydoService.createWithdrawal(
      order.userId,
      order.fiatAmount,
      iban,
      withdrawalTxId
    );

    await transactionRepository.update(withdrawalTxId, {
      paydoTransactionId: paydoPayment.id,
      status: PaymentStatus.PROCESSING,
    });

    // Update order with Binance order ID + PayDo payment (pendiente webhook)
    await orderRepository.update(order.id, {
      status: OrderStatus.PAYMENT_PENDING,
      paymentId: paydoPayment.id,
      binanceOrderId: binanceOrder.orderId.toString(),
    });

    logger.info('Sell payout initiated (Binance + PayDo)', {
      orderId: order.id,
      paymentId: paydoPayment.id,
      withdrawalTxId,
    });

    return {
      payment_id: paydoPayment.id,
      withdrawal_transaction_id: withdrawalTxId,
      crypto_transaction_id: cryptoTransactionId,
      binance_order_id: binanceOrder.orderId.toString(),
    };
  }
}

export const orderService = new OrderService();
