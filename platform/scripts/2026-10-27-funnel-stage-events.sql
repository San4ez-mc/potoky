-- Етапи воронки всередині Flows (2026-10-27, власник: «запис в аналітику — окремий тип ноди, лише назва і порядковий номер;
-- ноди самі складаються в етапи воронки і показують, у яких сесіях їх пройшли»; CRM до всіх воронок не чіпляємо).
-- Нода «Етап (Flows)» (type flowStage) пише сюди один рядок на пару «розмова + етап»; повторний прохід лише оновлює last_at і count.
-- Таблиця також створюється сама при першому записі (services/stageEvents.js) — цей файл для історії/ручного застосування:
--   cd apps/api && node ../../scripts/apply-sql.js ../../scripts/2026-10-27-funnel-stage-events.sql

CREATE TABLE IF NOT EXISTS funnel_stage_events (
  session_id  text        NOT NULL,
  stage_name  text        NOT NULL,
  bot_id      text        NOT NULL,
  user_id     text,
  stage_order integer     NOT NULL DEFAULT 0,
  is_test     boolean     NOT NULL DEFAULT false,
  first_at    timestamptz NOT NULL DEFAULT now(),
  last_at     timestamptz NOT NULL DEFAULT now(),
  count       integer     NOT NULL DEFAULT 1,
  PRIMARY KEY (session_id, stage_name)
);
CREATE INDEX IF NOT EXISTS funnel_stage_events_bot_idx ON funnel_stage_events (bot_id, stage_name);
CREATE INDEX IF NOT EXISTS funnel_stage_events_first_idx ON funnel_stage_events (bot_id, first_at);
