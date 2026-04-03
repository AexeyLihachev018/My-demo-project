# CLAUDE.md — Telegram Mini App «Промгидравлика»

## Структура файлов

```
tg-app/
  index.html              — единственный файл Mini App (весь CSS, JS и данные внутри)
  server.js               — Express HTTPS-сервер для VPS (порт 8443, самоподписанный SSL)
  package.json            — зависимости: express, @supabase/supabase-js, dotenv
  vercel.json             — конфиг Vercel (rewrites, CORS)
  .env.example            — шаблон переменных окружения
  ssl/                    — SSL-сертификат (не в git, создаётся вручную openssl)
  logs/                   — логи ошибок (не в git, пишется автоматически)
  lib/
    logger.js             — логирование: info/warn/error, error-уровень → logs/errors.log
    supabase.js           — клиент Supabase (createClient)
  api/
    webhook.js            — главный обработчик сообщений и заявок бота
    set-webhook.js        — одноразовая регистрация webhook в Telegram
    platform-webhook.js   — платформа мастеров: онбординг, запись, платежи
    m/[slug].js           — HTML-страница мастера /m/:slug
    master/[slug].js      — API данных мастера (JSON)
  CLAUDE.md               — этот файл
```

Фронтенд (`index.html`) — один самодостаточный HTML-файл без зависимостей, кроме
`https://telegram.org/js/telegram-web-app.js` (подключается из `<head>`).

Серверная часть (`server.js` + `api/`) — Node.js ES modules, запускается через PM2 на VPS.

---

## Архитектура: 6 экранов

Все экраны — `<div class="screen" id="s-*">`, один активный в каждый момент.
Переходы — CSS transform translateX (slide 250ms).

```
ГЛАВНЫЙ (s-home)
  ├── ПОИСК         (s-search)   — строка поиска + фильтрация
  ├── КАТАЛОГ       (s-catalog)  — список по категории + фильтры
  │     └── КАРТОЧКА ТОВАРА (s-product)
  ├── КАЛЬКУЛЯТОР   (s-calc)     — 2 шага
  └── ЗАЯВКА        (s-cart)     — корзина + отправка
```

---

## Навигация

- **Стек**: `S.stack: string[]` — массив id экранов.
  `go('catalog')` — вперёд, `goBack()` — назад.
- **BackButton Telegram** автоматически показывается/скрывается.
- **Кнопки действий** на всех элементах: атрибут `data-a="..."`.
  Единый обработчик `document.addEventListener('click', ...)` — `switch(a)`.

---

## Где менять данные

### Каталог товаров
`const PRODUCTS = [...]` — в начале `<script>`.
Каждый товар: `{ article, D, d, L, P, price_from, stock, lead_time }`.
- `stock`: `'available'` / `'order'` / `'custom'`
- `price_from`: число в рублях или `null` (→ «По запросу»)

### Категории главного экрана
`const CATS = [...]` — 6 плиток (Ø32, Ø40, Ø50, Ø63, Ø80, Ø100+).

### Контакты
В функции `drawHome()` — телефон и сайт внизу страницы.
Username бота: `@PromGidravlika_Bot` — в функциях `sendOrder()` и обработчике `go-mgr`.
Чтобы изменить: найти `PromGidravlika_Bot` и заменить на актуальный username (только Latin, ends with `bot`).

---

## Telegram SDK

Инициализация в начале `<script>`:
```js
const tg = window.Telegram?.WebApp;
const hasTG = !!tg;
```

- `hasTG === false` → приложение работает в браузере (localStorage вместо CloudStorage).
- `tg.MainButton` — управляется из `setMainBtn(screenId)` и `updateCalcBtn()`.
- `tg.sendData(json)` — отправка заявки боту (только из inline-кнопки бота).

---

## Состояние (`const S`)

| Поле         | Тип       | Описание |
|--------------|-----------|----------|
| `stack`      | string[]  | Стек экранов для навигации |
| `cart`       | object[]  | Позиции в заявке |
| `recent`     | object[]  | Недавно просмотренные (до 10) |
| `scrollPos`  | object    | Запомненные позиции скролла |
| `catFilter`  | object    | Активный фильтр каталога |
| `product`    | object    | Текущий просматриваемый товар |
| `calcStep`   | 1 \| 2   | Текущий шаг калькулятора |
| `calcUnit`   | 'N'\|'kg' | Единица усилия в калькуляторе |
| `cF/cP/cD…`  | string    | Значения полей калькулятора |
| `res1/res2`  | object    | Результаты расчёта |

---

## Рендеринг

Каждый экран — функция `draw*()`  → возвращает HTML-строку → записывается в `innerHTML`.
Вызывается через `draw(id)` → `switch(id)`.

После записи вызывается `bindEvents(id, el)` — навешивает обработчики для:
- поля поиска (автофокус + live-фильтр)
- полей калькулятора (live-пересчёт через `calcLive()`)

---

## Калькулятор

**Шаг 1**: усилие + давление → диаметр по ГОСТ.
Формула: `D_min = √(4F / πP) × 1000` мм.

**Шаг 2**: D, d, L, t, P → объёмы, расход, усилия, артикул.
Формулы в функции `calcCyl(D, d, L, t, P)`.

Переход: `calcGoStep2()` — с валидацией обязательных полей.
Inline-ошибки: `markFieldErr(container, selector, msg)` — без alert().

---

## Данные между сессиями

| Данные       | Telegram                         | Браузер (тест) |
|--------------|----------------------------------|----------------|
| Корзина      | `tg.CloudStorage` key `cart_v2`  | `localStorage` |
| История      | `tg.CloudStorage` key `recent_v2`| `localStorage` |

---

## Отправка заявки

`sendOrder()` → `tg.sendData(JSON)`.
Формат данных:
```json
{
  "items":   [{ "article": "ГЦ-63/40-300", "D": 63, ... }],
  "comment": "...",
  "user":    { "id": 123, "name": "Иван", "username": "ivan" }
}
```

Бот принимает `web_app_data` и пересылает менеджеру.
**Важно**: `sendData` работает только когда TMA открыта через inline-кнопку бота.

---

## Дизайн

- CSS-переменные берутся из Telegram theme (`--tg-theme-*`) с fallback на светлые значения.
- Тёмная тема поддерживается автоматически через Telegram SDK.
- Акцент: `#2aabee` (telegram blue), оранжевый `#f97316` — для D-параметра и результатов.
- Все тапабельные элементы ≥ 44px.

---

## Запуск и тестирование

**В браузере** (без Telegram):
- Открыть `tg-app/index.html` напрямую или через `file://`
- `hasTG = false` → localStorage, кнопки отображаются внутри страницы

**На VPS (продакшн):**
```bash
ssh root@193.168.48.98
cd /app/bot && git pull && pm2 restart bot
```

**В Telegram**:
1. Бот: @PromGidravlika_bot — написать `/start`
2. Нажать «Открыть каталог» → откроется Mini App

**Проверка sendData**:
- Нужен бот с обработчиком `web_app_data`
- Минимальный пример на Node.js: ~20 строк через `node-telegram-bot-api`
