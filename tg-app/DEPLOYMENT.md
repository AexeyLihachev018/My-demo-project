# DEPLOYMENT.md — Как бот работает и как его обновлять

## Текущая конфигурация (продакшн)

```
Бот:      @PromGidravlika_bot
Сервер:   Beget VPS — 193.168.48.98:8443 (HTTPS, самоподписанный SSL)
Mini App: https://my-demo-project-nt8u.vercel.app (Vercel)
Webhook:  https://193.168.48.98:8443/webhook
PM2:      процесс "bot", /app/bot/tg-app/
```

---

## Как устроена архитектура

```
GitHub (код)
    ↓ git pull вручную на сервере
Beget VPS (Node.js + Express + PM2)
    ↓ запросы к БД
Supabase (PostgreSQL)

Telegram → POST /webhook → VPS → ответ боту
Пользователь → открывает Mini App → Vercel (index.html)
```

- **GitHub** — хранит весь код
- **VPS** — запускает Express-сервер 24/7, обрабатывает webhook и API
- **Vercel** — отдаёт фронтенд Mini App (`tg-app/index.html`)
- **Supabase** — база данных (мастера, записи, сессии)
- **PM2** — процесс-менеджер: автозапуск при перезагрузке, авторестарт при краше

---

## Как обновить бота (основной сценарий)

### 1. Запушить изменения в GitHub
```bash
git add .
git commit -m "fix: описание изменения"
git push
```

### 2. Зайти на VPS и подтянуть код
```bash
ssh root@193.168.48.98
cd /app/bot && git pull && pm2 restart bot
```

### 3. Проверить что бот поднялся
```bash
pm2 status
# Должно быть: online
```

### 4. Проверить бота в Telegram
Написать `/start` боту [@PromGidravlika_bot](https://t.me/PromGidravlika_bot) — должна прийти кнопка «Открыть каталог».

---

## Переменные окружения

Файл `.env` на VPS: `/app/bot/tg-app/.env` (не в git)

| Переменная | Описание | Обязательная? |
|---|---|---|
| `BOT_TOKEN` | Токен бота от @BotFather | ✅ Да |
| `APP_URL` | `https://193.168.48.98:8443` | ✅ Да |
| `MANAGER_CHAT_ID` | chat_id менеджера (узнать через @userinfobot) | ✅ Да |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL | ✅ Да |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → service_role (secret) | ✅ Да |
| `WEBHOOK_SECRET` | Любая строка для защиты /api/set-webhook | ✅ Да |

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY` — полный доступ к БД. Никому не передавать!

Чтобы обновить переменную на VPS:
```bash
ssh root@193.168.48.98
nano /app/bot/tg-app/.env
pm2 restart bot
```

---

## SSL и webhook

Бот работает на самоподписанном сертификате. Telegram поддерживает это — нужно
передавать файл сертификата при регистрации webhook.

### Повторно зарегистрировать webhook (если сломался)
```bash
ssh root@193.168.48.98
cd /app/bot/tg-app
curl -F "url=https://193.168.48.98:8443/webhook" \
     -F "certificate=@ssl/server.crt" \
     "https://api.telegram.org/bot$(grep BOT_TOKEN .env | cut -d= -f2)/setWebhook"
```

Должен прийти ответ `{"ok":true}`.

---

## Диагностика — что делать если что-то не работает

### Проверить статус бота
```bash
ssh root@193.168.48.98
pm2 status          # статус процесса
pm2 logs bot        # последние логи в реальном времени
```

### Посмотреть файл ошибок
```bash
ssh root@193.168.48.98
cat /app/bot/tg-app/logs/errors.log
```

### Проверить webhook в Telegram
```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```
Правильный ответ:
```json
{
  "ok": true,
  "result": {
    "url": "https://193.168.48.98:8443/webhook",
    "has_custom_certificate": true,
    "pending_update_count": 0,
    "last_error_message": ""
  }
}
```

### Тестовый POST вручную
```bash
curl -k -X POST https://193.168.48.98:8443/webhook \
  -H "Content-Type: application/json" \
  -d '{"message":{"chat":{"id":123},"text":"/start","from":{"first_name":"Test"}}}'
# Ожидаемо: {"ok":true}
```

### Типичные проблемы

| Проблема | Причина | Решение |
|---|---|---|
| Бот молчит | Процесс упал | `pm2 restart bot` |
| Бот молчит | Webhook не зарегистрирован | Повтори регистрацию webhook |
| Ошибки в логах: Supabase | Нет переменных в .env | Проверь .env + `pm2 restart bot` |
| pm2 не стартует при перезагрузке VPS | Не настроен startup | `pm2 startup` + `pm2 save` |
| SSL ошибка | Сертификат протух | Создать новый: `openssl req -x509 ...` |

---

## Файлы проекта — что за что отвечает

```
tg-app/
  index.html              ← Telegram Mini App (каталог, весь фронтенд)
  server.js               ← Express HTTPS-сервер (запускается на VPS)
  vercel.json             ← правила маршрутизации для Vercel
  package.json            ← зависимости: express, @supabase/supabase-js, dotenv
  ssl/                    ← SSL-сертификат (не в git, создаётся вручную)
  logs/                   ← логи ошибок (не в git)
  lib/
    logger.js             ← логирование: info/warn/error → logs/errors.log
    supabase.js           ← клиент Supabase
  api/
    webhook.js            ← главный обработчик сообщений и заявок бота
    set-webhook.js        ← одноразовая регистрация webhook
    platform-webhook.js   ← онбординг и платформа мастеров
    m/[slug].js           ← HTML-страница мастера /m/:slug
    master/[slug].js      ← JSON данных мастера
```

---

## Деплой с нуля на новый VPS

Если нужно развернуть всё с нуля:

```bash
# 1. Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 2. PM2
npm install -g pm2

# 3. Код
mkdir -p /app/bot && cd /app/bot
git clone https://github.com/AexeyLihachev018/My-demo-project.git .
cd tg-app && npm install

# 4. SSL
mkdir ssl
openssl req -x509 -newkey rsa:2048 -keyout ssl/server.key -out ssl/server.crt \
  -days 3650 -nodes -subj "/CN=193.168.48.98"

# 5. .env
cp .env.example .env
nano .env   # заполнить значения

# 6. Запуск
cd /app/bot/tg-app
pm2 start server.js --name bot
pm2 startup && pm2 save

# 7. Открыть порт 8443 (если закрыт)
ufw allow 8443

# 8. Зарегистрировать webhook
curl -F "url=https://193.168.48.98:8443/webhook" \
     -F "certificate=@ssl/server.crt" \
     "https://api.telegram.org/bot$(grep BOT_TOKEN .env | cut -d= -f2)/setWebhook"
```

---

## Альтернативный деплой через Vercel (только для фронта)

Mini App (`tg-app/index.html`) автоматически деплоится на Vercel при каждом `git push`.
URL: https://my-demo-project-nt8u.vercel.app

Переменные окружения для Vercel (если перенести бота обратно):
- Vercel → Project → Settings → Environment Variables
- Добавить: `BOT_TOKEN`, `MANAGER_CHAT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WEBHOOK_SECRET`, `APP_URL`

Webhook на Vercel (без SSL-сертификата):
```
GET https://my-demo-project-nt8u.vercel.app/api/set-webhook?secret=ТВОЙ_СЕКРЕТ
```
