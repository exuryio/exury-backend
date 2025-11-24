#!/usr/bin/env node
/**
 * Run database migrations using Node.js
 * This script reads SQL files and executes them in order
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Get DATABASE_URL from environment
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ ERROR: DATABASE_URL environment variable is not set');
  console.error('');
  console.error('Please ensure DATABASE_URL is set in Railway environment variables.');
  process.exit(1);
}

// Create database connection
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('railway') ? { rejectUnauthorized: false } : false,
});

const migrationsDir = path.join(__dirname, '..', 'migrations');
const migrationFiles = [
  '001_initial_schema.sql',
  '002_add_email_verification.sql',
  '003_add_apple_facebook_ids.sql',
];

async function runMigrations() {
  console.log('🚀 Running Exury Database Migrations');
  console.log('====================================\n');

  try {
    // Test connection
    await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful\n');

    // Run each migration
    for (const file of migrationFiles) {
      const filePath = path.join(migrationsDir, file);
      
      if (!fs.existsSync(filePath)) {
        console.error(`❌ Migration file not found: ${file}`);
        process.exit(1);
      }

      console.log(`📊 Running migration ${file}...`);
      
      const sql = fs.readFileSync(filePath, 'utf8');
      
      try {
        await pool.query(sql);
        console.log(`✅ Migration ${file} completed\n`);
      } catch (error) {
        // Check if error is because table already exists (migration already run)
        if (error.message.includes('already exists') || error.message.includes('duplicate')) {
          console.log(`⚠️  Migration ${file} already applied (skipping)\n`);
        } else {
          console.error(`❌ Migration ${file} failed:`);
          console.error(error.message);
          throw error;
        }
      }
    }

    console.log('🎉 All migrations completed successfully!\n');
    
    // Verify by listing tables
    console.log('📋 Verifying database tables...');
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    console.log(`✅ Found ${result.rows.length} tables:`);
    result.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    
  } catch (error) {
    console.error('\n❌ Migration failed:');
    console.error(error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migrations
runMigrations().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

