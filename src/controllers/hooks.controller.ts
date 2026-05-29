/**
 * Hooks Controller
 * Handles third-party webhook events (SumSub, etc.)
 */
import { Request, Response } from 'express';
import { sumsubService } from '../services/sumsub/sumsub.service';
import { updateUserKycByApplicantId } from '../repositories/user.repository';
import { logger } from '../config/logger';

/** Shape of a SumSub applicantReviewed webhook payload */
interface SumsubWebhookPayload {
  applicantId?: string;
  externalUserId?: string;
  type?: string;
  reviewStatus?: string;
  reviewResult?: {
    reviewAnswer?: string;
    reviewRejectType?: string;
  };
}

export class HooksController {
  /**
   * POST /v1/hooks/sumsub
   *
   * Receives SumSub status-change notifications and updates the local `users`
   * table so KYC reads never need to hit the SumSub API.
   *
   * Security: the raw body is HMAC-SHA256 signed by SumSub and sent in the
   * `x-payload-digest` header. We verify this before touching the database.
   */
  async handleSumsubWebhook(req: Request, res: Response): Promise<void> {
    if (!sumsubService.checkDigest(req)) {
      logger.warn('SumSub webhook rejected: invalid signature');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const payload = req.body as SumsubWebhookPayload;
    const { applicantId, type, reviewStatus, reviewResult, externalUserId } = payload;

    logger.info('SumSub webhook received', { type, applicantId, externalUserId, reviewStatus });

    if (!applicantId) {
      // Acknowledge events we don't care about without erroring
      res.status(200).json({ received: true });
      return;
    }

    // Only update on review events; ignore init/pending/queued events
    const reviewableStatuses = ['completed', 'rejected'];
    if (!reviewStatus || !reviewableStatuses.includes(reviewStatus)) {
      res.status(200).json({ received: true });
      return;
    }

    try {
      const updated = await updateUserKycByApplicantId(
        applicantId,
        reviewStatus,
        reviewResult?.reviewAnswer,
        reviewResult?.reviewRejectType
      );

      if (!updated) {
        logger.warn('SumSub webhook: no user found for applicantId', { applicantId });
      } else {
        logger.info('SumSub webhook: KYC state updated', {
          applicantId,
          reviewStatus,
          reviewAnswer: reviewResult?.reviewAnswer,
        });
      }

      res.status(200).json({ received: true });
    } catch (error: any) {
      logger.error('SumSub webhook processing failed', { error: error.message, applicantId });
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
}

export const hooksController = new HooksController();
