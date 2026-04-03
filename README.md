# Промгидравлика — мини-сайт + Telegram-бот

Проект группы компаний «Промгидравлика» (Ижевск).
Два независимых модуля: лендинг-калькулятор и Telegram Mini App с каталогом.

---

## Модули проекта

### 1. Лендинг-калькулятор (`index.html`)

Основная страница сайта. Позволяет клиенту рассчитать гидроцилиндр и отправить запрос.

- Двухэтапный калькулятор: усилие + давление → диаметр по ГОСТ → полный расчёт
- Форма «Получить КП» с отправкой в Telegram-бот
- Тёмно-синяя тема (`#030b1a` / `#3b82f6`)
- Адаптив от 600px (целевой — 320px)
- Никаких зависимостей: чистый HTML/CSS/JS

### 2. Telegram Mini App (`tg-app/`)

Каталог гидроцилиндров внутри Telegram. Бот: [@PromGidravlika_bot](https://t.me/PromGidravlika_bot)

- 26 позиций каталога с фильтрацией по диаметру и давлению
- Калькулятор гидроцилиндра (2 шага)
- Заявка (корзина) с отправкой менеджеру
- Страница мастера по slug (`/m/:slug`)
- Запущен на **Beget VPS** (IP: 193.168.48.98, порт 8443) через PM2

---

## Структура репозитория

```
Project-1/
├── index.html                  # Лендинг-калькулятор (основная страница)
├── landing.html                # v1 калькулятора (резервная копия)
├── My-demo-project/
│   └── vizitka.html            # Личная визитка Алексея (не часть сайта)
├── tg-app/
│   ├── index.html              # Telegram Mini App (весь фронтенд)
│   ├── server.js               # Express HTTPS-сервер для VPS
│   ├── package.json
│   ├── vercel.json
│   ├── .env.example
│   ├── api/
│   │   ├── webhook.js          # Обработчик сообщений бота
│   │   ├── set-webhook.js      # Регистрация webhook (одноразово)
│   │   ├── platform-webhook.js # Онбординг платформы мастеров
│   │   ├── m/[slug].js         # Страница мастера /m/:slug
│   │   └── master/[slug].js    # API данных мастера (JSON)
│   ├── lib/
│   │   ├── logger.js           # Логирование (info/warn/error → logs/errors.log)
│   │   └── supabase.js         # Клиент Supabase
│   ├── DEPLOYMENT.md           # Инструкция по деплою (Vercel + VPS)
│   ├── TESTING.md              # Руководство тестировщика
│   └── CLAUDE.md               # Правила работы для ИИ
├── backend/
│   └── db/
│       ├── 001_init.sql        # Схема БД
│       ├── 002_migration.sql
│       └── 003_sessions.sql
├── project.md                  # Описание проекта
├── PLAN.md                     # Чек-лист задач
├── BACKEND-PLAN.md             # Архитектура SaaS-платформы мастеров
├── brief.md                    # Техническое задание
├── research.md                 # UX-исследование
└── CLAUDE.md                   # Правила для ИИ-ассистента
```

---

## Технический стек

| Слой | Технология |
|------|-----------|
| Фронтенд лендинга | Vanilla HTML/CSS/JS |
| Telegram Mini App | Vanilla HTML/CSS/JS + Telegram Web App SDK |
| Серверная часть | Node.js 20 (ES modules), Express |
| База данных | Supabase (PostgreSQL) |
| Очереди | Upstash QStash |
| Хостинг бота | Beget VPS (Ubuntu 24.04, PM2) |
| Хостинг фронта | Vercel (автодеплой при push) |
| SSL | Самоподписанный сертификат (порт 8443) |

---

## Быстрый старт

### Локальный запуск лендинга
```bash
open index.html   # просто открыть в браузере
```

### Локальный запуск Mini App
```bash
open tg-app/index.html   # работает без Telegram, через localStorage
```

### Деплой обновлений на VPS
```bash
git push   # → зайти на VPS:
ssh root@193.168.48.98
cd /app/bot && git pull && pm2 restart bot
```

Подробнее — [tg-app/DEPLOYMENT.md](tg-app/DEPLOYMENT.md)

---

## Контакты компании

- Тел: +7 (3412) 77-57-04
- Бесплатно: 8 (800) 444-70-65
- Email: info@p-gidravlika.ru
- Сайт: https://p-gidravlika.ru
- Пн–Пт 8:30–17:00
