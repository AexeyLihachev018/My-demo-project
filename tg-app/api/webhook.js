// =====================================================
// api/webhook.js — два режима работы:
//
// 1. БЕЗ master_id → Каталог Промгидравлика (старый режим)
//    URL: /api/webhook
//    Бот: @PromGidravlika_bot (BOT_TOKEN)
//
// 2. С master_id → Бот конкретного мастера (новый режим)
//    URL: /api/webhook?master_id=uuid
//    Бот: бот мастера (bot_token из БД)
// =====================================================

import { supabase } from '../lib/supabase.js';
import { log }      from '../lib/logger.js';

const APP_URL = process.env.APP_URL || 'https://my-demo-project-nt8u.vercel.app';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { master_id } = req.query;

  // ── Режим 2: Бот мастера (если есть master_id в URL) ──────────
  if (master_id) {
    return handleMasterBot(req, res, master_id);
  }

  // ── Режим 1: Каталог Промгидравлика ───────────────────────────
  return handleCatalog(req, res);
}

// =====================================================
// РЕЖИМ 1: Каталог гидроцилиндров Промгидравлика
// =====================================================
async function handleCatalog(req, res) {
  const BOT_TOKEN    = process.env.BOT_TOKEN;
  const MANAGER_CHAT = process.env.MANAGER_CHAT_ID;

  if (!BOT_TOKEN) {
    log.error('webhook/catalog', 'BOT_TOKEN не задан');
    return res.status(200).json({ ok: false, error: 'no token' });
  }

  try {
    const update = req.body;
    const msg    = update?.message;
    if (!msg) return res.status(200).json({ ok: true });

    const chatId  = msg.chat?.id;
    const text    = msg.text || '';
    const webData = msg.web_app_data?.data;

    // ── /chatid (служебная: узнать свой chat_id) ──────
    if (text.startsWith('/chatid')) {
      log.info('webhook/chatid', 'Запрос chat_id', { chatId, username: msg.from?.username });
      await sendMessage(BOT_TOKEN, chatId,
        `Ваш chat_id: \`${chatId}\`\n\nПропишите это значение в MANAGER_CHAT_ID на VPS.`
      );
      return res.status(200).json({ ok: true });
    }

    // ── /start ────────────────────────────────────────
    if (text.startsWith('/start')) {
      const firstName = msg.from?.first_name || '';
      const greeting  = firstName ? `Привет, ${firstName}!` : 'Привет!';
      await sendMessage(BOT_TOKEN, chatId,
        `${greeting}\n\nЭто каталог гидроцилиндров *Промгидравлика*.\n\nЗдесь можно:\n📦 Найти цилиндр по диаметру\n🧮 Рассчитать по усилию и давлению\n📋 Отправить заявку менеджеру`,
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

    // ── /help ─────────────────────────────────────────
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

    // ── /catalog, /calc ───────────────────────────────
    if (text.startsWith('/catalog') || text.startsWith('/calc')) {
      await sendMessage(BOT_TOKEN, chatId, `Открываю каталог 👇`, {
        reply_markup: {
          inline_keyboard: [[
            { text: '📦 Открыть каталог', web_app: { url: APP_URL } }
          ]]
        }
      });
      return res.status(200).json({ ok: true });
    }

    // ── Данные из Mini App (заявка) ───────────────────
    if (webData) {
      let payload;
      try { payload = JSON.parse(webData); }
      catch (e) { return res.status(200).json({ ok: true }); }

      if (MANAGER_CHAT) {
        const orderText = formatOrder(payload, msg);
        await sendMessage(BOT_TOKEN, MANAGER_CHAT, orderText);
      }

      await sendMessage(BOT_TOKEN, chatId,
        `✅ *Заявка принята!*\n\n` +
        `Наш инженер свяжется с вами в рабочее время: Пн–Пт 8:30–17:00.\n\n` +
        `Если отправили в выходной — ответим в понедельник.`
      );
      return res.status(200).json({ ok: true });
    }

    // ── Любое другое сообщение ────────────────────────
    await sendMessage(BOT_TOKEN, chatId, `Используйте кнопку ниже для работы с каталогом 👇`, {
      reply_markup: {
        inline_keyboard: [[
          { text: '📦 Открыть каталог', web_app: { url: APP_URL } }
        ]]
      }
    });
    return res.status(200).json({ ok: true });

  } catch (err) {
    log.error('webhook/catalog', 'Необработанная ошибка', err);
    return res.status(200).json({ ok: true });
  }
}

// =====================================================
// РЕЖИМ 2: Бот мастера — показывает его каталог услуг
// =====================================================
async function handleMasterBot(req, res, master_id) {
  try {
    const { data: master, error } = await supabase
      .from('masters')
      .select('id, slug, brand_name, description, bot_token, is_active')
      .eq('id', master_id)
      .eq('is_active', true)
      .single();

    if (error || !master) {
      log.error('webhook/master', 'Мастер не найден', { master_id, error });
      return res.status(200).json({ ok: true });
    }

    const token  = master.bot_token;
    const appUrl = `${APP_URL}/m/${master.slug}`;
    const update = req.body;
    const msg    = update?.message;

    if (!msg) return res.status(200).json({ ok: true });

    const chatId = msg.chat?.id;
    const text   = msg.text || '';

    if (!chatId) return res.status(200).json({ ok: true });

    if (text.startsWith('/start')) {
      const firstName = msg.from?.first_name || '';
      const greeting  = firstName ? `Привет, ${firstName}! 👋` : 'Привет! 👋';

      await sendMessage(token, chatId,
        `${greeting}\n\n` +
        `Вы в *${master.brand_name}*.\n\n` +
        (master.description ? `${master.description}\n\n` : '') +
        `Нажмите кнопку чтобы посмотреть услуги и записаться 👇`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: '📅 Записаться', web_app: { url: appUrl } }
            ]]
          }
        }
      );
      return res.status(200).json({ ok: true });
    }

    await sendMessage(token, chatId, `Чтобы посмотреть услуги — нажмите кнопку 👇`, {
      reply_markup: {
        inline_keyboard: [[
          { text: '📅 Записаться', web_app: { url: appUrl } }
        ]]
      }
    });
    return res.status(200).json({ ok: true });

  } catch (err) {
    log.error('webhook/master', 'Необработанная ошибка', err);
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
  if (!resp.ok) log.error('telegram/api', 'Ошибка sendMessage', await resp.text());
  return resp;
}
