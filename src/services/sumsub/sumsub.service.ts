/**
 * SumSub API client — applicant review status
 */
import { type Request } from 'express';
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
  levelName?: string;
  reviewStatus?: string;
  reviewResult?: {
    reviewAnswer?: string;
    reviewRejectType?: string;
  };
}

/** Minimal shape of GET /resources/applicants/-;externalUserId={id}/one */
interface SumsubApplicantBody {
  id?: string;
}

/** Shape of POST /resources/applicants response */
interface SumsubCreateApplicantBody {
  id?: string;
  externalUserId?: string;
}

/** Shape of POST /resources/accessTokens response */
interface SumsubAccessTokenBody {
  token?: string;
  userId?: string;
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

  /**
   * Look up a SumSub applicant by externalUserId (typically the user's email).
   * Returns the SumSub applicant ID, or null if no record exists.
   */
  async findApplicantByExternalUserId(externalUserId: string): Promise<string | null> {
    const id = externalUserId.trim();
    if (!id) {
      throw new Error('externalUserId is required');
    }

    const path = `/resources/applicants/-;externalUserId=${encodeURIComponent(id)}/one`;
    const url = `${this.baseUrl}${path}`;
    const headers = this.signRequest('GET', path);

    try {
      const response = await axios.get<SumsubApplicantBody>(url, {
        headers,
        timeout: 15_000,
        validateStatus: (status: number) => status === 200 || status === 404,
      });
      if (response.status === 404) return null;
      return response.data?.id ?? null;
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const payload = err.response?.data;
        const bodySnippet =
          typeof payload === 'string'
            ? payload.slice(0, 500)
            : JSON.stringify(payload ?? err.message).slice(0, 500);
        logger.error('SumSub API error (findApplicantByExternalUserId)', { status, body: bodySnippet });
        throw new Error(`SumSub API HTTP ${status ?? 'unknown'}`, { cause: err });
      }
      throw err;
    }
  }

  /**
   * Create a new SumSub applicant for the given externalUserId and email.
   * Returns the new SumSub applicant ID.
   */
  async createApplicant(externalUserId: string, email: string): Promise<string> {
    const levelName = sumsubConfig.levelName;
    const path = `/resources/applicants?levelName=${encodeURIComponent(levelName)}`;
    const url = `${this.baseUrl}${path}`;
    const body = JSON.stringify({ externalUserId, email });
    const headers = this.signRequest('POST', path, body);

    try {
      const response = await axios.post<SumsubCreateApplicantBody>(url, body, {
        headers,
        timeout: 15_000,
        validateStatus: (status: number) => status === 200 || status === 201,
      });
      const applicantId = response.data?.id;
      if (!applicantId) {
        throw new Error('SumSub createApplicant returned no id');
      }
      return applicantId;
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const payload = err.response?.data;
        const bodySnippet =
          typeof payload === 'string'
            ? payload.slice(0, 500)
            : JSON.stringify(payload ?? err.message).slice(0, 500);
        logger.error('SumSub API error (createApplicant)', { status, body: bodySnippet });
        throw new Error(`SumSub API HTTP ${status ?? 'unknown'}`, { cause: err });
      }
      throw err;
    }
  }

  /**
   * Generate a short-lived SDK access token for the given userId.
   * The frontend uses this token to initialise the SumSub WebSDK.
   */
  async generateAccessToken(userId: string): Promise<{ token: string; userId: string }> {
    const id = userId.trim();
    if (!id) {
      throw new Error('userId is required');
    }

    const levelName = sumsubConfig.levelName;
    const body = JSON.stringify({ userId: id, levelName });
    const path = `/resources/accessTokens/sdk`;
    const url = `${this.baseUrl}${path}`;
    const headers = this.signRequest('POST', path, body);

    try {
      const response = await axios.post<SumsubAccessTokenBody>(url, body, {
        headers,
        timeout: 15_000,
        validateStatus: (status: number) => status === 200 || status === 201,
      });
      const token = response.data?.token;
      if (!token) {
        throw new Error('SumSub generateAccessToken returned no token');
      }
      return { token, userId: response.data.userId ?? id };
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const payload = err.response?.data;
        const bodySnippet =
          typeof payload === 'string'
            ? payload.slice(0, 500)
            : JSON.stringify(payload ?? err.message).slice(0, 500);
        logger.error('SumSub API error (generateAccessToken)', { status, body: bodySnippet });
        throw new Error(`SumSub API HTTP ${status ?? 'unknown'}`, { cause: err });
      }
      throw err;
    }
  }

  checkDigest(req: Request): boolean {
    const algorythmHeader = 'X-Payload-Digest-Alg';
    const algorythm: string = (typeof req.headers[algorythmHeader] === 'object' ?
      req.headers[algorythmHeader][0] :
      req.headers[algorythmHeader]) || 'HMAC_SHA256_HEX';

    const algo = {
      'HMAC_SHA1_HEX': 'sha1',
      'HMAC_SHA256_HEX': 'sha256',
      'HMAC_SHA512_HEX': 'sha512',
    }[algorythm];

    if (!algo) {
      throw new Error('Unsupported algorithm')
    }

    const calculatedDigest = crypto
      .createHmac(algo, process.env.SUMSUB_WEBHOOK_SECRET ?? '')
      .update(req.body)
      .digest('hex')

    return calculatedDigest === req.headers['x-payload-digest']
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

    if (data.levelName !== sumsubConfig.levelName) {
      throw new Error(`Unexpected levelName in SumSub response: ${data.levelName}`);
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
