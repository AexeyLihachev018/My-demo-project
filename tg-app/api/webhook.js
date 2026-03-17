// =====================================================
// api/webhook.js — Vercel Serverless Function
//
// Переменные окружения (Vercel → Settings → Environment Variables):
//   BOT_TOKEN       — токен бота от @BotFather
//   MANAGER_CHAT_ID — chat_id менеджера (узнать через @userinfobot)
// =====================================================

const APP_URL = 'https://my-demo-project-nt8u.vercel.app/';

export default async function handler(req, res) {
  // DEBUG endpoint — убрать после проверки
  if (req.method === 'GET') {
    return res.status(200).json({
      has_token: !!process.env.BOT_TOKEN,
      token_start: process.env.BOT_TOKEN ? process.env.BOT_TOKEN.slice(0,8) : 'NOT SET'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const BOT_TOKEN    = process.env.BOT_TOKEN;
  const MANAGER_CHAT = process.env.MANAGER_CHAT_ID;

  if (!BOT_TOKEN) {
    console.error('BOT_TOKEN не задан');
    return res.status(200).json({ ok: false, error: 'no token' });
  }

  try {
    const update = req.body;
    const msg    = update?.message;
    if (!msg) return res.status(200).json({ ok: true });

    const chatId  = msg.chat?.id;
    const text    = msg.text || '';
    const webData = msg.web_app_data?.data;

    // ── Команда /start ────────────────────────────────
    if (text.startsWith('/start')) {
      const firstName = msg.from?.first_name || '';
      const greeting  = firstName ? `Привет, ${firstName}!` : 'Привет!';
      const tgResp = await sendMessage(BOT_TOKEN, chatId,
        `${greeting}\n\nЭто каталог гидроцилиндров Промгидравлика.\n\nЗдесь можно:\n- Найти цилиндр по диаметру или артикулу\n- Рассчитать нужный размер по усилию и давлению\n- Отправить заявку менеджеру прямо из чата\n\nНажмите кнопку ниже:`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: 'Открыть каталог', web_app: { url: APP_URL } }
            ]]
          }
        }
      );
      const tgResult = await tgResp.json().catch(() => ({}));
      console.log('sendMessage result:', JSON.stringify(tgResult));
      return res.status(200).json({ ok: true, tg: tgResult.ok, desc: tgResult.description });
    }

    // ── Команда /help ─────────────────────────────────
    if (text.startsWith('/help')) {
      await sendMessage(BOT_TOKEN, chatId,
        `*Помощь — Промгидравлика*\n\n` +
        `📦 *Каталог* — гидроцилиндры Ø32–Ø200 мм\n` +
        `🧮 *Калькулятор* — подбор по усилию и давлению\n` +
        `📋 *Заявка* — отправить список позиций менеджеру\n\n` +
        `*Контакты:*\n` +
        `📞 +7 (3412) 77-57-04\n` +
        `🌐 p-gidravlika.ru\n` +
        `🕐 Пн–Пт 8:30–17:00`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: '📦 Открыть каталог', web_app: { url: APP_URL } }
            ]]
          }
        }
      );
      return res.status(200).json({ ok: true });
    }

    // ── Команда /catalog ──────────────────────────────
    if (text.startsWith('/catalog') || text.startsWith('/calc')) {
      await sendMessage(BOT_TOKEN, chatId,
        `Открываю каталог 👇`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: '📦 Открыть каталог', web_app: { url: APP_URL } }
            ]]
          }
        }
      );
      return res.status(200).json({ ok: true });
    }

    // ── Данные из Mini App (заявка) ───────────────────
    if (webData) {
      let payload;
      try { payload = JSON.parse(webData); }
      catch (e) { return res.status(200).json({ ok: true }); }

      // Отправить менеджеру (если задан MANAGER_CHAT_ID)
      if (MANAGER_CHAT) {
        const orderText = formatOrder(payload, msg);
        await sendMessage(BOT_TOKEN, MANAGER_CHAT, orderText);
      }

      // Подтвердить пользователю
      await sendMessage(BOT_TOKEN, chatId,
        `✅ *Заявка принята!*\n\n` +
        `Наш инженер свяжется с вами в рабочее время: Пн–Пт 8:30–17:00.\n\n` +
        `Если отправили в выходной — ответим в понедельник.`
      );
      return res.status(200).json({ ok: true });
    }

    // ── Любое другое сообщение ────────────────────────
    await sendMessage(BOT_TOKEN, chatId,
      `Используйте кнопку ниже для работы с каталогом 👇`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '📦 Открыть каталог', web_app: { url: APP_URL } }
          ]]
        }
      }
    );
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Ошибка webhook:', err);
    return res.status(200).json({ ok: true });
  }
}

// ─────────────────────────────────────────────────────
// Форматирование заявки для менеджера
// ─────────────────────────────────────────────────────
function formatOrder(payload, tgMessage) {
  const { items = [], comment, user } = payload;
  const tgUser   = tgMessage?.from;
  const name     = user?.name || [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(' ') || 'Неизвестно';
  const username = user?.username || tgUser?.username;
  const contact  = username ? `@${username}` : `tg_id: ${tgUser?.id || '—'}`;

  const itemLines = items.map((p, i) =>
    `  ${i + 1}. *${p.article}*\n     Ø${p.D}/${p.d} мм · ход ${p.L} мм · ${p.P} МПа${p.fromCalc ? ' _(расчёт)_' : ''}`
  ).join('\n');

  const commentLine = comment ? `\n💬 *Комментарий:*\n${comment}` : '';

  const now = new Date().toLocaleString('ru-RU', {
    timeZone: 'Asia/Yekaterinburg',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  return [
    `📋 *Новая заявка из каталога TMA*`,
    ``,
    `👤 *Клиент:* ${name} (${contact})`,
    ``,
    `🔩 *Позиции (${items.length}):*`,
    itemLines,
    commentLine,
    ``,
    `🕐 ${now} (Екб)`,
    ``,
    `_Ответьте на это сообщение или напишите клиенту напрямую_`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────
// Отправка сообщения через Telegram Bot API
// ─────────────────────────────────────────────────────
async function sendMessage(token, chatId, text, extra = {}) {
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', ...extra }),
  });
  if (!resp.ok) console.error('Telegram API error:', await resp.text());
  return resp;
}
