// =====================================================
// api/webhook.js — Vercel Serverless Function
//
// Принимает POST-запросы от Telegram-бота.
// Когда пользователь нажимает «Отправить менеджеру» в TMA,
// бот получает web_app_data и пересылает его сюда.
// Функция форматирует заявку и отправляет менеджеру в Telegram.
//
// Переменные окружения (задаются в Vercel → Settings → Env Variables):
//   BOT_TOKEN     — токен бота от @BotFather (секретный, не публиковать)
//   MANAGER_CHAT_ID — chat_id менеджера (узнать через @userinfobot)
// =====================================================

export default async function handler(req, res) {
  // Принимаем только POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const BOT_TOKEN      = process.env.BOT_TOKEN;
  const MANAGER_CHAT   = process.env.MANAGER_CHAT_ID;

  if (!BOT_TOKEN || !MANAGER_CHAT) {
    console.error('Не заданы BOT_TOKEN или MANAGER_CHAT_ID');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  try {
    const update = req.body;

    // Telegram шлёт web_app_data в поле message
    const msg      = update?.message;
    const webData  = msg?.web_app_data?.data;

    if (!webData) {
      // Другие типы апдейтов — просто игнорируем
      return res.status(200).json({ ok: true });
    }

    // Парсим JSON от TMA
    let payload;
    try {
      payload = JSON.parse(webData);
    } catch (e) {
      console.error('Не удалось распарсить web_app_data:', webData);
      return res.status(200).json({ ok: true });
    }

    // Формируем красивое сообщение менеджеру
    const text = formatOrder(payload, msg);

    // Отправляем менеджеру
    await sendTelegramMessage(BOT_TOKEN, MANAGER_CHAT, text);

    // Подтверждаем пользователю (необязательно, но приятно)
    if (msg?.chat?.id) {
      await sendTelegramMessage(
        BOT_TOKEN,
        msg.chat.id,
        '✅ *Заявка принята!*\n\nНаш инженер свяжется с вами в рабочее время: Пн–Пт 8:30–17:00.\n\nЕсли отправили в выходной — ответим в понедельник.',
        { parse_mode: 'Markdown' }
      );
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Ошибка обработки webhook:', err);
    return res.status(200).json({ ok: true }); // Telegram ждёт 200 всегда
  }
}

// ─────────────────────────────────────────────────────
// Форматирование текста заявки
// ─────────────────────────────────────────────────────
function formatOrder(payload, tgMessage) {
  const { items = [], comment, user } = payload;

  // Инфо о пользователе из Telegram
  const tgUser = tgMessage?.from;
  const name     = user?.name    || [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(' ') || 'Неизвестно';
  const username = user?.username || tgUser?.username;
  const contact  = username ? `@${username}` : `tg_id: ${tgUser?.id || '—'}`;

  // Список позиций
  const itemLines = items.map((p, i) =>
    `  ${i + 1}. *${p.article}*\n     Ø${p.D}/${p.d} мм · ход ${p.L} мм · ${p.P} МПа${p.fromCalc ? ' _(расчёт)_' : ''}`
  ).join('\n');

  const commentLine = comment
    ? `\n💬 *Комментарий:*\n${comment}`
    : '';

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
async function sendTelegramMessage(token, chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = {
    chat_id:    chatId,
    text:       text,
    parse_mode: extra.parse_mode || 'Markdown',
    ...extra,
  };

  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error('Telegram API error:', err);
  }

  return resp;
}
