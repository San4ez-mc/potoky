-- Етап 0 плану «правки → нуль» (13.10.2026): знімки ходів агента (для прогону нового коду на реальних ходах і детекторів)
-- і щоденна статистика якості. Застосування на проді: npx prisma db execute --file scripts/2026-10-13-quality-tables.sql
-- (не db push — урок 15.14).

CREATE TABLE IF NOT EXISTS agent_turns (
  "id"            TEXT PRIMARY KEY,
  "sessionId"     TEXT NOT NULL,
  "botId"         TEXT NOT NULL,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "input"         JSONB NOT NULL DEFAULT '{}',   -- текст, фото, пересланий пост, реклама, сторіз цього ходу
  "ctxBefore"     JSONB NOT NULL DEFAULT '{}',   -- памʼять розмови ДО ходу (для прогону)
  "understanding" JSONB NOT NULL DEFAULT '{}',   -- що зрозумів аналізатор
  "questions"     JSONB NOT NULL DEFAULT '[]',   -- реєстр питань на кінець ходу (open/covered/answered/escalated)
  "out"           JSONB NOT NULL DEFAULT '[]',   -- що бот відповів: [{step, text, photos}]
  "ms"            INTEGER
);
CREATE INDEX IF NOT EXISTS agent_turns_bot_created ON agent_turns ("botId", "createdAt");
CREATE INDEX IF NOT EXISTS agent_turns_session ON agent_turns ("sessionId");

CREATE TABLE IF NOT EXISTS quality_daily (
  "id"        TEXT PRIMARY KEY,
  "botId"     TEXT NOT NULL,
  "day"       DATE NOT NULL,
  "stats"     JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("botId", "day")
);
