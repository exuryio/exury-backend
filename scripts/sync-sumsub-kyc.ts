/**
 * Sync SumSub KYC status for users with email_verified=false who already have an applicant_id.
 *
 * Usage:
 *   npx tsx scripts/sync-sumsub-kyc.ts
 *   npx tsx scripts/sync-sumsub-kyc.ts --dry-run   # shows what would be updated without writing
 */
import dotenv from 'dotenv';
dotenv.config();

import { pool } from '../src/config/database';
import { sumsubService } from '../src/services/sumsub/sumsub.service';
import { logger } from '../src/config/logger';

const DRY_RUN = process.argv.includes('--dry-run');

interface UserRow {
  id: string;
  email: string;
  applicant_id: string;
}

async function syncSumsubKyc() {
  console.log(`🔍 Buscando usuarios con applicant_id…`);
  if (DRY_RUN) console.log('⚠️  Modo --dry-run: no se escribirá nada en la base de datos.\n');

  const { rows: users } = await pool.query<UserRow>(
    `SELECT id, email, applicant_id
     FROM users
       WHERE applicant_id IS NOT NULL
       AND applicant_id <> ''
     ORDER BY created_at ASC`,
  );

  if (users.length === 0) {
    console.log('✅ No hay usuarios que necesiten sincronización.');
    await pool.end();
    return;
  }

  console.log(`📋 ${users.length} usuario(s) encontrado(s).\n`);

  let updated = 0;
  let errors = 0;

  for (const user of users) {
    const { id, email, applicant_id } = user;
    process.stdout.write(`  → ${email} (applicant: ${applicant_id}) … `);

    try {
      const kyc = await sumsubService.getKycStatus(applicant_id);

      const reviewStatus    = kyc.reviewStatus    ?? null;
      const reviewAnswer    = kyc.reviewAnswer    ?? null;
      const reviewRejectType = kyc.reviewRejectType ?? null;

      if (!DRY_RUN) {
        await pool.query(
          `UPDATE users
           SET applicant_id                  = $1,
               applicant_review_status       = $2,
               applicant_review_answer       = $3,
               applicant_review_reject_type  = $4,
               sumsub_checked_at             = NOW(),
               updated_at                    = NOW()
           WHERE id = $5`,
          [applicant_id, reviewStatus, reviewAnswer, reviewRejectType, id],
        );
      }

      const label = reviewAnswer ? `${reviewStatus}/${reviewAnswer}` : (reviewStatus ?? 'sin estado');
      console.log(`✅ ${label}${DRY_RUN ? ' [dry-run]' : ''}`);
      updated++;
    } catch (err: any) {
      console.log(`❌ Error: ${err.message}`);
      logger.error('sync-sumsub-kyc: failed for user', { userId: id, email, error: err.message });
      errors++;
    }
  }

  console.log(`\n🏁 Completado — ${updated} actualizado(s), ${errors} error(es).`);
  await pool.end();
}

syncSumsubKyc().catch((err) => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});
