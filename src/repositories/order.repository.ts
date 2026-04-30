/**
 * Order Repository
 * Database operations for orders
 */
import { pool } from '../config/database';
import { Order, OrderStatus } from '../types';
import { logger } from '../config/logger';

class OrderRepository {
  async create(order: Omit<Order, 'createdAt' | 'updatedAt' | 'orderNumber'>): Promise<Order> {
    // Columnas añadidas en la migración 006:
    //   - iban: IBAN en claro del payout SEPA de esa venta (null en buy). En bank_accounts sólo hay hash(iban)
    //     más metadatos (bank_name, account_holder_name); el operador usa orders.iban cuando existe.
    //   - bank_account_id: FK a bank_accounts cuando la venta referencia una cuenta guardada del usuario.
    //   - user_wallet_id: FK a user_wallets cuando la compra usó una wallet guardada.
    const query = `
      INSERT INTO orders (
        id, user_id, quote_id, type, base, asset, fiat_amount,
        crypto_amount, exchange_rate, fee, status, payment_id, binance_order_id,
        iban, bank_account_id, user_wallet_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `;

    const values = [
      order.id,
      order.userId,
      order.quoteId,
      order.type,
      order.base,
      order.asset,
      order.fiatAmount,
      order.cryptoAmount,
      order.exchangeRate,
      order.fee,
      order.status,
      order.paymentId || null,
      order.binanceOrderId || null,
      order.iban || null,
      order.bankAccountId || null,
      order.userWalletId || null,
    ];

    try {
      const result = await pool.query(query, values);
      return this.mapRowToOrder(result.rows[0]);
    } catch (error) {
      logger.error('Error creating order', { error, order });
      throw error;
    }
  }

  async findById(id: string): Promise<Order | null> {
    const query = 'SELECT * FROM orders WHERE id = $1';
    try {
      const result = await pool.query(query, [id]);
      if (result.rows.length === 0) {
        return null;
      }
      return this.mapRowToOrder(result.rows[0]);
    } catch (error) {
      logger.error('Error finding order', { error, id });
      throw error;
    }
  }

  async findByUserId(userId: string): Promise<Order[]> {
    const query = 'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC';
    try {
      const result = await pool.query(query, [userId]);
      return result.rows.map((row) => this.mapRowToOrder(row));
    } catch (error) {
      logger.error('Error finding orders by user', { error, userId });
      throw error;
    }
  }

  async update(id: string, updates: Partial<Order>): Promise<Order> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    Object.keys(updates).forEach((key) => {
      if (key !== 'id' && updates[key as keyof Order] !== undefined) {
        const dbKey = key === 'userId' ? 'user_id' :
                     key === 'quoteId' ? 'quote_id' :
                     key === 'orderNumber' ? 'order_number' :
                     key === 'fiatAmount' ? 'fiat_amount' :
                     key === 'cryptoAmount' ? 'crypto_amount' :
                     key === 'exchangeRate' ? 'exchange_rate' :
                     key === 'paymentId' ? 'payment_id' :
                     key === 'binanceOrderId' ? 'binance_order_id' :
                     key === 'bankAccountId' ? 'bank_account_id' :
                     key === 'userWalletId' ? 'user_wallet_id' :
                     key === 'createdAt' ? 'created_at' :
                     key === 'updatedAt' ? 'updated_at' : key;
        fields.push(`${dbKey} = $${paramCount}`);
        values.push(updates[key as keyof Order]);
        paramCount++;
      }
    });

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    values.push(id);
    const query = `UPDATE orders SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${paramCount} RETURNING *`;

    try {
      const result = await pool.query(query, values);
      return this.mapRowToOrder(result.rows[0]);
    } catch (error) {
      logger.error('Error updating order', { error, id, updates });
      throw error;
    }
  }

  private mapRowToOrder(row: any): Order {
    return {
      id: row.id,
      orderNumber: row.order_number != null ? Number(row.order_number) : 0,
      userId: row.user_id,
      quoteId: row.quote_id,
      type: row.type,
      base: row.base,
      asset: row.asset,
      fiatAmount: parseFloat(row.fiat_amount),
      cryptoAmount: parseFloat(row.crypto_amount),
      exchangeRate: parseFloat(row.exchange_rate),
      fee: parseFloat(row.fee),
      status: row.status as OrderStatus,
      paymentId: row.payment_id,
      binanceOrderId: row.binance_order_id,
      iban: row.iban ?? null,
      bankAccountId: row.bank_account_id ?? null,
      userWalletId: row.user_wallet_id ?? null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

export const orderRepository = new OrderRepository();

