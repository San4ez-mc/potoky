-- Migration 008: ensure broadcasts.scheduledAt / sentAt exist
-- schema.prisma already declares these columns, but production `broadcasts`
-- table was created before they were added (MCP list_broadcasts fails with
-- "column broadcasts.scheduledAt does not exist"). IF NOT EXISTS makes this
-- safe to run whether or not the columns are already there.

ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3);
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3);
