-- Track when SumSub KYC handshake was last attempted for a user.
-- NULL means the handshake has never been run; populated after first login.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sumsub_checked_at TIMESTAMP WITH TIME ZONE NULL;
