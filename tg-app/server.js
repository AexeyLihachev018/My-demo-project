// server.js — запускается на VPS (Beget)
// HTTPS на порту 8443 с самоподписанным сертификатом
// Telegram webhook: POST https://193.168.48.98:8443/webhook

import 'dotenv/config';
import express from 'express';
import https from 'https';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { log }              from './lib/logger.js';
import webhookHandler        from './api/webhook.js';
import mSlugHandler          from './api/m/[slug].js';
import masterSlugHandler     from './api/master/[slug].js';
import sendLeadHandler       from './api/send-lead.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

// Лендинг (главная страница сайта)
app.get('/', (_req, res) => res.sendFile(join(__dirname, '../index.html')));

// Заявка с сайта → Telegram
app.post('/api/send-lead', sendLeadHandler);

// Проверка работы
app.get('/health', (_req, res) => res.json({ ok: true, status: 'Bot is running' }));

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
  log.error('server', 'SSL сертификаты не найдены', {
    key: keyPath, cert: certPath,
    fix: 'openssl req -newkey rsa:2048 -sha256 -nodes -keyout ssl/server.key -x509 -days 3650 -out ssl/server.crt -subj "/CN=193.168.48.98"',
  });
  process.exit(1);
}

https.createServer(
  { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
  app
).listen(PORT, () => {
  log.info('server', `Бот запущен: https://193.168.48.98:${PORT}`);
  log.info('server', `Webhook URL: https://193.168.48.98:${PORT}/webhook`);
});
