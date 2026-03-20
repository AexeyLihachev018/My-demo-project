# DEPLOYMENT.md — Как бот работает 24/7

## Как это устроено (без сервера!)

Этот проект **не требует сервера**. Всё работает через три облачных сервиса:

```
GitHub (код)
    ↓ при каждом push
Vercel (запускает код)
    ↓ запросы к базе данных
Supabase (хранит данные)

Telegram → POST запрос → Vercel → ответ боту
```

- **GitHub** — хранит код
- **Vercel** — запускает код когда приходит запрос (бесплатно, 24/7)
- **Supabase** — база данных (бесплатно до 500MB)
- **Telegram** — сам доставляет сообщения на Vercel через webhook

---

## Что такое webhook (простыми словами)

Обычный бот постоянно спрашивает Telegram «есть новые сообщения?» — это плохо.

Webhook — это наоборот: Telegram сам звонит на наш адрес когда приходит сообщение.
Наш адрес: `https://my-demo-project-nt8u.vercel.app/api/webhook`

Зарегистрировать webhook нужно **один раз**. После этого всё работает само.

---

## Переменные окружения (секреты)

Это настройки которые нельзя хранить в коде (токены, пароли).
Хранятся в Vercel → Project → Settings → **Environment Variables**.

| Переменная | Откуда взять | Обязательная? |
|---|---|---|
| `BOT_TOKEN` | @BotFather → токен бота @PromGidravlika_bot | ✅ Да |
| `MANAGER_CHAT_ID` | Твой chat_id (узнать через @userinfobot) | ✅ Да |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL | ✅ Да |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role (secret) | ✅ Да |
| `WEBHOOK_SECRET` | Любая строка, например `mySecret123` | ✅ Да |

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY` — это секретный ключ с полным доступом к БД. Никому не давать!

---

## Полная пошаговая инструкция

### Шаг 1 — Убедись что код в GitHub

```bash
# В терминале, в папке Project-1:
git status            # покажет изменения
git add .
git commit -m "feat: deploy"
git push
```

После push Vercel **автоматически** начнёт деплой (занимает ~1 минуту).

---

### Шаг 2 — Проверь переменные окружения в Vercel

1. Открой [vercel.com](https://vercel.com) → войди в аккаунт
2. Выбери проект `my-demo-project` (или как он называется)
3. Перейди: **Settings → Environment Variables**
4. Убедись что все 5 переменных есть:
   - `BOT_TOKEN`
   - `MANAGER_CHAT_ID`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `WEBHOOK_SECRET`

Если какой-то нет — нажми **Add** и добавь.

> ⚠️ После добавления переменной нужен редеплой (Шаг 1 — пустой коммит)

---

### Шаг 3 — Зарегистрируй webhook (один раз)

Открой в браузере эту ссылку (замени `ТВОЙ_СЕКРЕТ` на значение `WEBHOOK_SECRET`):

```
https://my-demo-project-nt8u.vercel.app/api/set-webhook?secret=ТВОЙ_СЕКРЕТ
```

Должен прийти ответ:
```json
{"ok": true, "result": true, "description": "Webhook was set"}
```

Если ошибка — см. раздел «Диагностика» ниже.

---

### Шаг 4 — Проверь что бот отвечает

Открой [@PromGidravlika_bot](https://t.me/PromGidravlika_bot) в Telegram и напиши `/start`.
Должна прийти кнопка «Открыть каталог».

---

## Как обновить бота

Просто push в GitHub — Vercel сам задеплоит новую версию:

```bash
git add .
git commit -m "fix: исправить что-то"
git push
```

Деплой занимает ~60 секунд. Бот продолжает отвечать во время деплоя.

---

## Диагностика — что делать если что-то не работает

### Проверить текущий webhook

Открой в браузере (замени `ТОКЕН` на токен бота):
```
https://api.telegram.org/botТОКЕН/getWebhookInfo
```

Правильный ответ:
```json
{
  "ok": true,
  "result": {
    "url": "https://my-demo-project-nt8u.vercel.app/api/webhook",
    "has_custom_certificate": false,
    "pending_update_count": 0,
    "last_error_message": ""   ← если тут текст — это ошибка
  }
}
```

### Посмотреть логи ошибок

1. Vercel → выбери проект
2. Перейди в **Deployments** → выбери последний деплой
3. Или: **Logs** (там видно все запросы и ошибки в реальном времени)

### Типичные проблемы

| Проблема | Причина | Решение |
|---|---|---|
| Бот молчит | Webhook не зарегистрирован | Повтори Шаг 3 |
| Бот молчит | Нет BOT_TOKEN в Vercel | Добавь переменную + редеплой |
| Ошибка в логах: `SUPABASE_URL` | Нет переменной Supabase | Добавь обе Supabase-переменные |
| Webhook не ставится (403) | Неверный WEBHOOK_SECRET | Проверь что `?secret=` совпадает с переменной |
| Деплой завис | Случается | Зайди в Vercel → Deployments → Cancel → снова push |

### Принудительный редеплой (без изменений кода)

```bash
git commit --allow-empty -m "chore: trigger redeploy"
git push
```

---

## Файлы проекта — что за что отвечает

```
tg-app/
  index.html              ← Telegram Mini App (каталог, весь фронтенд)
  vercel.json             ← правила маршрутизации URL
  package.json            ← зависимости (только @supabase/supabase-js)
  lib/
    supabase.js           ← подключение к базе данных
  api/
    webhook.js            ← главный обработчик сообщений бота
    set-webhook.js        ← одноразовая регистрация webhook
    platform-webhook.js   ← онбординг мастеров (пока не используется)
    m/
      [slug].js           ← страница мастера /m/название
    master/
      [slug].js           ← API данных мастера (JSON)
```

---

## Структура запроса (как работает изнутри)

```
1. Пользователь пишет боту
2. Telegram отправляет POST на https://...vercel.app/api/webhook
3. Vercel запускает api/webhook.js (Node.js, ~100ms)
4. webhook.js читает данные из Supabase (если нужно)
5. webhook.js отвечает через Telegram API
6. Vercel останавливает функцию (платим только за время работы)
```

Функция работает **только пока обрабатывает запрос**. Между запросами ничего не работает и не тратится.

---

## Стоимость

| Сервис | Бесплатно | Лимит |
|---|---|---|
| Vercel | Hobby план | 100GB трафика/мес, 100 000 вызовов/день |
| Supabase | Free план | 500MB БД, 50 000 запросов/мес |
| Telegram Bot API | Всегда бесплатно | — |

Для проекта масштаба @PromGidravlika_bot бесплатных лимитов хватит надолго.
