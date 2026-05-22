-- Migration 006: Add isTest flag to sessions table
-- Allows marking sessions created via test interface to filter them separately

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS "isTest" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "sessions_isTest_idx" ON sessions("isTest");
