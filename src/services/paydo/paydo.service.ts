/**
 * PayDo Integration Service
 * Handles SEPA deposits and withdrawals
 */
import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { logger } from '../../config/logger';
import { PayDoWebhook } from '../../types';

interface PayDoPayment {
  id: string;
  status: string;
  amount: number;
  currency: string;
  type: string;
  [key: string]: any;
}

class PayDoService {
  private apiKey: string;
  private baseURL: string;
  private client: AxiosInstance;

  constructor() {
    this.apiKey = process.env.PAYDO_API_KEY || '';
    this.baseURL = process.env.PAYDO_BASE_URL || 'https://paydo.com/api/v1';

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  private ensureConfigured(): void {
    if (!this.apiKey) {
      throw new Error('PAYDO_API_KEY is not configured');
    }
    if (!process.env.API_BASE_URL) {
      throw new Error('API_BASE_URL is not configured');
    }
  }

  /**
   * Create a SEPA deposit payment
   */
  async createDeposit(
    userId: string,
    amount: number,
    reference: string
  ): Promise<PayDoPayment> {
    try {
      this.ensureConfigured();
      const payload = {
        amount,
        currency: 'EUR',
        type: 'deposit',
        payment_method: 'sepa',
        reference,
        user_id: userId,
        callback_url: `${process.env.API_BASE_URL}/v1/payments/paydo/webhook`,
      };

      const response = await this.client.post<PayDoPayment>(
        '/payments',
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        }
      );

      logger.info('PayDo deposit created', {
        paymentId: response.data.id,
        userId,
        amount,
      });

      return response.data;
    } catch (error: any) {
      logger.error('Error creating PayDo deposit', {
        error: error.message,
        userId,
        amount,
      });

      throw error;
    }
  }

  /**
   * Create a SEPA withdrawal payment
   */
  async createWithdrawal(
    userId: string,
    amount: number,
    iban: string,
    reference: string
  ): Promise<PayDoPayment> {
    try {
      this.ensureConfigured();
      const payload = {
        amount,
        currency: 'EUR',
        type: 'withdrawal',
        payment_method: 'sepa',
        iban,
        reference,
        user_id: userId,
        callback_url: `${process.env.API_BASE_URL}/v1/payments/paydo/webhook`,
      };

      const response = await this.client.post<PayDoPayment>(
        '/payments',
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        }
      );

      logger.info('PayDo withdrawal created', {
        paymentId: response.data.id,
        userId,
        amount,
      });

      return response.data;
    } catch (error: any) {
      logger.error('Error creating PayDo withdrawal', {
        error: error.message,
        userId,
        amount,
      });

      throw error;
    }
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(paymentId: string): Promise<PayDoPayment> {
    try {
      const response = await this.client.get<PayDoPayment>(
        `/payments/${paymentId}`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        }
      );

      return response.data;
    } catch (error: any) {
      logger.error('Error fetching PayDo payment status', {
        error: error.message,
        paymentId,
      });

      throw error;
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(
    payload: string,
    signature: string
  ): boolean {
    try {
      const secret = process.env.PAYDO_WEBHOOK_SECRET;
      if (!secret || !signature) {
        return false;
      }

      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      logger.error('Error verifying webhook signature', { error });
      return false;
    }
  }

  /**
   * Process webhook event
   */
  async processWebhook(webhook: PayDoWebhook): Promise<void> {
    try {
      logger.info('Processing PayDo webhook', {
        event: webhook.event,
        paymentId: webhook.data.id,
      });

      // Webhook processing will be handled by the webhook controller
      // This method can be extended for additional processing
    } catch (error) {
      logger.error('Error processing PayDo webhook', { error, webhook });
      throw error;
    }
  }

}

export const paydoService = new PayDoService();

