-- Службові позначки в розмові «бота на паузі / знову відповідає» (2026-10-14, власник: «щоб у сесіях було видно, що повідомлення
-- людини зупинило бота, і коли бот знову запускається»). Паузу ставлять і знімають з 13 місць коду (менеджер, бот, адмінка, фонові
-- зняття) — тому одна позначка на рівні БД: будь-яка зміна context.funnelPaused розмови → подія role='event' з причиною.
-- Адмінка показує role='event' сірою «пігулкою» в стрічці розмови; історія для ШІ (buildHistory) події не бере.
-- Застосування: cd apps/api && node ../../scripts/apply-sql.js ../../scripts/2026-10-14-pause-events.sql

CREATE OR REPLACE FUNCTION flows_pause_event() RETURNS trigger AS $$
DECLARE
  was boolean := coalesce((OLD.context->>'funnelPaused')::boolean, false);
  now_p boolean := coalesce((NEW.context->>'funnelPaused')::boolean, false);
  pb text := coalesce(NEW.context->>'pausedBy', '');
  rb text := coalesce(NEW.context->>'resumedBy', '');
  txt text;
BEGIN
  IF was = now_p THEN RETURN NEW; END IF;
  IF now_p THEN
    txt := CASE
      WHEN pb LIKE 'manager_message%' THEN '⏸ Бот на паузі — написав менеджер'
      WHEN pb = 'manual' THEN '⏸ Бот на паузі — вручну в адмінці'
      WHEN pb = 'handoff' THEN '⏸ Бот передав розмову менеджеру'
      WHEN pb = 'loop' THEN '⏸ Бот передав менеджеру — не зміг рухатись далі'
      WHEN pb = 'annoyed' THEN '⏸ Бот передав менеджеру — клієнт роздратований'
      WHEN pb = 'complaint' THEN '⏸ Бот передав менеджеру — скарга'
      WHEN pb IN ('unresolved_insist', 'insist') THEN '⏸ Бот передав менеджеру — питання без відповіді'
      WHEN pb = 'size_oor' THEN '⏸ Бот передав менеджеру — розмір поза сіткою'
      WHEN pb = 'post_unknown' THEN '⏸ Бот передав менеджеру — не впізнав товар'
      WHEN pb IN ('intl_order', 'intl_unsupported') THEN '⏸ Бот передав менеджеру — доставка за кордон'
      WHEN pb = 'home_delivery' THEN '⏸ Бот передав менеджеру — доставка додому'
      WHEN pb = 'test_mode' THEN '⏹ Бот зупинено — тестовий режим'
      WHEN pb = 'user_locked' THEN '🔒 Бот заблокований вручну — лише людина'
      ELSE '⏸ Бот на паузі' || CASE WHEN pb <> '' THEN ' — ' || pb ELSE '' END
    END;
  ELSE
    txt := CASE
      WHEN rb = 'client_return_24h' THEN '▶ Бот знову відповідає — менеджер не писав понад 24 год'
      WHEN rb = 'bot_handoff_unanswered_6h' THEN '▶ Бот знову відповідає — менеджер не відповів за 6 год'
      WHEN rb IN ('auto_24h', 'manager_silence') THEN '▶ Бот знову відповідає — менеджер мовчав'
      WHEN rb = 'manual' THEN '▶ Бот увімкнено вручну'
      ELSE '▶ Бот знову відповідає'
    END;
  END IF;
  INSERT INTO messages (id, "sessionId", role, content, metadata, "createdAt")
  VALUES (gen_random_uuid()::text, NEW.id, 'event', txt,
          jsonb_build_object('source', 'system', 'eventType', CASE WHEN now_p THEN 'bot.paused' ELSE 'bot.resumed' END, 'pausedBy', NULLIF(pb, ''), 'resumedBy', NULLIF(rb, '')),
          (now() AT TIME ZONE 'utc'));
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_flows_pause_event ON sessions;
CREATE TRIGGER trg_flows_pause_event AFTER UPDATE OF context ON sessions
  FOR EACH ROW WHEN ((OLD.context->>'funnelPaused') IS DISTINCT FROM (NEW.context->>'funnelPaused'))
  EXECUTE FUNCTION flows_pause_event();
