/**
 * SumSub API Service
 * Handles signed requests to the SumSub KYC platform.
 * Docs: https://developers.sumsub.com/api-reference/
 */
import axios from 'axios';
import crypto from 'crypto';
import { logger } from '../../config/logger';

export interface SumsubApplicant {
  id: string;
  externalUserId: string;
  review?: {
    reviewStatus: string;
    reviewResult?: {
      reviewAnswer: string;
      reviewRejectType?: string;
    };
  };
}

export class SumsubService {
  private readonly appToken: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor() {
    this.appToken = process.env.SUMSUB_APP_TOKEN || '';
    this.secretKey = process.env.SUMSUB_SECRET_KEY || '';
    this.baseUrl = process.env.SUMSUB_BASE_URL || 'https://api.sumsub.com';
  }

  get isConfigured(): boolean {
    return Boolean(this.appToken && this.secretKey);
  }

  private createSignedHeaders(method: string, path: string, body = ''): Record<string, string> {
    const ts = Math.floor(Date.now() / 1000);
    const hmac = crypto.createHmac('sha256', this.secretKey);
    hmac.update(`${ts}${method.toUpperCase()}${path}${body}`);
    const sig = hmac.digest('hex');

    return {
      'X-App-Token': this.appToken,
      'X-App-Access-Ts': String(ts),
      'X-App-Access-Sig': sig,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Look up a SumSub applicant whose externalUserId matches the given email.
   * Returns null if not found or if credentials are not configured.
   */
  async findApplicantByEmail(email: string): Promise<SumsubApplicant | null> {
    if (!this.isConfigured) {
      logger.warn('SumSub credentials not configured, skipping KYC handshake');
      return null;
    }

    const path = `/resources/applicants/-;externalUserId=${encodeURIComponent(email)}/one`;

    try {
      const response = await axios.get<SumsubApplicant>(`${this.baseUrl}${path}`, {
        headers: this.createSignedHeaders('GET', path),
        timeout: 5000,
      });
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        logger.info(`SumSub: no applicant found for email ${email}`);
        return null;
      }
      logger.error('SumSub findApplicantByEmail error', { email, error: error.message });
      return null;
    }
  }

  isApproved(applicant: SumsubApplicant): boolean {
    return (
      applicant.review?.reviewStatus === 'completed' &&
      applicant.review?.reviewResult?.reviewAnswer === 'GREEN'
    );
  }
}

export const sumsubService = new SumsubService();
