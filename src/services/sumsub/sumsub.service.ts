/**
 * SumSub API client — applicant review status
 */
import axios from 'axios';
import crypto from 'crypto';
import sumsubConfig from '../../config/sumsub';
import { logger } from '../../config/logger';

export interface KYCResponse {
  /** True when Sumsub reports `reviewStatus: completed` and `reviewAnswer: GREEN` */
  kycStatus: boolean;
  reviewStatus?: string;
  reviewAnswer?: string;
  reviewRejectType?: string;
  applicantId?: string;
}

/** Shape of GET /resources/applicants/{id}/status (see Sumsub docs) */
interface SumsubApplicantStatusBody {
  reviewStatus?: string;
  reviewResult?: {
    reviewAnswer?: string;
    reviewRejectType?: string;
  };
}

class SumsubService {
  private readonly baseUrl = sumsubConfig.baseUrl.replace(/\/+$/, '');

  private signRequest(method: string, pathWithQuery: string, body: string = ''): Record<string, string> {
    const appToken = sumsubConfig.appToken;
    const secretKey = sumsubConfig.secretKey;
    if (!appToken || !secretKey) {
      const vars =
        sumsubConfig.credentialMode === 'production'
          ? 'SUMSUB_APP_TOKEN_PROD and SUMSUB_SECRET_KEY_PROD'
          : 'SUMSUB_APP_TOKEN_SANDBOX and SUMSUB_SECRET_KEY_SANDBOX';
      throw new Error(
        `SumSub is not configured for "${sumsubConfig.credentialMode}" (${vars}). ` +
          'Override mode with SUMSUB_ENV or SUMSUB_USE_PRODUCTION if needed.',
      );
    }

    const ts = Math.floor(Date.now() / 1000).toString();
    const payload = ts + method.toUpperCase() + pathWithQuery + body;

    const signature = crypto.createHmac('sha256', secretKey).update(payload).digest('hex');

    return {
      'X-App-Token': appToken,
      'X-App-Access-Ts': ts,
      'X-App-Access-Sig': signature,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async getKycStatus(applicantId: string): Promise<KYCResponse> {
    const id = applicantId.trim();
    if (!id) {
      throw new Error('applicantId is required');
    }

    const path = `/resources/applicants/${encodeURIComponent(id)}/status`;
    const url = `${this.baseUrl}${path}`;
    const headers = this.signRequest('GET', path);

    let data: SumsubApplicantStatusBody;
    try {
      const response = await axios.get<SumsubApplicantStatusBody>(url, {
        headers,
        timeout: 15_000,
        validateStatus: (status: number) => status === 200,
      });
      data = response.data ?? {};
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const payload = err.response?.data;
        const bodySnippet =
          typeof payload === 'string'
            ? payload.slice(0, 500)
            : JSON.stringify(payload ?? err.message).slice(0, 500);
        logger.error('SumSub API error', { status, body: bodySnippet });
        throw new Error(`SumSub API HTTP ${status ?? 'unknown'}`, { cause: err });
      }
      throw err;
    }

    const reviewResult = data.reviewResult ?? {};
    const reviewStatus = data.reviewStatus;
    const reviewAnswer = reviewResult.reviewAnswer;
    const reviewRejectType = reviewResult.reviewRejectType;

    const kycStatus = reviewStatus === 'completed' && reviewAnswer === 'GREEN';

    return {
      kycStatus,
      reviewStatus,
      reviewAnswer,
      reviewRejectType,
      applicantId: id,
    };
  }
}

export const sumsubService = new SumsubService();
