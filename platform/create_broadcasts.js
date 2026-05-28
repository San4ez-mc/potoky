'use strict';
const { PrismaClient } = require('./node_modules/@prisma/client');
const db = new PrismaClient();

const sql = "CREATE TABLE IF NOT EXISTS broadcasts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(255), status VARCHAR(20) NOT NULL DEFAULT 'draft', scheduled_at TIMESTAMPTZ, sent_at TIMESTAMPTZ, stats JSONB NOT NULL DEFAULT '{}', message JSONB NOT NULL DEFAULT '{}', recipients JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())";

db.$executeRawUnsafe(sql)
    .then(() => { console.log('OK: broadcasts table created'); return db.$disconnect(); })
    .catch(e => { console.error('Error:', e.message); process.exit(1); });
