/**
 * SumSub configuration
 *
 * Credentials:
 * - Sandbox: SUMSUB_APP_TOKEN_SANDBOX, SUMSUB_SECRET_KEY_SANDBOX
 * - Production: SUMSUB_APP_TOKEN_PROD, SUMSUB_SECRET_KEY_PROD
 *
 * Which pair is used:
 * 1. SUMSUB_ENV=production|sandbox (or prod|dev) — explicit override (e.g. staging with NODE_ENV=production but Sumsub sandbox)
 * 2. SUMSUB_USE_PRODUCTION=true|false — boolean override
 * 3. Else: NODE_ENV === 'production' → production keys; otherwise → sandbox
 */
import dotenv from 'dotenv';

dotenv.config();

export type SumsubCredentialMode = 'sandbox' | 'production';

function resolveCredentialMode(): SumsubCredentialMode {
  const sumsubEnv = process.env.SUMSUB_ENV?.trim().toLowerCase();
  if (sumsubEnv === 'production' || sumsubEnv === 'prod') {
    return 'production';
  }
  if (
    sumsubEnv === 'sandbox' ||
    sumsubEnv === 'dev' ||
    sumsubEnv === 'development'
  ) {
    return 'sandbox';
  }
  if (sumsubEnv) {
    console.warn(
      `⚠️  Invalid SUMSUB_ENV="${process.env.SUMSUB_ENV}" — expected production|sandbox. Falling back to NODE_ENV.`,
    );
  }

  const useProd = process.env.SUMSUB_USE_PRODUCTION?.trim().toLowerCase();
  if (useProd === 'true' || useProd === '1') {
    return 'production';
  }
  if (useProd === 'false' || useProd === '0') {
    return 'sandbox';
  }

  return process.env.NODE_ENV === 'production' ? 'production' : 'sandbox';
}

const credentialMode = resolveCredentialMode();
const useProductionKeys = credentialMode === 'production';

const appToken = useProductionKeys
  ? process.env.SUMSUB_APP_TOKEN_PROD
  : process.env.SUMSUB_APP_TOKEN_SANDBOX;

const secretKey = useProductionKeys
  ? process.env.SUMSUB_SECRET_KEY_PROD
  : process.env.SUMSUB_SECRET_KEY_SANDBOX;

const config = {
  baseUrl: process.env.SUMSUB_BASE_URL || 'https://api.sumsub.com',

  appToken,
  secretKey,

  /** KYC verification level name configured in the SumSub dashboard */
  levelName: process.env.SUMSUB_LEVEL_NAME || 'basic-kyc-level',

  /** Matches the Sumsub dashboard environment for the loaded keys */
  credentialMode,
  /** @deprecated use credentialMode */
  environment: credentialMode,
  isProduction: useProductionKeys,
} as const;

if (!config.appToken || !config.secretKey) {
  console.warn(
    `⚠️  SumSub credentials missing for "${credentialMode}" — set ${
      useProductionKeys
        ? 'SUMSUB_APP_TOKEN_PROD and SUMSUB_SECRET_KEY_PROD'
        : 'SUMSUB_APP_TOKEN_SANDBOX and SUMSUB_SECRET_KEY_SANDBOX'
    }`,
  );
}

export default config;
