// api/send-lead.js — приём заявки с сайта и отправка в Telegram менеджеру
import { log } from '../lib/logger.js';

export default async function handler(req, res) {
  // CORS для случая, если сайт откроют с другого источника
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const BOT_TOKEN    = process.env.BOT_TOKEN;
  const MANAGER_CHAT = process.env.MANAGER_CHAT_ID;

  if (!BOT_TOKEN || !MANAGER_CHAT) {
    log.error('send-lead', 'BOT_TOKEN или MANAGER_CHAT_ID не заданы');
    return res.status(500).json({ ok: false });
  }

  const { name, phone, message, urgency, industry, source } = req.body || {};

  if (!phone) {
    return res.status(400).json({ ok: false, error: 'phone required' });
  }

  const lines = ['📥 <b>Новая заявка с сайта</b>'];
  if (name)     lines.push(`👤 <b>Имя:</b> ${name}`);
  lines.push(   `📞 <b>Телефон:</b> ${phone}`);
  if (industry) lines.push(`🏭 <b>Отрасль:</b> ${industry}`);
  if (message)  lines.push(`📝 <b>Задача:</b> ${message}`);
  if (urgency)  lines.push(`⏱ <b>Срочность:</b> ${urgency}`);
  if (source)   lines.push(`🔗 <b>Источник:</b> ${source}`);

  try {
    const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: MANAGER_CHAT,
        text: lines.join('\n'),
        parse_mode: 'HTML',
      }),
    });
    const data = await resp.json();
    if (!data.ok) {
      log.error('send-lead', 'Telegram API вернул ошибку', data);
      return res.status(500).json({ ok: false });
    }
    log.info('send-lead', 'Заявка отправлена менеджеру', { name, phone });
    return res.json({ ok: true });
  } catch (err) {
    log.error('send-lead', 'Ошибка fetch', { err: err.message });
    return res.status(500).json({ ok: false });
  }
}
