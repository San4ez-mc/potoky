-- Migration 009: fix broadcasts column naming — snake_case -> camelCase
--
-- The `broadcasts` table was originally created by hand with snake_case
-- column names (scheduled_at, sent_at, created_at, updated_at), unlike every
-- other table in this schema. schema.prisma declares plain camelCase field
-- names with no @map(), so Prisma expects literal "scheduledAt" etc. columns
-- — meaning list_broadcasts/create/approve were reading/writing columns that
-- didn't exist at all, while the real data (0 rows in production as of this
-- migration) sat in the snake_case columns nothing ever queried.
--
-- Migration 008 (ADD COLUMN IF NOT EXISTS "scheduledAt"/"sentAt") only
-- papered over half the problem and left two now-empty duplicate columns
-- alongside the real snake_case ones. This migration finishes the job:
-- drops those two empty duplicates, then renames all four snake_case
-- columns to their correct camelCase names. Safe to run only while the
-- table has 0 rows (verified before writing this) — on a table with real
-- data, drop the "IF EXISTS" guards below and reconcile any data already in
-- the duplicate columns first.

ALTER TABLE broadcasts DROP COLUMN IF EXISTS "scheduledAt";
ALTER TABLE broadcasts DROP COLUMN IF EXISTS "sentAt";

ALTER TABLE broadcasts RENAME COLUMN scheduled_at TO "scheduledAt";
ALTER TABLE broadcasts RENAME COLUMN sent_at TO "sentAt";
ALTER TABLE broadcasts RENAME COLUMN created_at TO "createdAt";
ALTER TABLE broadcasts RENAME COLUMN updated_at TO "updatedAt";
