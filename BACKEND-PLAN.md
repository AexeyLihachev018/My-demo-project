# BACKEND-PLAN.md — SaaS-платформа для мастеров (v2.0)

> Статус: архитектурный план для самостоятельной разработки. Следовать этому файлу при разработке.
> Автор-архитектор: Claude Sonnet 4.6 | Дата: 2026-03-18 | v2.0 с 5 критическими исправлениями

---

## ВЫБРАННЫЕ РЕШЕНИЯ И ПОЧЕМУ

| Вопрос | Выбрано | Почему |
|--------|---------|--------|
| **Бот** | Каждый мастер — свой бот (@BotFather) | Единственный способ White-Label: клиент видит только бренд мастера, не платформу |
| **Регистрация мастера** | Telegram-бот платформы → мастер вводит токен | Нет email/пароля, нет web-формы, всё в Telegram |
| **Запись** | Тайм-слоты (мастер задаёт расписание, клиент выбирает время) | Простая и понятная модель |
| **Оплата** | ЮKassa (основная) + Telegram Stars (опция) | ЮKassa — рекуррентные платежи, ИП/ООО; Stars — чистая Telegram-интеграция |
| **Мультитенант** | Один деплой, мастер по URL `/m/username` | Один Vercel, одна БД, одно приложение |
| **Темы** | 8 готовых пресетов | Защищает от плохих дизайнов, легко реализовать |
| **Фото** | Telegram `file_id` → сохраняем `photo_url` в БД (Fix #4) | Без S3, быстрое отображение без двойных запросов |

---

## АРХИТЕКТУРА СИСТЕМЫ

```
┌─────────────────────────────────────────────────────────┐
│                     КЛИЕНТ МАСТЕРА                       │
│   Открывает @МастерБот → нажимает "Записаться"           │
│   → Mini App /m/username загружается в Telegram          │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼────────────────────────────────┐
│                   VERCEL (один деплой)                   │
│                                                          │
│  /app/m/[username]/        ← Mini App клиента            │
│  /app/admin/               ← Admin Mini App мастера      │
│                                                          │
│  /api/webhook              ← все боты мастеров           │
│  /api/master/[username]    ← публичные данные мастера    │
│  /api/master/[username]/slots  ← слоты для записи        │
│  /api/master/[username]/book   ← создать запись          │
│  /api/admin/*              ← управление мастером         │
│  /api/payment/*            ← подписка                    │
│  /api/photo/:file_id       ← 302-редирект на фото (Fix #4)│
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│              SUPABASE (PostgreSQL)                       │
│  Supabase Pro $25/мес с первого дня (Fix #2)             │
│  Уникальный индекс — защита от двойной брони (Fix #1)    │
└────────────────────────┬────────────────────────────────┘
                         │ напоминания за 24 ч
┌────────────────────────▼────────────────────────────────┐
│              UPSTASH QSTASH (отложенные задачи)          │
│  Бесплатный тир: 500 запросов/день                       │
│  При записи → ставим задачу на отправку через 23.5 ч     │
│  Vercel cron НЕ используем — он на платном плане (Fix #2)│
└─────────────────────────────────────────────────────────┘
```

**Стек:**
- **Хостинг:** Vercel (уже используется)
- **БД:** Supabase Pro — PostgreSQL, $25/мес, нет ограничений на req/день
- **Отложенные задачи:** Upstash QStash (напоминания за 24 ч)
- **Auth:** Telegram `initData` HMAC — без паролей, две стратегии (Fix #3)
- **Фото:** Telegram `file_id` → `photo_url` в БД → `/api/photo/:file_id` возвращает 302 (Fix #4)
- **Оплата:** ЮKassa SDK + Telegram Payments API (Stars)
- **Время:** библиотека `luxon` для работы с таймзонами (Fix #5)
- **Язык:** Node.js ES modules (как текущий `webhook.js`)

---

## РЕАЛЬНАЯ СТОИМОСТЬ ИНФРАСТРУКТУРЫ (Fix #2)

| Этап | Мастеров | Месяц | Что платим |
|------|----------|-------|------------|
| Разработка | 0 | $25 | Supabase Pro |
| MVP (запуск) | 1–20 | $25 | Supabase Pro |
| Рост | 20–200 | $25 + Vercel Pro $20 | При >100k req/мес |
| Масштаб | 200+ | $50–100 | Supabase Pro + Vercel Pro |

**Вывод:** минимальный бюджет $25/мес с первого дня.
При 490 ₽/мастер: окупается уже на ~5 платящих мастерах (~2200 ₽ / $25).

**Почему Supabase Pro с первого дня:**
- Free tier ограничен 50 000 req/день — при нескольких активных мастерах кончится
- Free tier автоматически паузит БД через 7 дней неактивности (убьёт прод)
- Pro: без лимитов запросов, нет автопаузы, бэкапы каждые 24 ч

---

## БАЗА ДАННЫХ — СХЕМА ТАБЛИЦ

### Таблица `masters` — аккаунты мастеров

```sql
CREATE TABLE masters (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Telegram-идентификация
  telegram_user_id      BIGINT UNIQUE NOT NULL,   -- ID мастера в Telegram
  telegram_username     VARCHAR(64),               -- @username мастера

  -- Бренд
  slug                  VARCHAR(64) UNIQUE NOT NULL, -- URL: /m/slug
  brand_name            VARCHAR(128) NOT NULL,      -- "Студия Мария"
  description           TEXT,                        -- описание мастера
  avatar_file_id        VARCHAR(256),               -- file_id фото из Telegram

  -- Бот мастера
  bot_token             TEXT,                       -- токен зашифрован AES-256-GCM (Fix #3)
  bot_username          VARCHAR(64),               -- @bot_username
  webhook_set           BOOLEAN DEFAULT FALSE,

  -- Тема
  theme_id              VARCHAR(32) DEFAULT 'default',

  -- Таймзона мастера (Fix #5)
  -- Обязательное поле: без неё невозможно правильно генерировать слоты
  timezone              VARCHAR(64) NOT NULL DEFAULT 'Europe/Moscow',
  -- Примеры: 'Europe/Moscow', 'Asia/Yekaterinburg', 'Asia/Novosibirsk'

  -- Подписка
  plan                  VARCHAR(16) DEFAULT 'free' CHECK (plan IN ('free','trial','pro')),
  trial_ends_at         TIMESTAMPTZ,
  subscription_ends_at  TIMESTAMPTZ,

  -- Мета
  is_active             BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
```

---

### Таблица `services` — услуги мастера

```sql
CREATE TABLE services (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id         UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,

  title             VARCHAR(128) NOT NULL,
  description       TEXT,
  duration_minutes  INT NOT NULL DEFAULT 60,
  price             INT NOT NULL,             -- в рублях

  -- Fix #4: Сохраняем готовый URL сразу при загрузке фото.
  -- Заполняется через /api/admin/photo/upload, не при отображении.
  photo_url         TEXT,                     -- https://api.telegram.org/file/bot.../photo.jpg
  photo_file_id     VARCHAR(256),             -- исходный file_id (для переформатирования в будущем)

  is_active         BOOLEAN DEFAULT TRUE,
  sort_order        INT DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Ограничение: на free не более 5 активных услуг.
-- Проверяется в API перед INSERT (НЕ в БД — план может меняться).
```

---

### Таблица `schedule_templates` — недельное расписание

```sql
-- Примечание по таймзоне (Fix #5):
-- start_time/end_time/break_start/break_end хранятся как LOCAL TIME мастера.
-- При генерации слотов используем masters.timezone для перевода в UTC.

CREATE TABLE schedule_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id         UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,

  day_of_week       INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=ПН, 6=ВС
  start_time        TIME NOT NULL,   -- "09:00" — локальное время мастера
  end_time          TIME NOT NULL,   -- "18:00" — локальное время мастера
  slot_minutes      INT DEFAULT 60,
  break_start       TIME,            -- начало перерыва, nullable
  break_end         TIME,            -- конец перерыва, nullable

  UNIQUE(master_id, day_of_week)
);
```

---

### Таблица `schedule_exceptions` — выходные и особые дни

```sql
CREATE TABLE schedule_exceptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id   UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,

  date        DATE NOT NULL,        -- локальная дата мастера
  is_day_off  BOOLEAN DEFAULT TRUE,
  start_time  TIME,
  end_time    TIME,
  note        VARCHAR(128),         -- "Отпуск", "Праздник"

  UNIQUE(master_id, date)
);
```

---

### Таблица `bookings` — записи клиентов

```sql
CREATE TABLE bookings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id           UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  service_id          UUID NOT NULL REFERENCES services(id),

  -- Клиент
  client_telegram_id  BIGINT NOT NULL,
  client_name         VARCHAR(128),
  client_username     VARCHAR(64),

  -- Время (Fix #5: храним в UTC, отображаем с учётом masters.timezone)
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NOT NULL,

  -- Статус
  status              VARCHAR(16) DEFAULT 'pending'
                      CHECK (status IN ('pending','confirmed','cancelled','completed')),
  cancel_reason       TEXT,
  comment             TEXT,

  -- QStash (Fix #2): ID задачи напоминания для возможной отмены
  qstash_message_id   VARCHAR(128),

  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Быстрые выборки
CREATE INDEX idx_bookings_master_date ON bookings(master_id, starts_at);
CREATE INDEX idx_bookings_client ON bookings(client_telegram_id);

-- Fix #1: Защита от двойного бронирования через уникальный индекс.
-- SELECT FOR UPDATE не работает в serverless (нет персистентных соединений).
-- Решение: уникальный частичный индекс + ловим ошибку PostgreSQL 23505.
-- Индекс: нельзя дважды занять одно и то же время у одного мастера,
--         если хотя бы одна из записей не отменена.
CREATE UNIQUE INDEX idx_no_double_booking
  ON bookings(master_id, starts_at)
  WHERE status != 'cancelled';
```

---

### Таблица `subscriptions` — история платежей

```sql
CREATE TABLE subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id       UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,

  provider        VARCHAR(16) NOT NULL CHECK (provider IN ('yookassa','stars')),
  payment_id      VARCHAR(128),        -- ID платежа у провайдера
  amount          INT NOT NULL,        -- в рублях
  status          VARCHAR(16) DEFAULT 'pending'
                  CHECK (status IN ('pending','succeeded','failed','refunded')),

  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,       -- +30 дней

  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## АВТОРИЗАЦИЯ — ДВЕ СТРАТЕГИИ (Fix #3)

### Проблема, которую решаем
Нельзя использовать один и тот же bot_token для проверки initData и в admin-эндпоинтах.
- Admin Mini App открывается через ПЛАТФОРМЕННЫЙ бот → initData подписан PLATFORM_BOT_TOKEN
- Client Mini App открывается через БОТ МАСТЕРА → initData подписан bot_token мастера

### Стратегия A: Admin endpoints `/api/admin/*`

```js
// Мастер управляет своим аккаунтом через Admin Mini App,
// которая открывается из ПЛАТФОРМЕННОГО бота.
// Поэтому initData проверяем через PLATFORM_BOT_TOKEN.

function validateAdminAuth(initDataString) {
  const PLATFORM_BOT_TOKEN = process.env.PLATFORM_BOT_TOKEN;
  // Стандартная HMAC-SHA256 проверка Telegram initData
  const secretKey = crypto.createHmac('sha256', 'WebAppData')
    .update(PLATFORM_BOT_TOKEN)
    .digest();
  // ... проверяем hash из initData
  // Возвращаем user.id из initData
  return telegramUserId;
}

// В каждом admin-эндпоинте:
// 1. validateAdminAuth(req.headers['x-telegram-init-data'])
// 2. Ищем masters WHERE telegram_user_id = telegramUserId
// 3. Если не найден → 404
// 4. Все операции только с master.id этого мастера
```

### Стратегия B: Client endpoints `/api/master/:slug/*`

```js
// Клиент открывает Mini App через БОТ МАСТЕРА.
// Поэтому initData проверяем через bot_token ЭТОГО КОНКРЕТНОГО мастера.

async function validateClientAuth(initDataString, slug) {
  // 1. Найти мастера по slug
  const master = await db.query('SELECT bot_token FROM masters WHERE slug = $1', [slug]);
  if (!master) throw new Error('Master not found');

  // 2. Расшифровать bot_token
  const botToken = decryptToken(master.bot_token, process.env.ENCRYPTION_KEY);

  // 3. Проверить HMAC с токеном этого мастера
  const secretKey = crypto.createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  // ... проверяем hash
  return telegramUserId;
}
```

### Важно: порядок поиска мастера в `/api/webhook`

```js
// Telegram отправляет webhook на /api/webhook?master_id=uuid
// master_id передаём при регистрации webhook:
// url: `https://platform.vercel.app/api/webhook?master_id=${master.id}`
//
// Это безопаснее slug: UUID сложнее угадать/перебрать
export default async function handler(req, res) {
  const masterId = req.query.master_id;
  const master = await db.query('SELECT * FROM masters WHERE id = $1', [masterId]);
  // ...
}
```

---

## API ENDPOINTS

### Публичные (авторизация: Telegram initData клиента через Стратегию B)

```
GET  /api/master/:slug
     → { brand_name, description, avatar_url, theme_id, services[] }
     avatar_url: вызов /api/photo/:file_id для аватара мастера

GET  /api/master/:slug/slots?date=2026-03-25&service_id=uuid
     → { date, slots: ["09:00","10:00","11:00",...] }
     Логика: schedule_template → генерируем с luxon → вычитаем bookings

POST /api/master/:slug/book
     Body: { service_id, starts_at (UTC ISO), client_name, initData }
     → { booking_id, starts_at, service_title }
     После: уведомить мастера + поставить QStash-напоминание

GET  /api/client/bookings
     Header: X-Telegram-Init-Data
     Нужен slug мастера для валидации — передавать как query ?slug=...
     → список всех записей клиента
```

---

### Admin API (авторизация: Стратегия A — PLATFORM_BOT_TOKEN)

```
GET  /api/admin/me
     → профиль мастера + план + кол-во услуг

PUT  /api/admin/profile
     Body: { brand_name, description, slug, theme_id, timezone }
     → обновлённый профиль

PUT  /api/admin/bot
     Body: { bot_token }
     Действия: 1. getMe — валидировать токен
               2. Зашифровать AES-256-GCM → сохранить
               3. setWebhook → /api/webhook?master_id=uuid
               4. Сохранить bot_username, webhook_set=true
     → { ok, bot_username }

--- ФОТО (Fix #4) ---

POST /api/admin/photo/upload
     Body: { file_id }     ← мастер прислал фото боту, мы получили file_id
     Действия: 1. getFile → получить file_path
               2. Скачать файл → загрузить в Supabase Storage (или сохранить URL)
               3. Вернуть постоянный photo_url
     → { photo_url }
     Этот endpoint вызывается ОДИН РАЗ при загрузке. Дальше используем photo_url.

--- УСЛУГИ ---

GET  /api/admin/services
     → список всех услуг (активных и нет)

POST /api/admin/services
     Body: { title, description, duration_minutes, price, photo_url?, photo_file_id? }
     Проверка: если plan=free и count(active) >= 5 → 402
     → созданная услуга

PUT  /api/admin/services/:id
     Body: частичное обновление
     → обновлённая услуга

DELETE /api/admin/services/:id
     → is_active = false (мягкое удаление)

--- РАСПИСАНИЕ ---

GET  /api/admin/schedule
     → { templates: [...], exceptions: [...на 30 дней вперёд...] }

PUT  /api/admin/schedule/template
     Body: { templates: [{day_of_week, start_time, end_time, slot_minutes, break_start?, break_end?}] }
     → UPSERT по master_id + day_of_week

POST /api/admin/schedule/exception
     Body: { date, is_day_off, start_time?, end_time?, note? }
     → INSERT

DELETE /api/admin/schedule/exception/:id
     → DELETE

--- ЗАПИСИ ---

GET  /api/admin/bookings?status=pending&from=2026-03-01&to=2026-03-31
     → список записей, starts_at конвертирован в таймзону мастера

PUT  /api/admin/bookings/:id/status
     Body: { status: "confirmed" | "cancelled", cancel_reason? }
     После: sendMessage клиенту через бот мастера
     Если cancelled: отменить QStash-напоминание (DELETE /api/v2/messages/:id)
     → обновлённая запись
```

---

### Прокси фото (Fix #4)

```
GET  /api/photo/:file_id?master_slug=:slug
     Действия:
       1. Найти мастера по slug → расшифровать bot_token
       2. Вызвать getFile → получить file_path
       3. Вернуть HTTP 302 → https://api.telegram.org/file/bot{token}/{file_path}
     Cache-Control: public, max-age=86400

ВАЖНО: Этот прокси нужен только для аватара мастера (он хранится как file_id).
Для услуг используем photo_url (сохранён при загрузке) — прокси не нужен совсем.
```

---

### Платёжный API

```
POST /api/payment/create
     Header: X-Telegram-Init-Data (Admin, Стратегия A)
     Body: { provider: "yookassa" | "stars" }
     ЮKassa: создать платёж → вернуть confirmation_url
     Stars:  createInvoiceLink → вернуть invoice_link
     → { payment_url } или { invoice_link }

POST /api/payment/webhook/yookassa
     ЮKassa уведомляет об успешной оплате
     Проверить: IP входит в whitelist ЮKassa + проверить signature
     Действие: найти мастера по payment_id → обновить subscriptions + masters.plan
     → HTTP 200

POST /api/payment/webhook/stars
     Telegram уведомляет об оплате Stars
     → HTTP 200
```

---

### Webhook бота

```
POST /api/webhook?master_id=:uuid
     Telegram шлёт все обновления бота мастера.
     master_id в query — идентифицирует мастера (безопаснее slug).

     Сценарии:
     /start      → приветствие + кнопка "Записаться" (web_app: /m/slug)
     /admin      → кнопка "Управление" (web_app: /app/admin, только для мастера)
     /mybookings → список ближайших записей отправителя как клиента
     Фото от мастера → сохранить file_id в pending_photos,
                        ответить: "Фото получено. Используйте при создании услуги."
     web_app_data → запись создана из Mini App (backup-путь, основной — /book)
```

---

## ЛОГИКА ТАЙМ-СЛОТОВ с luxon (Fix #5)

```js
// npm install luxon
import { DateTime } from 'luxon';

/**
 * Генерирует список свободных слотов для мастера на указанную дату.
 *
 * @param {string} masterTimezone  — 'Europe/Moscow', 'Asia/Yekaterinburg' и т.д.
 * @param {string} date            — 'YYYY-MM-DD' в таймзоне мастера
 * @param {object} template        — { start_time, end_time, slot_minutes, break_start, break_end }
 * @param {number} durationMinutes — длительность записи (из services)
 * @param {object[]} existingBookings — [{ starts_at, ends_at }] в UTC из БД
 * @returns {string[]}             — ["09:00", "10:00", ...] в локальном времени мастера
 */
function getAvailableSlots(masterTimezone, date, template, durationMinutes, existingBookings) {
  // Шаг 1: Парсим start_time/end_time как локальное время мастера в нужную дату
  const dayStart = DateTime.fromISO(`${date}T${template.start_time}`, { zone: masterTimezone });
  const dayEnd   = DateTime.fromISO(`${date}T${template.end_time}`,   { zone: masterTimezone });

  // Шаг 2: Перерыв (если задан)
  const breakStart = template.break_start
    ? DateTime.fromISO(`${date}T${template.break_start}`, { zone: masterTimezone })
    : null;
  const breakEnd = template.break_end
    ? DateTime.fromISO(`${date}T${template.break_end}`, { zone: masterTimezone })
    : null;

  // Шаг 3: Генерируем все слоты с шагом slot_minutes
  const slots = [];
  let cursor = dayStart;

  while (cursor.plus({ minutes: durationMinutes }) <= dayEnd) {
    const slotEnd = cursor.plus({ minutes: durationMinutes });

    // Пропускаем слоты в перерыве
    const inBreak = breakStart && breakEnd &&
      cursor < breakEnd && slotEnd > breakStart;

    if (!inBreak) {
      slots.push({ start: cursor, end: slotEnd });
    }

    cursor = cursor.plus({ minutes: template.slot_minutes });
  }

  // Шаг 4: Фильтруем занятые слоты
  // existingBookings.starts_at/ends_at — DateTime объекты из UTC
  const freeSlots = slots.filter(slot => {
    const isOccupied = existingBookings.some(b => {
      const bStart = DateTime.fromISO(b.starts_at, { zone: 'UTC' });
      const bEnd   = DateTime.fromISO(b.ends_at,   { zone: 'UTC' });
      // Пересечение: слот начинается до конца брони И заканчивается после начала брони
      return slot.start < bEnd && slot.end > bStart;
    });
    return !isOccupied;
  });

  // Шаг 5: Возвращаем как строки локального времени мастера
  return freeSlots.map(s => s.start.toFormat('HH:mm'));
}

// При сохранении записи в БД — конвертируем в UTC:
// const startsAtUtc = DateTime.fromISO(`${date}T${selectedTime}`, { zone: masterTimezone }).toUTC().toISO();
```

---

## ЗАЩИТА ОТ ДВОЙНОГО БРОНИРОВАНИЯ (Fix #1)

**Проблема:** `SELECT FOR UPDATE` не работает в serverless (каждый запрос — новое соединение).

**Решение:** уникальный частичный индекс в PostgreSQL + обработка ошибки `23505`.

```js
// api/master/[slug]/book.js

export default async function handler(req, res) {
  const { service_id, starts_at, client_name, initData } = req.body;

  // 1. Найти мастера, проверить initData (Стратегия B)
  const master = await getMasterBySlug(req.query.slug);
  const clientUserId = await validateClientAuth(initData, master);

  // 2. Получить услугу → вычислить ends_at
  const service = await getService(service_id, master.id);
  const startsAt = new Date(starts_at);
  const endsAt   = new Date(startsAt.getTime() + service.duration_minutes * 60000);

  // 3. Попытка INSERT — индекс idx_no_double_booking защитит от дублей
  try {
    const booking = await db.query(`
      INSERT INTO bookings (master_id, service_id, client_telegram_id, client_name, starts_at, ends_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, starts_at
    `, [master.id, service_id, clientUserId, client_name, startsAt, endsAt]);

    // 4. Уведомить мастера
    await notifyMaster(master, booking.rows[0], service);

    // 5. Поставить напоминание клиенту через QStash (Fix #2)
    await scheduleReminder(booking.rows[0].id, startsAt, clientUserId, master);

    return res.status(200).json({ booking_id: booking.rows[0].id, starts_at });

  } catch (err) {
    // PostgreSQL unique violation = слот уже занят
    if (err.code === '23505') {
      return res.status(409).json({ error: 'slot_taken', message: 'Это время уже занято. Выберите другое.' });
    }
    console.error('Booking error:', err);
    return res.status(500).json({ error: 'internal' });
  }
}
```

---

## НАПОМИНАНИЯ ЧЕРЕЗ UPSTASH QSTASH (Fix #2)

**Проблема:** Vercel Cron доступен только на платном плане ($20+/мес). В serverless нельзя ждать 24 часа.

**Решение:** Upstash QStash — очередь отложенных HTTP-запросов. Бесплатно до 500 req/день.

```js
// При создании записи — ставим задачу в QStash
// npm install @upstash/qstash

import { Client } from '@upstash/qstash';

async function scheduleReminder(bookingId, startsAt, clientTelegramId, master) {
  const qstash = new Client({ token: process.env.QSTASH_TOKEN });

  // Отправить напоминание за 30 минут до начала (23.5 ч от now)
  const reminderAt = new Date(startsAt.getTime() - 30 * 60 * 1000);
  const delaySeconds = Math.max(0, Math.floor((reminderAt - Date.now()) / 1000));

  // QStash вызовет наш эндпоинт через delaySeconds секунд
  const response = await qstash.publish({
    url: `${process.env.APP_URL}/api/reminders/send`,
    delay: delaySeconds,
    body: JSON.stringify({ booking_id: bookingId, client_telegram_id: clientTelegramId }),
  });

  // Сохраняем messageId чтобы отменить при cancellation
  await db.query('UPDATE bookings SET qstash_message_id = $1 WHERE id = $2',
    [response.messageId, bookingId]);
}

// Отмена напоминания при отмене записи:
async function cancelReminder(booking) {
  if (!booking.qstash_message_id) return;
  const qstash = new Client({ token: process.env.QSTASH_TOKEN });
  await qstash.cancel({ id: booking.qstash_message_id }).catch(() => {}); // игнорируем если уже отправлено
}

// Эндпоинт который вызывает QStash:
// POST /api/reminders/send
// Body: { booking_id, client_telegram_id }
// Проверяем booking в БД, шлём sendMessage клиенту через бота мастера
```

---

## ШИФРОВАНИЕ BOT_TOKEN

```js
// utils/crypto.js
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_HEX   = process.env.ENCRYPTION_KEY; // 64-символьный hex = 32 байта

export function encryptToken(plainText) {
  const key = Buffer.from(KEY_HEX, 'hex');
  const iv  = crypto.randomBytes(12); // 96 бит для GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Формат: iv(12) + tag(16) + encrypted → base64
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptToken(cipherBase64) {
  const key  = Buffer.from(KEY_HEX, 'hex');
  const data = Buffer.from(cipherBase64, 'base64');
  const iv   = data.subarray(0, 12);
  const tag  = data.subarray(12, 28);
  const enc  = data.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc) + decipher.final('utf8');
}

// Генерация ключа (один раз, сохранить в .env):
// node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## ONBOARDING МАСТЕРА — ПОШАГОВЫЙ СЦЕНАРИЙ

```
Шаг 1: Мастер пишет @ПлатформенныйБот → /start
        Бот: "Привет! Создадим ваше приложение за 5 минут."

Шаг 2: Бот спрашивает название бренда
        Мастер: "Студия красоты Мария"

Шаг 3: Бот спрашивает желаемый slug
        Мастер: "maria-beauty"
        Бот проверяет уникальность → подтверждает

Шаг 4: Бот спрашивает таймзону (Fix #5)
        Бот: "В каком часовом поясе вы работаете?
              [Москва UTC+3] [Екатеринбург UTC+5] [Новосибирск UTC+7] [Другой]"
        Мастер: нажимает кнопку → записываем masters.timezone

Шаг 5: Бот: "Создайте бота для ваших клиентов:"
        1. Откройте @BotFather
        2. Напишите /newbot
        3. Скопируйте токен и пришлите сюда
        Мастер: [вставляет токен]

Шаг 6: Платформа:
        - Валидирует токен (getMe)
        - Шифрует AES-256-GCM → сохраняет
        - Регистрирует webhook → /api/webhook?master_id=uuid
        - Создаёт запись в masters
        - Начинает 14-дневный trial

Шаг 7: Бот: "✅ Готово! Ваше приложение:"
        [Настроить услуги] → Admin Mini App
        [Моё приложение]   → /m/maria-beauty
```

---

## ТЕМЫ ПРИЛОЖЕНИЯ (8 пресетов)

```js
const THEMES = {
  default:    { accent: '#2aabee', bg: '#ffffff', name: 'Telegram Blue'  },
  ocean:      { accent: '#0ea5e9', bg: '#f0f9ff', name: 'Ocean'          },
  forest:     { accent: '#16a34a', bg: '#f0fdf4', name: 'Forest'         },
  sunset:     { accent: '#f97316', bg: '#fff7ed', name: 'Sunset'         },
  rose:       { accent: '#e11d48', bg: '#fff1f2', name: 'Rose'           },
  violet:     { accent: '#7c3aed', bg: '#f5f3ff', name: 'Violet'         },
  midnight:   { accent: '#3b82f6', bg: '#0f172a', name: 'Midnight Dark'  },
  minimal:    { accent: '#374151', bg: '#f9fafb', name: 'Minimal'        },
};

// 'default' доступна всем.
// Остальные — только plan = 'pro' или 'trial'.
```

---

## УВЕДОМЛЕНИЯ — КОГДА И КОМУ ЧТО ПРИХОДИТ

| Событие | Кому | Текст |
|---------|------|-------|
| Клиент создал запись | Мастеру через его бот | "📅 Новая запись: [Услуга], [Дата локальная], [Клиент @username]" |
| Мастер подтвердил | Клиенту через бот мастера | "✅ Запись подтверждена: [Услуга], [Дата]" |
| Мастер отменил | Клиенту через бот мастера | "❌ Запись отменена. Причина: [причина]" |
| За 30 мин до записи | Клиенту (QStash) | "⏰ Напоминание: через 30 минут [Услуга] у [Мастер]" |
| Оплата прошла | Мастеру (платформенный бот) | "✅ Подписка активна до [дата]" |
| Подписка истекает через 3 дня | Мастеру | "⚠️ Подписка истекает [дата]. Продлить: [ссылка]" |

---

## ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ (`.env`)

```env
# База данных (Supabase Pro)
DATABASE_URL=postgresql://...supabase.co:5432/postgres

# Платформенный бот (онбординг мастеров + Admin auth)
PLATFORM_BOT_TOKEN=123456:AAxxxxxxxx

# Шифрование bot_token мастеров
# Генерация: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=<64-символьный hex>

# Upstash QStash (напоминания) — Fix #2
QSTASH_TOKEN=<токен из console.upstash.com>
QSTASH_CURRENT_SIGNING_KEY=<для верификации входящих запросов>
QSTASH_NEXT_SIGNING_KEY=<для ротации ключей>

# URL деплоя (для QStash callbacks)
APP_URL=https://your-platform.vercel.app

# ЮKassa
YOOKASSA_SHOP_ID=123456
YOOKASSA_SECRET_KEY=live_xxxx
YOOKASSA_RETURN_URL=https://your-platform.vercel.app/payment/success

# Цена подписки
SUBSCRIPTION_PRICE_RUB=490
SUBSCRIPTION_PRICE_STARS=50
SUBSCRIPTION_DAYS=30
```

---

## КРИТИЧНЫЕ ПРОВЕРКИ БЕЗОПАСНОСТИ

```
□ НИКОГДА не возвращать bot_token в ответах API
□ Зашифровать bot_token в БД (AES-256-GCM, ключ в env) — реализовано в utils/crypto.js
□ Валидировать Telegram initData HMAC на КАЖДЫЙ запрос
  - Admin endpoints: PLATFORM_BOT_TOKEN (Стратегия A)
  - Client endpoints: bot_token мастера (Стратегия B)
□ Проверять master_id в каждом admin-запросе: user.id == master.telegram_user_id
□ Уникальный индекс idx_no_double_booking + ловить ошибку code 23505
□ Rate limiting: /api/master/:slug/book — не более 5 запросов/мин с одного IP
□ Webhook ЮKassa: проверять IP-whitelist + signature
□ Верифицировать входящие запросы QStash через signing key
□ bot_token не логировать (маскировать: "8044...E48")
□ QSTASH_TOKEN не логировать
```

---

## ПОРЯДОК РАЗРАБОТКИ (по фазам)

### Фаза 1 — Основа (MVP)

1. **Настроить Supabase Pro** ($25/мес)
   - Создать все таблицы по схеме выше
   - Создать индекс `idx_no_double_booking`
   - Настроить DATABASE_URL в Vercel env

2. **Платформенный бот + онбординг мастера**
   - `/api/webhook` для платформенного бота (без master_id в query)
   - Диалог: brand_name → slug → timezone → bot_token
   - Валидация токена через getMe, шифрование, setWebhook

3. **Публичные данные мастера**
   - `GET /api/master/:slug` → профиль + услуги
   - `GET /api/photo/:file_id` → 302 редирект

4. **Admin Mini App — услуги**
   - `GET/POST/PUT/DELETE /api/admin/services`
   - Авторизация: Стратегия A (PLATFORM_BOT_TOKEN)
   - Проверка лимита 5 услуг на free

5. **Admin Mini App — расписание + таймзона**
   - `GET/PUT /api/admin/schedule/template`
   - UI для выбора таймзоны (если не задана при онбординге)

6. **Генерация слотов**
   - `GET /api/master/:slug/slots` с luxon
   - Учёт таймзоны мастера, перерывов, исключений

7. **Запись клиента**
   - `POST /api/master/:slug/book`
   - INSERT + обработка ошибки 23505
   - Уведомление мастеру

8. **QStash-напоминания**
   - Регистрация задачи при создании записи
   - `POST /api/reminders/send` — endpoint для QStash
   - Отмена при cancellation

**Результат фазы 1:** мастер зарегистрирован, добавил услуги, клиенты пишутся.

---

### Фаза 2 — Монетизация

9. **ЮKassa — создание платежа**
   - `POST /api/payment/create` (provider: yookassa)
   - Создать платёж, вернуть confirmation_url

10. **ЮKassa — webhook подтверждения**
    - `POST /api/payment/webhook/yookassa`
    - Проверить IP + signature
    - Обновить masters.plan, создать запись в subscriptions

11. **Telegram Stars**
    - `POST /api/payment/create` (provider: stars)
    - createInvoiceLink, обработать successful_payment

12. **Логика лимитов**
    - Блокировка при попытке добавить 6-ю услугу на free (402)
    - Блокировка смены темы на free (402)
    - Автоматический перевод trial → free по истечении

13. **Уведомление об истечении подписки**
    - При онбординге: QStash-задача на trial_ends_at - 3 дня
    - При оплате: QStash-задача на subscription_ends_at - 3 дня

**Результат фазы 2:** платформа зарабатывает.

---

### Фаза 3 — Рост

14. Статистика для мастера (кол-во записей, выручка за период)
15. Клиентская база (список уникальных клиентов)
16. Отзывы после записи
17. Промокоды

---

## ИТОГО: ЧТО СТРОИМ

**SaaS-конструктор для мастеров сферы услуг в Telegram.**

Мастер получает:
- Свой Telegram Mini App (`/m/his-slug`) с его брендом
- Своего брендированного бота для клиентов
- Систему онлайн-записи с расписанием
- Управление услугами с фото
- Уведомления в реальном времени

Клиент мастера получает:
- Запись в 3 тапа, без регистрации
- Напоминание за 30 минут
- Всё внутри Telegram

Платформа (вы) получает:
- 490 ₽/мес с каждого мастера на Pro
- Автоматический биллинг
- Расходы: $25/мес (Supabase Pro) — окупается с 5-го мастера
