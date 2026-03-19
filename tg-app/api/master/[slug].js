// api/master/[slug].js — публичные данные мастера
//
// GET /api/master/maria-beauty
// → { brand_name, description, avatar_file_id, theme_id, timezone, services[] }
//
// Вызывается: когда Mini App клиента загружается и показывает профиль мастера.
// Авторизация не нужна — это публичные данные.

import { supabase } from '../../lib/supabase.js';

export default async function handler(req, res) {
  // Только GET-запросы
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { slug } = req.query;

  // Защита от пустого slug
  if (!slug || typeof slug !== 'string') {
    return res.status(400).json({ error: 'Slug обязателен' });
  }

  // 1. Найти мастера по slug
  const { data: master, error: masterError } = await supabase
    .from('masters')
    .select('id, slug, brand_name, description, avatar_file_id, theme_id, timezone, is_active')
    .eq('slug', slug)
    .eq('is_active', true)
    .single();

  if (masterError || !master) {
    return res.status(404).json({ error: 'Мастер не найден' });
  }

  // 2. Получить активные услуги мастера (отсортированные по sort_order)
  const { data: services, error: servicesError } = await supabase
    .from('services')
    .select('id, title, description, duration_minutes, price, photo_url, photo_file_id, sort_order')
    .eq('master_id', master.id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (servicesError) {
    console.error('Ошибка загрузки услуг:', servicesError);
    return res.status(500).json({ error: 'Ошибка загрузки услуг' });
  }

  // 3. Вернуть данные
  // Примечание: bot_token, telegram_user_id и другие приватные поля НЕ возвращаем
  return res.status(200).json({
    slug: master.slug,
    brand_name: master.brand_name,
    description: master.description,
    avatar_file_id: master.avatar_file_id,
    theme_id: master.theme_id,
    timezone: master.timezone,
    services: services || [],
  });
}
