// =====================================================
// api/webhook.js — Универсальный webhook для ботов МАСТЕРОВ
//
// Telegram шлёт сюда сообщения клиентов мастера.
// URL задаётся при онбординге: /api/webhook?master_id=uuid
//
// Логика:
//   1. Читаем master_id из URL
//   2. Загружаем мастера из базы → получаем его bot_token, slug, brand_name
//   3. Отвечаем от имени БОТА МАСТЕРА
// =====================================================

import { supabase } from '../lib/supabase.js';

const APP_URL = process.env.APP_URL || 'https://my-demo-project-nt8u.vercel.app';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // master_id передаётся в URL: /api/webhook?master_id=uuid
  const { master_id } = req.query;
  if (!master_id) {
    return res.status(200).json({ ok: true });
  }

  try {
    // 1. Загружаем мастера из базы данных
    const { data: master, error } = await supabase
      .from('masters')
      .select('id, slug, brand_name, description, bot_token, is_active')
      .eq('id', master_id)
      .eq('is_active', true)
      .single();

    if (error || !master) {
      console.error('Мастер не найден:', master_id);
      return res.status(200).json({ ok: true });
    }

    const token = master.bot_token; // TODO: расшифровать AES-256-GCM
    const appUrl = `${APP_URL}/m/${master.slug}`;

    // 2. Разбираем входящее сообщение от Telegram
    const update = req.body;
    const msg = update?.message;

    if (!msg) return res.status(200).json({ ok: true });

    const chatId = msg.chat?.id;
    const text = msg.text || '';

    if (!chatId) return res.status(200).json({ ok: true });

    // 3. Реагируем на команды

    // /start — приветствие + кнопка открыть каталог мастера
    if (text.startsWith('/start')) {
      const firstName = msg.from?.first_name || '';
      const greeting = firstName ? `Привет, ${firstName}! 👋` : 'Привет! 👋';

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

    // Любое другое сообщение — напомнить про кнопку
    await sendMessage(token, chatId,
      `Чтобы посмотреть услуги и записаться — нажмите кнопку 👇`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '📅 Записаться', web_app: { url: appUrl } }
          ]]
        }
      }
    );
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('webhook error:', err);
    return res.status(200).json({ ok: true });
  }
}

// ─────────────────────────────────────────────────────
// Отправка сообщения через Telegram Bot API
// ─────────────────────────────────────────────────────
async function sendMessage(token, chatId, text, extra = {}) {
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', ...extra }),
  });
  if (!resp.ok) console.error('Telegram sendMessage error:', await resp.text());
  return resp;
}
