// =====================================================
// api/set-webhook.js — одноразовый endpoint для регистрации webhook
//
// Открыть в браузере ОДИН РАЗ после деплоя:
// https://my-demo-project-nt8u.vercel.app/api/set-webhook?secret=ТВОЙ_СЕКРЕТ
//
// После успеха можно удалить этот файл или оставить — он безвреден.
// =====================================================

export default async function handler(req, res) {
  const BOT_TOKEN   = process.env.BOT_TOKEN;
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // защита от случайных вызовов

  // Простая защита — нужно передать ?secret=... в URL
  if (req.query.secret !== WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!BOT_TOKEN) {
    return res.status(500).json({ error: 'BOT_TOKEN not set' });
  }

  // URL нашего webhook (берётся из переменной окружения APP_URL)
  const appUrl = process.env.APP_URL || 'https://my-demo-project-nt8u.vercel.app';
  const webhookUrl = `${appUrl}/api/webhook`;

  const resp = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl }),
    }
  );

  const data = await resp.json();
  return res.status(200).json(data);
}
