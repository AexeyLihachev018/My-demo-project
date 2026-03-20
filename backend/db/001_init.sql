-- =============================================================
-- 001_init.sql — Начальная схема базы данных SaaS-платформы
-- Выполнять: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================

-- -------------------------------------------------------------
-- РАСШИРЕНИЯ
-- Supabase уже включает gen_random_uuid(), но явная активация
-- расширения гарантирует работу на любой PostgreSQL.
-- -------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- =============================================================
-- ТАБЛИЦА 1: masters — аккаунты мастеров
-- Метафора: это "личное дело" каждого мастера на платформе.
-- Здесь хранится всё о мастере: его бренд, бот, тариф, таймзона.
-- =============================================================
CREATE TABLE IF NOT EXISTS masters (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Кто этот мастер в Telegram
  telegram_user_id      BIGINT UNIQUE NOT NULL,
  telegram_username     VARCHAR(64),

  -- Его бренд (что видят клиенты)
  slug                  VARCHAR(64) UNIQUE NOT NULL,   -- URL: /m/slug
  brand_name            VARCHAR(128) NOT NULL,
  description           TEXT,
  avatar_file_id        VARCHAR(256),                  -- file_id фото из Telegram

  -- Его бот (зашифрован — клиенты не должны знать токен)
  bot_token             TEXT,                          -- AES-256-GCM зашифрован
  bot_username          VARCHAR(64),
  webhook_set           BOOLEAN DEFAULT FALSE,

  -- Визуальная тема Mini App
  theme_id              VARCHAR(32) DEFAULT 'default',

  -- Часовой пояс мастера — критично для правильного расписания
  timezone              VARCHAR(64) NOT NULL DEFAULT 'Europe/Moscow',

  -- Тарифный план
  plan                  VARCHAR(16) DEFAULT 'free'
                        CHECK (plan IN ('free', 'trial', 'pro')),
  trial_ends_at         TIMESTAMPTZ,
  subscription_ends_at  TIMESTAMPTZ,

  -- Служебное
  is_active             BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Быстрый поиск мастера по Telegram ID и slug (частые операции)
CREATE INDEX IF NOT EXISTS idx_masters_telegram_user_id ON masters(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_masters_slug ON masters(slug);

COMMENT ON TABLE masters IS 'Аккаунты мастеров — основная сущность платформы';
COMMENT ON COLUMN masters.bot_token IS 'Зашифрован AES-256-GCM. Расшифровывать только в API, не возвращать клиенту';
COMMENT ON COLUMN masters.timezone IS 'IANA timezone, напр. Europe/Moscow. Нужна для генерации слотов в luxon';


-- =============================================================
-- ТАБЛИЦА 2: services — услуги мастера
-- Метафора: это "меню" мастера — что он предлагает клиентам.
-- =============================================================
CREATE TABLE IF NOT EXISTS services (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id         UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,

  title             VARCHAR(128) NOT NULL,
  description       TEXT,
  duration_minutes  INT NOT NULL DEFAULT 60
                    CHECK (duration_minutes > 0 AND duration_minutes <= 480),
  price             INT NOT NULL CHECK (price >= 0),   -- в рублях (копейки не нужны)

  -- Фото услуги: сохраняем ГОТОВЫЙ URL при загрузке (не при отображении).
  -- Так мы не делаем двойной запрос к Telegram API при каждом показе.
  photo_url         TEXT,                              -- https://api.telegram.org/file/...
  photo_file_id     VARCHAR(256),                     -- исходный file_id для возможной конвертации

  is_active         BOOLEAN DEFAULT TRUE,
  sort_order        INT DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Часто выбираем услуги конкретного мастера (фильтр по master_id)
CREATE INDEX IF NOT EXISTS idx_services_master_id ON services(master_id);

COMMENT ON TABLE services IS 'Услуги мастера — то что видит и выбирает клиент';
COMMENT ON COLUMN services.photo_url IS 'URL разрешается один раз при загрузке. Не хранить только file_id — это требует 2 запроса к Telegram при каждом отображении';
COMMENT ON COLUMN services.price IS 'Цена в рублях целым числом. Дробные значения не поддерживаются';


-- =============================================================
-- ТАБЛИЦА 3: schedule_templates — недельное расписание
-- Метафора: это "типовая неделя" мастера.
--   Например: ПН-ПТ с 9:00 до 18:00, обед 13:00-14:00.
--   Времена хранятся в LOCAL TIME мастера (не UTC!).
--   Конвертацию в UTC делает API при помощи luxon + masters.timezone.
-- =============================================================
CREATE TABLE IF NOT EXISTS schedule_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id         UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,

  day_of_week       INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  -- 0=Понедельник, 1=Вторник, ..., 6=Воскресенье

  -- Локальное время мастера (не UTC!)
  start_time        TIME NOT NULL,    -- когда начинает работать, напр. "09:00"
  end_time          TIME NOT NULL,    -- когда заканчивает, напр. "18:00"
  slot_minutes      INT DEFAULT 60    -- шаг между слотами (30, 60, 90 мин)
                    CHECK (slot_minutes IN (15, 30, 45, 60, 90, 120)),

  break_start       TIME,             -- начало перерыва, nullable
  break_end         TIME,             -- конец перерыва, nullable

  -- Один день — одна запись на мастера
  UNIQUE(master_id, day_of_week),

  -- Проверка: конец рабочего дня позже начала
  CHECK (end_time > start_time),
  -- Проверка: если перерыв задан — оба поля должны быть заполнены
  CHECK (
    (break_start IS NULL AND break_end IS NULL) OR
    (break_start IS NOT NULL AND break_end IS NOT NULL AND break_end > break_start)
  )
);

COMMENT ON TABLE schedule_templates IS 'Типовое недельное расписание. Времена в локальном часовом поясе мастера (masters.timezone)';


-- =============================================================
-- ТАБЛИЦА 4: schedule_exceptions — исключения из расписания
-- Метафора: это "листок на двери" — "сегодня не работаю" или
--   "сегодня работаю по другому расписанию".
--   Перекрывает schedule_templates для конкретной даты.
-- =============================================================
CREATE TABLE IF NOT EXISTS schedule_exceptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id   UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,

  date        DATE NOT NULL,           -- конкретная дата (локальная дата мастера)
  is_day_off  BOOLEAN DEFAULT TRUE,    -- TRUE = выходной, FALSE = особое расписание

  -- Если is_day_off = FALSE — своё время на этот день
  start_time  TIME,
  end_time    TIME,

  note        VARCHAR(128),            -- "Отпуск", "Праздник", "Работаю до 15:00"

  UNIQUE(master_id, date)
);

CREATE INDEX IF NOT EXISTS idx_schedule_exceptions_master_date
  ON schedule_exceptions(master_id, date);

COMMENT ON TABLE schedule_exceptions IS 'Исключения из недельного расписания: выходные и особые дни';


-- =============================================================
-- ТАБЛИЦА 5: bookings — записи клиентов
-- Метафора: это "журнал записи" — как бумажная тетрадь у
--   администратора, только в базе данных.
--   starts_at/ends_at хранятся в UTC — стандарт для всех серверов.
-- =============================================================
CREATE TABLE IF NOT EXISTS bookings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id           UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  service_id          UUID NOT NULL REFERENCES services(id),

  -- Данные клиента (берём из Telegram initData)
  client_telegram_id  BIGINT NOT NULL,
  client_name         VARCHAR(128),
  client_username     VARCHAR(64),     -- @username, может быть NULL

  -- Время в UTC (отображаем с конвертацией через masters.timezone)
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NOT NULL,

  -- Статус жизненного цикла записи
  status              VARCHAR(16) DEFAULT 'pending'
                      CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  cancel_reason       TEXT,
  comment             TEXT,            -- комментарий клиента при записи

  -- ID задачи в Upstash QStash для напоминания.
  -- Сохраняем чтобы отменить задачу если запись отменили.
  qstash_message_id   VARCHAR(128),

  created_at          TIMESTAMPTZ DEFAULT NOW(),

  CHECK (ends_at > starts_at)
);

-- Индексы для частых запросов
CREATE INDEX IF NOT EXISTS idx_bookings_master_date
  ON bookings(master_id, starts_at);

CREATE INDEX IF NOT EXISTS idx_bookings_client
  ON bookings(client_telegram_id);

-- КРИТИЧЕСКИ ВАЖНЫЙ ИНДЕКС (Fix #1 из BACKEND-PLAN.md):
-- Запрещает двойное бронирование одного и того же времени у одного мастера.
-- "Частичный" — исключает отменённые записи (они не занимают слот).
--
-- Как работает:
--   Если клиент А записался на 10:00, то клиент Б не сможет записаться
--   на то же 10:00 к тому же мастеру — PostgreSQL вернёт ошибку 23505.
--   В API мы ловим эту ошибку и возвращаем 409 Conflict.
--
-- Почему не SELECT FOR UPDATE:
--   В serverless (Vercel) каждый запрос — новое соединение с БД.
--   Транзакции с блокировками требуют персистентного соединения.
--   Уникальный индекс — атомарная операция, работает без транзакций.
CREATE UNIQUE INDEX IF NOT EXISTS idx_no_double_booking
  ON bookings(master_id, starts_at)
  WHERE status != 'cancelled';

COMMENT ON TABLE bookings IS 'Записи клиентов. starts_at/ends_at в UTC. Для отображения конвертировать через masters.timezone';
COMMENT ON INDEX idx_no_double_booking IS 'Защита от race condition при одновременной записи. Ловить ошибку PostgreSQL code=23505 в API';


-- =============================================================
-- ТАБЛИЦА 6: subscriptions — история платежей
-- Метафора: это "бухгалтерская книга" — каждый платёж записан,
--   ничего не теряется, можно проверить историю.
-- =============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id       UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,

  provider        VARCHAR(16) NOT NULL
                  CHECK (provider IN ('yookassa', 'stars')),
  payment_id      VARCHAR(128) UNIQUE,   -- ID платежа у провайдера (для идемпотентности)
  amount          INT NOT NULL,          -- в рублях

  status          VARCHAR(16) DEFAULT 'pending'
                  CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),

  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,         -- обычно period_start + 30 дней

  created_at      TIMESTAMPTZ DEFAULT NOW(),

  CHECK (period_end > period_start)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_master_id ON subscriptions(master_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_id ON subscriptions(payment_id);

COMMENT ON TABLE subscriptions IS 'История платежей. payment_id уникален — защита от дублей при повторном вызове webhook';


-- =============================================================
-- ТРИГГЕР: автообновление masters.updated_at
-- Метафора: как штамп "изменено" на документе — ставится
--   автоматически при каждом изменении строки.
-- =============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS masters_updated_at ON masters;
CREATE TRIGGER masters_updated_at
  BEFORE UPDATE ON masters
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();


-- =============================================================
-- ROW LEVEL SECURITY (RLS)
-- Метафора: это "охранник у двери" — Supabase не пропустит
--   запрос, даже если кто-то угадал ID другого мастера.
--   Работает на уровне БД, независимо от кода API.
--
-- ВАЖНО: Мы используем Supabase только из server-side API (Vercel).
--   Прямых запросов из браузера к БД нет.
--   Поэтому все таблицы закрываем для anon и service_role имеет полный доступ.
-- =============================================================

-- Включаем RLS на всех таблицах
ALTER TABLE masters              ENABLE ROW LEVEL SECURITY;
ALTER TABLE services             ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_exceptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions        ENABLE ROW LEVEL SECURITY;

-- Запрещаем anon (анонимный ключ) доступ ко всем таблицам
-- Наш API использует service_role key — он обходит RLS
-- Это стандартная настройка для server-side приложений

CREATE POLICY "Запрет анонимного доступа к masters"
  ON masters FOR ALL TO anon USING (false);

CREATE POLICY "Запрет анонимного доступа к services"
  ON services FOR ALL TO anon USING (false);

CREATE POLICY "Запрет анонимного доступа к schedule_templates"
  ON schedule_templates FOR ALL TO anon USING (false);

CREATE POLICY "Запрет анонимного доступа к schedule_exceptions"
  ON schedule_exceptions FOR ALL TO anon USING (false);

CREATE POLICY "Запрет анонимного доступа к bookings"
  ON bookings FOR ALL TO anon USING (false);

CREATE POLICY "Запрет анонимного доступа к subscriptions"
  ON subscriptions FOR ALL TO anon USING (false);


-- =============================================================
-- ПРОВЕРКА: посмотреть что создалось
-- =============================================================
SELECT
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name = t.table_name
   AND table_schema = 'public') AS columns_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
