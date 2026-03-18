# BACKEND-PLAN.md — SaaS-платформа для мастеров

> Статус: архитектурный план. Следовать этому файлу при разработке.
> Автор-архитектор: Claude Sonnet 4.6 | Дата: 2026-03-18

---

## ВЫБРАННЫЕ РЕШЕНИЯ И ПОЧЕМУ

Ваши ответы были произвольными — ниже оптимальные решения с обоснованием.

| Вопрос | Выбрано | Почему |
|--------|---------|--------|
| **Бот** | Каждый мастер — свой бот (@BotFather) | Единственный способ сделать White-Label: клиент мастера видит только его бренд, не платформу |
| **Регистрация мастера** | Telegram-бот платформы → мастер вводит токен | Нет email/пароля, нет web-формы, всё в Telegram — соответствует стеку |
| **Запись** | Тайм-слоты (мастер задаёт расписание, клиент выбирает время) | Это то что вы описали в задаче |
| **Оплата** | ЮKassa (основная) + Telegram Stars (опция) | ЮKassa поддерживает рекуррентные платежи и ИП/ООО; Stars — для чистой Telegram-интеграции |
| **Мультитенант** | Один деплой, мастер по URL `/m/username` | Самое простое — один Vercel, одна БД, одно приложение |
| **Темы** | 8 готовых пресетов | Защищает от плохих дизайнов, легко сделать |
| **Фото** | Telegram `file_id` → проксируем через API | Бесплатно, не нужен S3, мастер просто отправляет фото боту |

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
│  /api/master/[username]/slots ← слоты для записи        │
│  /api/master/[username]/book  ← создать запись           │
│  /api/admin/*              ← управление мастером         │
│  /api/payment/*            ← подписка                    │
│  /api/photo                ← прокси фото из Telegram     │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│              SUPABASE (PostgreSQL)                       │
│  Бесплатный тир: 500 МБ, 2 проекта, 50000 req/день      │
│  Позже: $25/мес при росте                                │
└─────────────────────────────────────────────────────────┘
```

**Стек:**
- **Хостинг:** Vercel (уже используется)
- **БД:** Supabase (Postgres) — бесплатный старт, SQL, REST API из коробки
- **Auth:** Telegram `initData` HMAC-валидация — никаких паролей
- **Фото:** Telegram `file_id` → прокси через `/api/photo`
- **Оплата:** ЮKassa SDK (Node.js) + Telegram Payments API (Stars)
- **Язык:** Node.js ES modules (как текущий `webhook.js`)

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
  avatar_file_id        VARCHAR(256),               -- file_id фото мастера из Telegram

  -- Бот мастера
  bot_token             TEXT,                       -- токен зашифрован (AES-256)
  bot_username          VARCHAR(64),               -- @bot_username
  webhook_set           BOOLEAN DEFAULT FALSE,      -- webhook зарегистрирован?

  -- Тема приложения
  theme_id              VARCHAR(32) DEFAULT 'default', -- см. ТЕМЫ ниже

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

**Лимиты по плану:**
| plan | Услуги | Тема | Записи |
|------|--------|------|--------|
| free | ≤ 5 | нет (только default) | неограничено |
| trial | неограничено | да | неограничено |
| pro | неограничено | да | неограничено |

---

### Таблица `services` — услуги мастера

```sql
CREATE TABLE services (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id         UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,

  title             VARCHAR(128) NOT NULL,    -- "Стрижка мужская"
  description       TEXT,
  duration_minutes  INT NOT NULL DEFAULT 60,  -- длительность приёма
  price             INT NOT NULL,             -- цена в рублях
  photo_file_id     VARCHAR(256),            -- file_id из Telegram

  is_active         BOOLEAN DEFAULT TRUE,
  sort_order        INT DEFAULT 0,

  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Ограничение: на free не более 5 активных услуг
-- Проверяется в API перед INSERT
```

---

### Таблица `schedule_templates` — недельное расписание

```sql
CREATE TABLE schedule_templates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id         UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,

  day_of_week       INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=ПН, 6=ВС
  start_time        TIME NOT NULL,   -- "09:00"
  end_time          TIME NOT NULL,   -- "18:00"
  slot_minutes      INT DEFAULT 60,  -- шаг слота в минутах
  break_start       TIME,            -- начало перерыва (обед), nullable
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

  date        DATE NOT NULL,
  is_day_off  BOOLEAN DEFAULT TRUE,   -- TRUE = выходной
  start_time  TIME,                    -- если FALSE — особое время
  end_time    TIME,

  note        VARCHAR(128),            -- "Отпуск", "Праздник"

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
  client_name         VARCHAR(128),    -- first_name из Telegram
  client_username     VARCHAR(64),     -- @username (nullable)

  -- Время
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NOT NULL,

  -- Статус
  status              VARCHAR(16) DEFAULT 'pending'
                      CHECK (status IN ('pending','confirmed','cancelled','completed')),
  cancel_reason       TEXT,

  comment             TEXT,           -- комментарий клиента
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы для быстрых выборок
CREATE INDEX idx_bookings_master_date ON bookings(master_id, starts_at);
CREATE INDEX idx_bookings_client ON bookings(client_telegram_id);
```

---

### Таблица `subscriptions` — история платежей

```sql
CREATE TABLE subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id       UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,

  provider        VARCHAR(16) NOT NULL CHECK (provider IN ('yookassa','stars')),
  payment_id      VARCHAR(128),        -- ID платежа в системе провайдера
  amount          INT NOT NULL,        -- сумма в рублях
  status          VARCHAR(16) DEFAULT 'pending'
                  CHECK (status IN ('pending','succeeded','failed','refunded')),

  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,       -- обычно +30 дней

  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## API ENDPOINTS

### Публичные (без авторизации — только Telegram initData клиента)

```
GET  /api/master/:slug
     → { brand_name, description, avatar_url, theme_id, services[] }
     Используется: Mini App загружается и показывает профиль мастера

GET  /api/master/:slug/slots?date=2026-03-25&service_id=uuid
     → { date, slots: ["09:00","10:00","11:00",...] }
     Логика: берём schedule_template для дня недели,
             вычитаем существующие bookings,
             вычитаем schedule_exceptions

POST /api/master/:slug/book
     Body: { service_id, starts_at, client_name, initData }
     → { booking_id, starts_at, service_title }
     После: отправить уведомление мастеру через его бот

GET  /api/client/bookings
     Header: X-Telegram-Init-Data: <initData>
     → список всех записей клиента у всех мастеров
```

---

### Admin API (мастер управляет своим аккаунтом)

Авторизация: `X-Telegram-Init-Data` → проверяем HMAC → берём `user.id` → ищем мастера.

```
GET  /api/admin/me
     → профиль мастера + статус подписки + количество услуг

PUT  /api/admin/profile
     Body: { brand_name, description, slug, theme_id }
     → обновлённый профиль

PUT  /api/admin/bot
     Body: { bot_token }
     Действия: валидировать токен через Telegram API (getMe),
               зарегистрировать webhook,
               сохранить bot_username
     → { ok, bot_username }

--- УСЛУГИ ---

GET  /api/admin/services
     → список всех услуг мастера (активных и неактивных)

POST /api/admin/services
     Body: { title, description, duration_minutes, price, photo_file_id }
     Проверка: если plan=free и уже 5 активных услуг → 402 ошибка
     → созданная услуга

PUT  /api/admin/services/:id
     Body: частичное обновление полей
     → обновлённая услуга

DELETE /api/admin/services/:id
     → удалить (или деактивировать is_active=false)

--- РАСПИСАНИЕ ---

GET  /api/admin/schedule
     → schedule_templates[] + schedule_exceptions[] на 30 дней вперёд

PUT  /api/admin/schedule/template
     Body: { templates: [{day_of_week, start_time, end_time, slot_minutes}] }
     → обновлённые шаблоны

POST /api/admin/schedule/exception
     Body: { date, is_day_off, start_time?, end_time?, note? }
     → созданное исключение

DELETE /api/admin/schedule/exception/:id
     → удалить исключение

--- ЗАПИСИ ---

GET  /api/admin/bookings?status=pending&from=2026-03-01&to=2026-03-31
     → список записей с фильтрами

PUT  /api/admin/bookings/:id/status
     Body: { status: "confirmed" | "cancelled", cancel_reason? }
     После: отправить уведомление клиенту через бот мастера
     → обновлённая запись
```

---

### Платёжный API

```
POST /api/payment/create
     Header: X-Telegram-Init-Data
     Body: { provider: "yookassa" | "stars" }
     ЮKassa: создаём платёж, возвращаем URL для редиректа
     Stars:  возвращаем invoice_link через Telegram Payments API
     → { payment_url } или { invoice_link }

POST /api/payment/webhook/yookassa
     Вызывает ЮKassa при успешной оплате
     Действие: найти мастера, обновить subscriptions + masters.plan
     → HTTP 200

POST /api/payment/webhook/stars
     Вызывает Telegram при успешной оплате Stars
     → HTTP 200
```

---

### Webhook бота

```
POST /api/webhook?master_id=:uuid
     Telegram отправляет сюда все обновления бота мастера.
     master_id в query-параметре — идентифицирует мастера.

     Обрабатываемые сценарии:
     /start → приветствие + кнопка "Записаться" (web_app)
     /admin  → кнопка "Управление" (web_app admin, только для мастера)
     /mybookings → список ближайших записей клиента
     Любое фото → если отправитель = мастер → сохранить file_id,
                  ответить "Фото сохранено, используйте в настройках услуг"
     web_app_data → получена запись из Mini App → сохранить в DB,
                    уведомить мастера, подтвердить клиенту
```

---

### Прокси фото

```
GET  /api/photo?file_id=:file_id&master_id=:uuid
     Действия: взять bot_token мастера из DB,
               вызвать https://api.telegram.org/bot{token}/getFile?file_id=...
               получить file_path → стримить контент клиенту
     Cache-Control: public, max-age=86400
     → бинарный контент изображения
```

---

## КТО ЧТО ВИДИТ И РЕДАКТИРУЕТ

```
┌──────────────┬────────────────────────────────────────────────┐
│ Роль         │ Доступ                                         │
├──────────────┼────────────────────────────────────────────────┤
│ Клиент       │ Видит: профиль мастера, услуги, слоты          │
│              │ Делает: создаёт запись, видит СВОИ записи       │
│              │ НЕ видит: данные других клиентов, настройки     │
├──────────────┼────────────────────────────────────────────────┤
│ Мастер       │ Видит: свой профиль, свои услуги, своё расписание│
│              │ Делает: редактирует всё своё, подтверждает/отменяет│
│              │ записи, загружает фото, платит за подписку      │
│              │ НЕ видит: данные других мастеров                │
├──────────────┼────────────────────────────────────────────────┤
│ Платформа    │ Полный доступ через Supabase Dashboard          │
│ (вы)         │ Мониторинг, поддержка, управление подписками    │
└──────────────┴────────────────────────────────────────────────┘
```

---

## АВТОРИЗАЦИЯ — КАК РАБОТАЕТ

Никаких паролей. Только Telegram.

```
1. Mini App открывается → Telegram передаёт initData в window.Telegram.WebApp.initData
2. Клиент/мастер отправляет initData в заголовке запроса:
   X-Telegram-Init-Data: query_id=...&user=...&hash=...
3. Сервер проверяет HMAC подпись:
   - Берём bot_token мастера (по master_id из URL)
   - Считаем HMAC-SHA256 от строки данных с ключом = HMAC-SHA256("WebAppData", bot_token)
   - Сравниваем с hash из initData
   - Если совпало → пользователь настоящий, берём user.id
4. Для admin-эндпоинтов: проверяем что user.id == master.telegram_user_id
```

---

## ONBOARDING МАСТЕРА — ПОШАГОВЫЙ СЦЕНАРИЙ

```
Шаг 1: Мастер пишет @ПлатформенныйБот → /start
        Бот: "Привет! Создадим ваше приложение за 5 минут."

Шаг 2: Бот спрашивает название бренда
        Мастер: "Студия красоты Мария"

Шаг 3: Бот спрашивает желаемый URL (slug)
        Мастер: "maria-beauty"
        Бот проверяет уникальность → подтверждает

Шаг 4: Бот: "Создайте бота для ваших клиентов:"
        1. Откройте @BotFather
        2. Напишите /newbot
        3. Придумайте имя и username
        4. Скопируйте токен и пришлите сюда
        Мастер: [вставляет токен]

Шаг 5: Платформа:
        - Валидирует токен (getMe)
        - Регистрирует webhook → /api/webhook?master_id=uuid
        - Сохраняет мастера в БД
        - Создаёт 14-дневный trial

Шаг 6: Бот: "✅ Готово! Ваше приложение:"
        [кнопка: Настроить услуги] → открывает Admin Mini App
        [кнопка: Моё приложение]  → открывает /m/maria-beauty
```

---

## ЛОГИКА ТАЙМ-СЛОТОВ (генерация доступного времени)

```js
// Псевдокод функции getAvailableSlots(master_id, date, service_id)

1. Найти service → получить duration_minutes

2. Найти schedule_exception для date:
   - Если is_day_off = true → вернуть []
   - Если есть кастомное время → использовать его

3. Иначе найти schedule_template для day_of_week(date):
   - Если нет записи → вернуть [] (мастер не работает)
   - start_time, end_time, slot_minutes, break_start, break_end

4. Сгенерировать все слоты:
   from start_time до (end_time - duration_minutes) с шагом slot_minutes
   Исключить слоты, попадающие в break_start..break_end

5. Из таблицы bookings выбрать занятые на эту дату:
   WHERE master_id = ? AND DATE(starts_at) = date AND status != 'cancelled'

6. Для каждого слота проверить:
   слот занят если (slot_start < booking.ends_at AND slot_end > booking.starts_at)

7. Вернуть только свободные слоты
```

---

## ТЕМЫ ПРИЛОЖЕНИЯ (8 пресетов)

Тема = набор CSS-переменных. Хранится как статичный конфиг в коде.

```js
const THEMES = {
  default:    { accent: '#2aabee', bg: '#ffffff', name: 'Telegram Blue'   },
  ocean:      { accent: '#0ea5e9', bg: '#f0f9ff', name: 'Ocean'           },
  forest:     { accent: '#16a34a', bg: '#f0fdf4', name: 'Forest'          },
  sunset:     { accent: '#f97316', bg: '#fff7ed', name: 'Sunset'          },
  rose:       { accent: '#e11d48', bg: '#fff1f2', name: 'Rose'            },
  violet:     { accent: '#7c3aed', bg: '#f5f3ff', name: 'Violet'          },
  midnight:   { accent: '#3b82f6', bg: '#0f172a', name: 'Midnight Dark'   },
  minimal:    { accent: '#374151', bg: '#f9fafb', name: 'Minimal'         },
};

// Тема 'default' доступна всем.
// Остальные — только при plan = 'pro' или 'trial'.
```

---

## УВЕДОМЛЕНИЯ — КОГДА И КОМУ ЧТО ПРИХОДИТ

| Событие | Кому | Текст |
|---------|------|-------|
| Клиент создал запись | Мастеру через его бот | "📅 Новая запись: [Услуга], [Дата], [Клиент @username]" |
| Мастер подтвердил | Клиенту через бот мастера | "✅ Запись подтверждена: [Услуга], [Дата]" |
| Мастер отменил | Клиенту через бот мастера | "❌ Запись отменена. Причина: [причина]" |
| За 24 часа до записи | Клиенту | "⏰ Напоминание: завтра [время], [Услуга] у [Мастер]" |
| Оплата подписки прошла | Мастеру (платформенный бот) | "✅ Подписка активна до [дата]" |
| Подписка истекает через 3 дня | Мастеру | "⚠️ Подписка истекает [дата]. Продлить: [ссылка]" |

---

## ОГРАНИЧЕНИЯ И БИЗНЕС-ПРАВИЛА

```
1. FREE план:
   - Максимум 5 активных услуг (is_active = true)
   - Тема только 'default'
   - Полная функциональность записи — без ограничений

2. TRIAL (14 дней после регистрации):
   - Все функции PRO
   - Автоматически переходит в FREE по истечении

3. PRO (активная подписка):
   - Неограниченное кол-во услуг
   - Все 8 тем
   - Приоритетная поддержка (в будущем)

4. Попытка создать 6-ю услугу на FREE:
   API возвращает: 402 Payment Required
   { error: "limit_reached", message: "Лимит 5 услуг на бесплатном плане", upgrade_url: "..." }

5. Попытка сменить тему на FREE:
   API возвращает: 402 Payment Required
   { error: "pro_required", message: "Темы доступны на Pro-плане" }

6. Двойное бронирование:
   Перед INSERT в bookings — проверить занятость слота с SELECT FOR UPDATE
   Если занят → 409 Conflict { error: "slot_taken" }
```

---

## ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ (`.env`)

```env
# База данных
DATABASE_URL=postgresql://...supabase.co:5432/postgres

# Платформенный бот (для онбординга мастеров)
PLATFORM_BOT_TOKEN=123456:AAxxxxxxxx

# Шифрование bot_token мастеров
ENCRYPTION_KEY=<32-байтный hex-ключ, генерируется один раз>

# ЮKassa
YOOKASSA_SHOP_ID=123456
YOOKASSA_SECRET_KEY=live_xxxx
YOOKASSA_RETURN_URL=https://your-platform.vercel.app/payment/success

# Telegram Payments (для Stars)
# Используется тот же PLATFORM_BOT_TOKEN

# Цена подписки
SUBSCRIPTION_PRICE_RUB=490
SUBSCRIPTION_PRICE_STARS=50
SUBSCRIPTION_DAYS=30
```

---

## ПОРЯДОК РАЗРАБОТКИ (по фазам)

### Фаза 1 — Основа (MVP)
1. Настроить Supabase, создать все таблицы
2. Реализовать регистрацию мастера через платформенный бот
3. Реализовать `/api/master/:slug` — публичные данные
4. Реализовать Admin Mini App: услуги + расписание
5. Реализовать `/api/master/:slug/slots` — генерация слотов
6. Реализовать `/api/master/:slug/book` + уведомления
7. Реализовать `/api/photo` — прокси фото

**Результат:** мастер может зарегистрироваться, добавить услуги и получать записи.

### Фаза 2 — Монетизация
8. Интеграция ЮKassa — создание платежа, webhook подтверждения
9. Интеграция Telegram Stars
10. Логика лимитов (5 услуг, темы)
11. Напоминания за 24 часа (cron job в Vercel)

**Результат:** мастер платит за Pro, платформа зарабатывает.

### Фаза 3 — Рост
12. Статистика для мастера (кол-во записей, выручка за период)
13. Клиентская база (мастер видит своих постоянных клиентов)
14. Отзывы после записи
15. Промокоды

---

## КРИТИЧНЫЕ ПРОВЕРКИ БЕЗОПАСНОСТИ

```
□ НИКОГДА не возвращать bot_token в ответах API
□ Зашифровать bot_token в БД (AES-256-GCM, ключ в env)
□ Валидировать Telegram initData HMAC на КАЖДЫЙ запрос
□ Проверять master_id в каждом admin-запросе: user.id == master.telegram_user_id
□ SELECT FOR UPDATE перед созданием booking (защита от race condition)
□ Rate limiting: /api/master/:slug/book — не более 5 запросов/мин с одного IP
□ Webhook ЮKassa: проверять IP-whitelist ЮKassa + signature
□ bot_token не логировать (маскировать в логах: "8044...E48")
```

---

## ИТОГО: ЧТО СТРОИМ

**Это SaaS-конструктор для мастеров сферы услуг в Telegram.**

Мастер получает:
- Свой Telegram Mini App (`/m/his-slug`)
- Свой брендированный бот для клиентов
- Систему онлайн-записи с расписанием
- Управление услугами с фото
- Уведомления в реальном времени

Клиент мастера получает:
- Запись в 3 тапа, без регистрации
- Напоминание за 24 часа
- Всё внутри Telegram

Платформа (вы) получаете:
- 490 ₽/мес с каждого мастера на Pro
- Автоматический биллинг
- Нулевые расходы на инфраструктуру до ~1000 мастеров (Vercel + Supabase free)
