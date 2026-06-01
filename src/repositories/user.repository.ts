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


/**
 * Usuario para crear órdenes: JWT si existe en BD, si no anónimo.
 * Evita 500 por FK cuando el token es de otro entorno (p. ej. producción vs local).
 */
export async function userExistsById(userId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT 1 FROM users WHERE id = $1 LIMIT 1',
    [userId]
  );
  return result.rows.length > 0;
}

export async function resolveOrderUserId(
  tokenUserId?: string,
  tokenEmail?: string
): Promise<string> {
  if (tokenUserId && (await userExistsById(tokenUserId))) {
    return tokenUserId;
  }

  if (tokenUserId) {
    logger.warn('resolveOrderUserId: userId del token no está en BD local', {
      userId: tokenUserId,
      email: tokenEmail,
    });
  }

  return getOrCreateAnonymousUserId();
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
        applicant_id
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
