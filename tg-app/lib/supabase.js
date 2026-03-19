// lib/supabase.js — единственное подключение к базе данных
// Импортируется во всех API-endpoints
//
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY берутся из:
//   - локально: tg-app/.env
//   - на Vercel: Settings → Environment Variables

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Отсутствуют переменные SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseKey);
