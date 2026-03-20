// server.js — запускается на VPS (Beget)
// HTTPS на порту 8443 с самоподписанным сертификатом
// Telegram webhook: POST https://193.168.48.98:8443/webhook

import 'dotenv/config';
import express from 'express';
import https from 'https';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import webhookHandler        from './api/webhook.js';
import mSlugHandler          from './api/m/[slug].js';
import masterSlugHandler     from './api/master/[slug].js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

// Проверка работы
app.get('/', (req, res) => res.json({ ok: true, status: 'Bot is running' }));

// Telegram шлёт сюда сообщения
app.post('/webhook', webhookHandler);

// Страница мастера /m/maria-beauty
app.get('/m/:slug', (req, res) => {
  req.query.slug = req.params.slug;
  return mSlugHandler(req, res);
});

// API данных мастера
app.get('/api/master/:slug', (req, res) => {
  req.query.slug = req.params.slug;
  return masterSlugHandler(req, res);
});

// Запуск HTTPS-сервера
const PORT = 8443;
const keyPath  = join(__dirname, 'ssl/server.key');
const certPath = join(__dirname, 'ssl/server.crt');

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.error('❌ SSL сертификаты не найдены.');
  console.error('   Создай папку ssl/ и запусти:');
  console.error('   openssl req -newkey rsa:2048 -sha256 -nodes -keyout ssl/server.key -x509 -days 3650 -out ssl/server.crt -subj "/CN=193.168.48.98"');
  process.exit(1);
}

https.createServer(
  { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
  app
).listen(PORT, () => {
  console.log(`✅ Бот запущен: https://193.168.48.98:${PORT}`);
  console.log(`   Webhook URL: https://193.168.48.98:${PORT}/webhook`);
});
