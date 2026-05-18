/**
 * Database Configuration and Connection
 */
import { Pool, PoolConfig } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const poolConfig: PoolConfig = {
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

if (process.env.DATABASE_URL) {
  poolConfig.connectionString = process.env.DATABASE_URL;
  if (
    process.env.DATABASE_URL.includes('railway') ||
    process.env.DATABASE_URL.includes('rlwy.net')
  ) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }
} else {
  poolConfig.host = getRequiredEnv('DB_HOST');
  poolConfig.port = parseInt(process.env.DB_PORT || '5432', 10);
  poolConfig.database = getRequiredEnv('DB_NAME');
  poolConfig.user = getRequiredEnv('DB_USER');
  poolConfig.password = getRequiredEnv('DB_PASSWORD');
}

export const pool = new Pool(poolConfig);

// Test connection
pool.on('connect', () => {
  console.log('✅ Database connected');
});

pool.on('error', (err) => {
  console.error('❌ Database connection error:', err);
});

export default pool;

