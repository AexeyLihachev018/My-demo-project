-- =============================================================
-- 002_migration.sql — Добавляем недостающие поля и индексы
-- Выполнять: Supabase SQL Editor → вставить → Run
-- =============================================================

-- Fix #5: Таймзона мастера
-- Без неё невозможно правильно генерировать слоты (9:00 в Москве ≠ 9:00 в Новосибирске)
ALTER TABLE masters
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Moscow';

-- Fix #4: Готовый URL фото услуги
-- Сохраняем URL один раз при загрузке — не делаем двойной запрос к Telegram при каждом показе
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Fix #2: ID задачи напоминания в Upstash QStash
-- Нужен чтобы отменить напоминание если клиент отменил запись
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS qstash_message_id VARCHAR(128);

-- Fix #1: Защита от двойного бронирования
-- Уникальный частичный индекс — нельзя дважды занять одно время у одного мастера
-- (отменённые записи не считаются — они освобождают слот)
CREATE UNIQUE INDEX IF NOT EXISTS idx_no_double_booking
  ON bookings(master_id, starts_at)
  WHERE status != 'cancelled';

-- Проверка — все 4 значения должны быть 1
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name='masters' AND column_name='timezone') AS has_timezone,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name='services' AND column_name='photo_url') AS has_photo_url,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name='bookings' AND column_name='qstash_message_id') AS has_qstash,
  (SELECT COUNT(*) FROM pg_indexes
   WHERE indexname='idx_no_double_booking') AS has_double_booking_index;
