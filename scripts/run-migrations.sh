#!/bin/bash
# Script to run database migrations on Railway

echo "🚀 Running Exury Database Migrations"
echo "===================================="
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL environment variable is not set"
  echo ""
  echo "Please set DATABASE_URL or run this script with Railway CLI:"
  echo "  railway run bash scripts/run-migrations.sh"
  exit 1
fi

echo "✅ DATABASE_URL is set"
echo ""

# Run migrations in order
echo "📊 Running migration 001_initial_schema.sql..."
psql "$DATABASE_URL" -f migrations/001_initial_schema.sql
if [ $? -ne 0 ]; then
  echo "❌ Migration 001 failed"
  exit 1
fi
echo "✅ Migration 001 completed"
echo ""

echo "📊 Running migration 002_add_email_verification.sql..."
psql "$DATABASE_URL" -f migrations/002_add_email_verification.sql
if [ $? -ne 0 ]; then
  echo "❌ Migration 002 failed"
  exit 1
fi
echo "✅ Migration 002 completed"
echo ""

echo "📊 Running migration 003_add_apple_facebook_ids.sql..."
psql "$DATABASE_URL" -f migrations/003_add_apple_facebook_ids.sql
if [ $? -ne 0 ]; then
  echo "❌ Migration 003 failed"
  exit 1
fi
echo "✅ Migration 003 completed"
echo ""

echo "🎉 All migrations completed successfully!"
echo ""
echo "You can verify by checking your database tables."

