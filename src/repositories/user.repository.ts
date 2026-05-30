/**
 * User Repository
 * Get or create anonymous user for orders without auth
 */
import { pool } from '../config/database';
import { logger } from '../config/logger';
import { type User } from '../types';

const ANONYMOUS_EMAIL = 'anonymous@exury.io';

let cachedAnonymousUserId: string | null = null;

/**
 * Returns the id of the anonymous user (for orders when user is not logged in).
 * Creates the user if it does not exist. Safe to call concurrently.
 */
export async function getOrCreateAnonymousUserId(): Promise<string> {
  if (cachedAnonymousUserId) {
    return cachedAnonymousUserId;
  }

  try {
    const result = await pool.query(
      `WITH ins AS (
        INSERT INTO users (id, email) VALUES (gen_random_uuid(), $1)
        ON CONFLICT (email) DO NOTHING
        RETURNING id
      )
      SELECT id FROM ins
      UNION ALL
      SELECT id FROM users WHERE email = $1
      LIMIT 1`,
      [ANONYMOUS_EMAIL]
    );

    if (result.rows.length === 0) {
      throw new Error('Failed to get or create anonymous user');
    }

    const id = result.rows[0].id;
    cachedAnonymousUserId = id;
    return id;
  } catch (error: any) {
    logger.error('getOrCreateAnonymousUserId failed', { error: error.message });
    throw error;
  }
}


export async function getUserById(userId: string) {
  try {
    const result = await pool.query<User>(
      `SELECT
        id,
        email,
        applicant_review_status,
        applicant_review_answer,
        applicant_review_reject_type,
        applicant_id,
        sumsub_checked_at
      FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error: any) {
    logger.error('getUserById failed', { userId, error: error.message });
    throw error;
  }
}

/**
 * Populate a user's KYC fields from a SumSub applicant record.
 * Also marks sumsub_checked_at so the handshake is not repeated.
 */
export async function updateUserKycFromSumsub(
  userId: string,
  applicantId: string,
  reviewStatus: string,
  reviewAnswer?: string,
  reviewRejectType?: string
): Promise<void> {
  try {
    await pool.query(
      `UPDATE users
       SET applicant_id = $1,
           applicant_review_status = $2,
           applicant_review_answer = $3,
           applicant_review_reject_type = $4,
           sumsub_checked_at = NOW(),
           updated_at = NOW()
       WHERE id = $5`,
      [applicantId, reviewStatus, reviewAnswer ?? null, reviewRejectType ?? null, userId]
    );
  } catch (error: any) {
    logger.error('updateUserKycFromSumsub failed', { userId, error: error.message });
    throw error;
  }
}

/**
 * Update KYC fields for the user who owns the given SumSub applicant_id.
 * Used by the SumSub webhook to keep local state in sync without polling.
 */
export async function updateUserKycByApplicantId(
  applicantId: string,
  reviewStatus: string,
  reviewAnswer?: string,
  reviewRejectType?: string
): Promise<boolean> {
  try {
    const result = await pool.query(
      `UPDATE users
       SET applicant_review_status = $1,
           applicant_review_answer = $2,
           applicant_review_reject_type = $3,
           sumsub_checked_at = NOW(),
           updated_at = NOW()
       WHERE applicant_id = $4`,
      [reviewStatus, reviewAnswer ?? null, reviewRejectType ?? null, applicantId]
    );
    return (result.rowCount ?? 0) > 0;
  } catch (error: any) {
    logger.error('updateUserKycByApplicantId failed', { applicantId, error: error.message });
    throw error;
  }
}

/**
 * Record that the SumSub handshake was attempted (even if no applicant was found).
 * Prevents repeated lookups on every login.
 */
export async function markSumsubChecked(userId: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE users SET sumsub_checked_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [userId]
    );
  } catch (error: any) {
    logger.error('markSumsubChecked failed', { userId, error: error.message });
    throw error;
  }
}
