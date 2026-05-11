-- Add mcpToken column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS mcp_token VARCHAR(64) UNIQUE;
