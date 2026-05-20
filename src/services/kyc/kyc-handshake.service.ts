/**
 * KYC Handshake Service
 *
 * On first login, queries SumSub by email to detect users who already completed
 * KYC on the platform or via a direct SumSub integration.  If an APPROVED record
 * is found, the user's local KYC fields are populated so they can access payment
 * details without going through the KYC flow again.
 */
import { logger } from '../../config/logger';
import { sumsubService } from '../sumsub/sumsub.service';
import {
  markSumsubChecked,
  updateUserKycFromSumsub,
} from '../../repositories/user.repository';

/**
 * Look up the user in SumSub and sync their KYC status to the local database.
 *
 * @param userId  Internal user ID
 * @param email   User's email — used as the SumSub externalUserId
 * @returns true if the user is KYC-approved, false otherwise
 */
export async function performKycHandshake(userId: string, email: string): Promise<boolean> {
  logger.info(`🔍 KYC handshake: checking SumSub for user ${userId} (${email})`);

  try {
    const applicantId = await sumsubService.findApplicantByExternalUserId(email);

    if (!applicantId) {
      // No SumSub record — mark as checked so we don't retry on every login
      await markSumsubChecked(userId);
      logger.info(`KYC handshake: no SumSub record for ${email}`);
      return false;
    }

    const { kycStatus, reviewStatus, reviewAnswer, reviewRejectType } =
      await sumsubService.getKycStatus(applicantId);

    await updateUserKycFromSumsub(
      userId,
      applicantId,
      reviewStatus ?? 'unknown',
      reviewAnswer ?? 'RED',
      reviewRejectType,
    );

    if (kycStatus) {
      logger.info(`✅ KYC handshake: user ${userId} approved via SumSub (applicant ${applicantId})`);
      return true;
    }

    logger.info(`⚠️ KYC handshake: user ${userId} found in SumSub but not approved (answer=${reviewAnswer})`);
    return false;
  } catch (error: any) {
    logger.error('KYC handshake error', { userId, email, error: error.message });
    // Non-fatal — do not block login
    return false;
  }
}
