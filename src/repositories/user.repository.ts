/**
 * User Repository
 * Get or create anonymous user for orders without auth
 */
import { pool } from '../config/database';
import { logger } from '../config/logger';

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
