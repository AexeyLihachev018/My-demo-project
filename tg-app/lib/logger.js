// lib/logger.js — логирование ошибок и событий
//
// Ошибки пишутся в два места:
//   1. Консоль (видно в PM2: pm2 logs bot)
//   2. Файл logs/errors.log (только ERROR-уровень)
//
// Использование:
//   import { log } from '../lib/logger.js';
//   log.info('webhook', 'Получен /start от user 123');
//   log.warn('webhook', 'Неизвестная команда', { text: '/foo' });
//   log.error('webhook', 'Ошибка отправки в Telegram', err);

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname }       from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_FILE  = path.join(__dirname, '../logs/errors.log');
const LOG_DIR   = path.dirname(LOG_FILE);

// Создаём папку logs/ если её нет
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// ─────────────────────────────────────────────────────
// Форматирование одной строки лога
// ─────────────────────────────────────────────────────
function format(level, context, message, extra) {
  const ts = new Date().toLocaleString('ru-RU', {
    timeZone:   'Europe/Moscow',
    day:    '2-digit',
    month:  '2-digit',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  let line = `[${ts}] [${level}] [${context}] ${message}`;

  if (extra !== undefined) {
    if (extra instanceof Error) {
      line += `\n  ${extra.message}`;
      if (extra.stack) line += `\n  ${extra.stack.split('\n').slice(1, 4).join('\n  ')}`;
    } else if (typeof extra === 'object') {
      try { line += `\n  ${JSON.stringify(extra)}`; } catch {}
    } else {
      line += `\n  ${extra}`;
    }
  }

  return line;
}

// ─────────────────────────────────────────────────────
// Запись ошибки в файл
// ─────────────────────────────────────────────────────
function writeToFile(line) {
  try {
    fs.appendFileSync(LOG_FILE, line + '\n' + '─'.repeat(60) + '\n');
  } catch (e) {
    console.error('[logger] Не удалось записать в файл:', e.message);
  }
}

// ─────────────────────────────────────────────────────
// Публичный API логгера
// ─────────────────────────────────────────────────────
export const log = {
  // Информация о событиях — только в консоль
  info(context, message, extra) {
    console.log(format('INFO ', context, message, extra));
  },

  // Предупреждения — только в консоль
  warn(context, message, extra) {
    console.warn(format('WARN ', context, message, extra));
  },

  // Ошибки — в консоль И в файл logs/errors.log
  error(context, message, extra) {
    const line = format('ERROR', context, message, extra);
    console.error(line);
    writeToFile(line);
  },
};
