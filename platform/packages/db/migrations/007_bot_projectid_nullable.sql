-- Migration 007: Make bot projectId nullable
-- Allows removing a bot from a project without deleting it
-- A bot with projectId=NULL is "unassigned" and won't appear in any project's bot list

ALTER TABLE bots ALTER COLUMN "projectId" DROP NOT NULL;
