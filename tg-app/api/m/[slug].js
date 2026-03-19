// =====================================================
// api/m/[slug].js — Клиентский Mini App мастера
//
// GET /m/maria-beauty → HTML страница с услугами мастера
//
// Что видит клиент:
//   - Имя и описание мастера (шапка)
//   - Список услуг с ценой и длительностью
//   - Кнопка "Записаться" для каждой услуги
// =====================================================

import { supabase } from '../../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  const { slug } = req.query;

  // 1. Загружаем мастера
  const { data: master, error: masterError } = await supabase
    .from('masters')
    .select('id, slug, brand_name, description, theme_id')
    .eq('slug', slug)
    .eq('is_active', true)
    .single();

  if (masterError || !master) {
    return res.status(404).send(notFoundPage(slug));
  }

  // 2. Загружаем его активные услуги
  const { data: services } = await supabase
    .from('services')
    .select('id, title, description, duration_minutes, price, photo_url')
    .eq('master_id', master.id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  // 3. Возвращаем HTML страницу
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(buildPage(master, services || []));
}

// ─────────────────────────────────────────────────────
// Генерация HTML страницы
// ─────────────────────────────────────────────────────
function buildPage(master, services) {
  const serviceCards = services.length > 0
    ? services.map(s => serviceCard(s)).join('')
    : `<div class="empty">
        <p>Мастер пока не добавил услуги.</p>
        <p>Загляните позже!</p>
       </div>`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>${escHtml(master.brand_name)}</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--tg-theme-bg-color, #fff);
      color: var(--tg-theme-text-color, #000);
      min-height: 100vh;
    }

    /* Шапка мастера */
    .header {
      background: var(--tg-theme-secondary-bg-color, #f4f4f5);
      padding: 24px 16px 20px;
      text-align: center;
      border-bottom: 1px solid rgba(0,0,0,0.06);
    }
    .header h1 {
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 6px;
      color: var(--tg-theme-text-color, #000);
    }
    .header p {
      font-size: 14px;
      color: var(--tg-theme-hint-color, #888);
      line-height: 1.5;
    }

    /* Список услуг */
    .section-title {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--tg-theme-hint-color, #888);
      padding: 20px 16px 8px;
    }

    .services {
      padding: 0 12px 100px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* Карточка услуги */
    .service-card {
      background: var(--tg-theme-secondary-bg-color, #f4f4f5);
      border-radius: 14px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .service-card.has-photo {
      padding: 0;
      overflow: hidden;
    }
    .service-photo {
      width: 100%;
      height: 160px;
      object-fit: cover;
    }
    .service-body {
      padding: 14px 16px 16px;
    }
    .service-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--tg-theme-text-color, #000);
    }
    .service-desc {
      font-size: 13px;
      color: var(--tg-theme-hint-color, #888);
      line-height: 1.4;
      margin-top: 4px;
    }
    .service-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 12px;
    }
    .service-duration {
      font-size: 13px;
      color: var(--tg-theme-hint-color, #888);
    }
    .service-price {
      font-size: 17px;
      font-weight: 700;
      color: var(--tg-theme-button-color, #2aabee);
    }
    .btn-book {
      width: 100%;
      padding: 12px;
      margin-top: 10px;
      background: var(--tg-theme-button-color, #2aabee);
      color: var(--tg-theme-button-text-color, #fff);
      border: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      min-height: 44px;
    }
    .btn-book:active { opacity: 0.8; }

    /* Пустой список */
    .empty {
      text-align: center;
      padding: 60px 16px;
      color: var(--tg-theme-hint-color, #888);
      font-size: 15px;
      line-height: 1.8;
    }

    /* Toast уведомление */
    .toast {
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: rgba(0,0,0,0.75);
      color: #fff;
      padding: 10px 18px;
      border-radius: 20px;
      font-size: 14px;
      opacity: 0;
      transition: all 0.3s;
      pointer-events: none;
      white-space: nowrap;
      z-index: 100;
    }
    .toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  </style>
</head>
<body>

  <div class="header">
    <h1>${escHtml(master.brand_name)}</h1>
    ${master.description ? `<p>${escHtml(master.description)}</p>` : ''}
  </div>

  ${services.length > 0 ? '<div class="section-title">Услуги</div>' : ''}

  <div class="services">
    ${serviceCards}
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
    }

    function showToast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 3000);
    }

    function book(serviceId, serviceTitle) {
      // Пока записи нет — скоро появится
      // В следующей версии откроется экран выбора времени
      showToast('Запись скоро появится!');

      // Уведомляем Telegram что произошло действие (для аналитики)
      if (tg) {
        tg.HapticFeedback?.impactOccurred('light');
      }
    }
  </script>

</body>
</html>`;
}

function serviceCard(s) {
  const duration = s.duration_minutes >= 60
    ? `${Math.floor(s.duration_minutes / 60)} ч${s.duration_minutes % 60 ? ' ' + s.duration_minutes % 60 + ' мин' : ''}`
    : `${s.duration_minutes} мин`;

  const price = s.price ? `${s.price.toLocaleString('ru-RU')} ₽` : 'По договорённости';

  const photo = s.photo_url
    ? `<img class="service-photo" src="${escHtml(s.photo_url)}" alt="${escHtml(s.title)}" loading="lazy">`
    : '';

  const hasPhoto = !!s.photo_url;

  return `
    <div class="service-card ${hasPhoto ? 'has-photo' : ''}">
      ${photo}
      <div class="service-body">
        <div class="service-title">${escHtml(s.title)}</div>
        ${s.description ? `<div class="service-desc">${escHtml(s.description)}</div>` : ''}
        <div class="service-meta">
          <span class="service-duration">⏱ ${duration}</span>
          <span class="service-price">${price}</span>
        </div>
        <button class="btn-book" onclick="book('${s.id}', '${escJs(s.title)}')">
          Записаться
        </button>
      </div>
    </div>`;
}

function notFoundPage(slug) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Мастер не найден</title>
  <style>
    body { font-family: sans-serif; text-align: center; padding: 60px 20px; color: #333; }
    h1 { font-size: 48px; margin-bottom: 16px; }
    p { color: #888; font-size: 16px; }
  </style>
</head>
<body>
  <h1>404</h1>
  <p>Мастер <strong>${escHtml(slug || '')}</strong> не найден</p>
</body>
</html>`;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escJs(str) {
  return String(str || '').replace(/'/g, "\\'").replace(/\\/g, '\\\\');
}
