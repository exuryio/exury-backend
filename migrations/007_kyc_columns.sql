-- Add KYC columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS applicant_review_status VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS applicant_review_answer VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS applicant_review_reject_type VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS applicant_id VARCHAR(255) NULL;
