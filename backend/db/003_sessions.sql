-- =============================================================
-- 003_sessions.sql — Таблица сессий онбординга мастеров
-- Выполнять: Supabase SQL Editor → вставить → Run
-- =============================================================

-- Метафора: это "черновик" разговора с ботом.
-- Каждый раз когда мастер пишет боту — мы смотрим в этот черновик:
-- на каком шаге он остановился, что уже ввёл.
-- После завершения регистрации — черновик удаляется.

CREATE TABLE IF NOT EXISTS platform_sessions (
  chat_id     BIGINT PRIMARY KEY,         -- Telegram chat ID мастера
  step        VARCHAR(32) NOT NULL,       -- текущий шаг: 'brand_name', 'slug', 'timezone', 'bot_token'
  data        JSONB NOT NULL DEFAULT '{}',-- накопленные данные: { brand_name, slug, timezone }
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Сессии живут максимум 24 часа — старые чистим
-- (в реальности чистить можно через pg_cron или просто при старте /start)
CREATE INDEX IF NOT EXISTS idx_platform_sessions_updated
  ON platform_sessions(updated_at);

-- RLS: только service_role (наш сервер) может работать с сессиями
ALTER TABLE platform_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Запрет анонимного доступа к platform_sessions"
  ON platform_sessions FOR ALL TO anon USING (false);

COMMENT ON TABLE platform_sessions IS 'Временные сессии онбординга мастеров. Удаляются после регистрации.';
