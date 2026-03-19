// ================================================================
// api/platform-webhook.js — Webhook платформенного бота
//
// Это бот для РЕГИСТРАЦИИ МАСТЕРОВ. Не путать с ботами мастеров.
//
// Переменные окружения (Vercel → Settings → Environment Variables):
//   PLATFORM_BOT_TOKEN — токен платформенного бота (@BotFather)
//   APP_URL            — URL деплоя (https://my-demo-project-nt8u.vercel.app)
//
// Сценарий онбординга:
//   /start → спросить brand_name → спросить slug →
//   → спросить timezone → спросить bot_token →
//   → зарегистрировать → создать мастера в БД
// ================================================================

import { supabase } from '../lib/supabase.js';

const APP_URL = process.env.APP_URL || 'https://my-demo-project-nt8u.vercel.app';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const PLATFORM_TOKEN = process.env.PLATFORM_BOT_TOKEN;
  if (!PLATFORM_TOKEN) {
    console.error('PLATFORM_BOT_TOKEN не задан');
    return res.status(200).json({ ok: true });
  }

  try {
    const update   = req.body;
    const msg      = update?.message || update?.callback_query?.message;
    const callbackQuery = update?.callback_query;

    // Обрабатываем нажатия на inline-кнопки (выбор таймзоны)
    if (callbackQuery) {
      await handleCallback(PLATFORM_TOKEN, callbackQuery);
      return res.status(200).json({ ok: true });
    }

    if (!msg) return res.status(200).json({ ok: true });

    const chatId = msg.chat?.id;
    const text   = (msg.text || '').trim();

    if (!chatId) return res.status(200).json({ ok: true });

    // Команда /start — начать онбординг заново
    if (text.startsWith('/start')) {
      await startOnboarding(PLATFORM_TOKEN, chatId, msg.from);
      return res.status(200).json({ ok: true });
    }

    // Команда /cancel — сбросить сессию
    if (text.startsWith('/cancel')) {
      await supabase.from('platform_sessions').delete().eq('chat_id', chatId);
      await send(PLATFORM_TOKEN, chatId, 'Регистрация отменена. Напишите /start чтобы начать заново.');
      return res.status(200).json({ ok: true });
    }

    // Продолжение диалога — найти текущий шаг
    const { data: session } = await supabase
      .from('platform_sessions')
      .select('*')
      .eq('chat_id', chatId)
      .single();

    if (!session) {
      await send(PLATFORM_TOKEN, chatId,
        'Напишите /start чтобы зарегистрироваться как мастер.');
      return res.status(200).json({ ok: true });
    }

    await handleStep(PLATFORM_TOKEN, chatId, text, session);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('platform-webhook error:', err);
    return res.status(200).json({ ok: true });
  }
}

// ================================================================
// Начало онбординга — /start
// ================================================================
async function startOnboarding(token, chatId, from) {
  const name = from?.first_name || 'мастер';

  // Удаляем старую сессию если была
  await supabase.from('platform_sessions').delete().eq('chat_id', chatId);

  // Создаём новую сессию на шаге brand_name
  await supabase.from('platform_sessions').insert({
    chat_id: chatId,
    step: 'brand_name',
    data: {},
  });

  await send(token, chatId,
    `Привет, ${name}! 👋\n\n` +
    `Создадим ваше приложение для записи клиентов.\n\n` +
    `*Шаг 1 из 4* — Как называется ваш бизнес?\n\n` +
    `Введите название бренда — его увидят ваши клиенты.\n` +
    `_Пример: Студия красоты Мария_`
  );
}

// ================================================================
// Обработка текущего шага диалога
// ================================================================
async function handleStep(token, chatId, text, session) {
  switch (session.step) {

    // ── Шаг 1: получили название бренда ──────────────────────
    case 'brand_name': {
      if (text.length < 2 || text.length > 128) {
        await send(token, chatId, '⚠️ Название должно быть от 2 до 128 символов. Попробуйте ещё раз.');
        return;
      }

      // Сохраняем brand_name, переходим к slug
      await supabase.from('platform_sessions').update({
        step: 'slug',
        data: { brand_name: text },
        updated_at: new Date().toISOString(),
      }).eq('chat_id', chatId);

      // Предложить автоматический slug на основе имени
      const autoSlug = text
        .toLowerCase()
        .replace(/[^a-zа-яё0-9\s]/gi, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[а-яё]/g, c => RU_TO_EN[c] || c)
        .substring(0, 32)
        || 'my-studio';

      await send(token, chatId,
        `✅ Отлично! *${text}*\n\n` +
        `*Шаг 2 из 4* — Придумайте адрес вашего приложения.\n\n` +
        `Это будет ссылка для клиентов:\n` +
        `\`${APP_URL}/m/ваш-адрес\`\n\n` +
        `Только латиница, цифры и дефис. От 3 до 32 символов.\n` +
        `_Предлагаю: \`${autoSlug}\`_\n\n` +
        `Напишите свой вариант или отправьте \`${autoSlug}\``
      );
      break;
    }

    // ── Шаг 2: получили slug ──────────────────────────────────
    case 'slug': {
      const slug = text.toLowerCase().replace(/\s+/g, '-');

      // Валидация формата
      if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug)) {
        await send(token, chatId,
          '⚠️ Адрес должен содержать только латиницу, цифры и дефис.\n' +
          'Минимум 3 символа. Дефис не может быть первым или последним.\n\n' +
          '_Пример: maria-beauty_');
        return;
      }

      // Проверка уникальности в БД
      const { data: existing } = await supabase
        .from('masters')
        .select('id')
        .eq('slug', slug)
        .single();

      if (existing) {
        await send(token, chatId,
          `⚠️ Адрес \`${slug}\` уже занят. Попробуйте другой.\n\n` +
          `_Например: ${slug}-2 или ${slug}-studio_`
        );
        return;
      }

      // Сохраняем slug, переходим к timezone
      await supabase.from('platform_sessions').update({
        step: 'timezone',
        data: { ...session.data, slug },
        updated_at: new Date().toISOString(),
      }).eq('chat_id', chatId);

      await send(token, chatId,
        `✅ Адрес \`${slug}\` свободен!\n\n` +
        `*Шаг 3 из 4* — В каком городе вы работаете?\n\n` +
        `Это нужно чтобы расписание показывалось в вашем времени.`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🏙 Москва (UTC+3)',        callback_data: 'tz:Europe/Moscow' },
                { text: '🏔 Екатеринбург (UTC+5)',  callback_data: 'tz:Asia/Yekaterinburg' },
              ],
              [
                { text: '🌲 Новосибирск (UTC+7)',   callback_data: 'tz:Asia/Novosibirsk' },
                { text: '🌏 Иркутск (UTC+8)',       callback_data: 'tz:Asia/Irkutsk' },
              ],
              [
                { text: '🌅 Владивосток (UTC+10)',  callback_data: 'tz:Asia/Vladivostok' },
                { text: '✏️ Другой город',          callback_data: 'tz:ask' },
              ],
            ]
          }
        }
      );
      break;
    }

    // ── Шаг 3: ввод таймзоны вручную (если нажали "Другой") ──
    case 'timezone_manual': {
      // Проверяем что введённая таймзона валидна
      const tz = text.trim();
      try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
      } catch {
        await send(token, chatId,
          `⚠️ Таймзона \`${tz}\` не распознана.\n\n` +
          `Введите в формате: \`Europe/Moscow\`, \`Asia/Krasnoyarsk\`\n` +
          `Список: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones`
        );
        return;
      }
      await proceedToTokenStep(token, chatId, session, tz);
      break;
    }

    // ── Шаг 4: получили bot_token ─────────────────────────────
    case 'bot_token': {
      await processBotToken(token, chatId, text, session);
      break;
    }

    default:
      await send(token, chatId, 'Напишите /start чтобы начать заново.');
  }
}

// ================================================================
// Обработка нажатий кнопок (выбор таймзоны)
// ================================================================
async function handleCallback(token, callbackQuery) {
  const chatId = callbackQuery.message?.chat?.id;
  const data   = callbackQuery.data;

  if (!chatId || !data?.startsWith('tz:')) return;

  // Подтверждаем получение callback (убирает "часики" на кнопке)
  await answerCallback(token, callbackQuery.id);

  const { data: session } = await supabase
    .from('platform_sessions')
    .select('*')
    .eq('chat_id', chatId)
    .single();

  if (!session || session.step !== 'timezone') return;

  const tz = data.replace('tz:', '');

  if (tz === 'ask') {
    // Попросить ввести вручную
    await supabase.from('platform_sessions').update({
      step: 'timezone_manual',
      updated_at: new Date().toISOString(),
    }).eq('chat_id', chatId);

    await send(token, chatId,
      'Введите ваш часовой пояс в формате IANA:\n' +
      '_Пример: `Asia/Krasnoyarsk`, `Europe/Samara`_\n\n' +
      'Список: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones'
    );
    return;
  }

  await proceedToTokenStep(token, chatId, session, tz);
}

// ================================================================
// Переход к шагу ввода bot_token (после выбора timezone)
// ================================================================
async function proceedToTokenStep(token, chatId, session, timezone) {
  await supabase.from('platform_sessions').update({
    step: 'bot_token',
    data: { ...session.data, timezone },
    updated_at: new Date().toISOString(),
  }).eq('chat_id', chatId);

  await send(token, chatId,
    `✅ Часовой пояс: *${timezone}*\n\n` +
    `*Шаг 4 из 4* — Создайте бота для ваших клиентов:\n\n` +
    `1. Откройте @BotFather\n` +
    `2. Напишите /newbot\n` +
    `3. Придумайте имя (например: *Студия Мария*)\n` +
    `4. Придумайте username (например: *maria_beauty_bot*)\n` +
    `5. Скопируйте токен и пришлите сюда\n\n` +
    `_Токен выглядит так: \`1234567890:AAxxxxxxxxxxxxxxxx\`_`
  );
}

// ================================================================
// Обработка полученного bot_token — финальный шаг
// ================================================================
async function processBotToken(token, chatId, botToken, session) {
  // 1. Валидируем токен через Telegram API
  const meResp = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
  const me     = await meResp.json();

  if (!me.ok) {
    await send(token, chatId,
      `⚠️ Токен не принят. Проверьте что:\n` +
      `• Скопировали токен полностью\n` +
      `• Бот создан в @BotFather\n\n` +
      `Попробуйте ещё раз:`
    );
    return;
  }

  const botUsername = me.result?.username;

  await send(token, chatId, `⏳ Регистрирую бота @${botUsername}...`);

  // 2. Проверить что такой bot_username ещё не зарегистрирован
  const { data: existingMaster } = await supabase
    .from('masters')
    .select('id')
    .eq('bot_username', botUsername)
    .single();

  if (existingMaster) {
    await send(token, chatId,
      `⚠️ Бот @${botUsername} уже зарегистрирован на платформе.\n` +
      `Создайте нового бота в @BotFather и пришлите его токен.`
    );
    return;
  }

  // 3. Создать мастера в БД
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: master, error: insertError } = await supabase
    .from('masters')
    .insert({
      telegram_user_id:    chatId,
      slug:                session.data.slug,
      brand_name:          session.data.brand_name,
      timezone:            session.data.timezone,
      bot_token:           botToken,   // TODO: зашифровать AES-256-GCM (следующий шаг)
      bot_username:        botUsername,
      plan:                'trial',
      trial_ends_at:       trialEndsAt,
      is_active:           true,
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('Ошибка создания мастера:', insertError);
    await send(token, chatId, '❌ Ошибка при регистрации. Попробуйте /start снова.');
    return;
  }

  // 4. Зарегистрировать webhook бота мастера
  const webhookUrl = `${APP_URL}/api/webhook?master_id=${master.id}`;
  const whResp     = await fetch(
    `https://api.telegram.org/bot${botToken}/setWebhook`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url: webhookUrl }),
    }
  );
  const whResult = await whResp.json();

  if (!whResult.ok) {
    console.error('setWebhook failed:', whResult);
    // Не блокируем — можно повторить позже
  } else {
    // Отметить что webhook установлен
    await supabase.from('masters').update({ webhook_set: true }).eq('id', master.id);
  }

  // 5. Удалить сессию онбординга
  await supabase.from('platform_sessions').delete().eq('chat_id', chatId);

  // 6. Поздравить мастера
  const appUrl   = `${APP_URL}/m/${session.data.slug}`;
  const trialEnd = new Date(trialEndsAt).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  await send(token, chatId,
    `🎉 *Готово! Ваше приложение создано.*\n\n` +
    `🤖 Бот для клиентов: @${botUsername}\n` +
    `🌐 Ссылка на приложение: ${appUrl}\n\n` +
    `📅 Пробный период *Pro* до: ${trialEnd}\n\n` +
    `*Что делать дальше:*\n` +
    `1. Добавьте услуги через панель управления\n` +
    `2. Настройте расписание\n` +
    `3. Поделитесь ботом с клиентами\n\n` +
    `_Чтобы открыть панель управления — напишите /admin_`
  );
}

// ================================================================
// Telegram API helpers
// ================================================================
async function send(token, chatId, text, extra = {}) {
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      chat_id:    chatId,
      text,
      parse_mode: 'Markdown',
      ...extra,
    }),
  });
  if (!resp.ok) console.error('Telegram sendMessage error:', await resp.text());
  return resp;
}

async function answerCallback(token, callbackQueryId) {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ callback_query_id: callbackQueryId }),
  });
}

// ================================================================
// Транслитерация для авто-slug из русского названия
// ================================================================
const RU_TO_EN = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',
  й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',
  у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',
  ь:'',э:'e',ю:'yu',я:'ya',
};
