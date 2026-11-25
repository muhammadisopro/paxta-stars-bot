const BOT_NAME = 'weatherbot';
const SUB_STARS = 50;

const CITY_FALLBACKS = {
  toshkent: { name: 'Toshkent', country: 'O\'zbekiston', lat: 41.2995, lon: 69.2401, temp: 16, min: 7, max: 19, wind: 11, hum: 48, code: 1 },
  samarqand: { name: 'Samarqand', country: 'O\'zbekiston', lat: 39.6542, lon: 66.9597, temp: 15, min: 6, max: 18, wind: 9, hum: 45, code: 0 },
  buxoro: { name: 'Buxoro', country: 'O\'zbekiston', lat: 39.7681, lon: 64.4556, temp: 17, min: 7, max: 21, wind: 14, hum: 38, code: 0 },
  andijon: { name: 'Andijon', country: 'O\'zbekiston', lat: 40.7821, lon: 72.3442, temp: 14, min: 6, max: 17, wind: 8, hum: 55, code: 2 },
  namangan: { name: 'Namangan', country: 'O\'zbekiston', lat: 40.9983, lon: 71.6726, temp: 14, min: 5, max: 17, wind: 9, hum: 52, code: 1 },
  fargona: { name: 'Farg\'ona', country: 'O\'zbekiston', lat: 40.3842, lon: 71.7843, temp: 15, min: 6, max: 18, wind: 10, hum: 50, code: 1 },
  xiva: { name: 'Xiva', country: 'O\'zbekiston', lat: 41.3775, lon: 60.3619, temp: 15, min: 5, max: 19, wind: 15, hum: 40, code: 0 },
  nukus: { name: 'Nukus', country: 'O\'zbekiston', lat: 42.4619, lon: 59.6166, temp: 12, min: 3, max: 16, wind: 17, hum: 42, code: 2 },
};

const subscriptions = new Map();

function describeWeatherCode(code) {
  const c = Number(code);
  if (c === 0) return '☀️ Ochiq osmon';
  if (c <= 2) return '🌤 Biroz bulutli';
  if (c === 3) return '☁️ Bulutli';
  if (c >= 45 && c <= 48) return '🌫 Tuman';
  if (c >= 51 && c <= 67) return '🌧 Yomg\'ir';
  if (c >= 71 && c <= 77) return '❄️ Qor';
  if (c >= 80 && c <= 82) return '🌦 Jala';
  if (c >= 95) return '⛈ Momaqaldiroq';
  return '🌤 Mo\'tadil';
}

async function fetchJson(url, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getCityWeather(cityQuery) {
  const raw = String(cityQuery || 'Toshkent').trim();
  const key = raw.toLowerCase().replace(/['`’]/g, '');
  const fb = CITY_FALLBACKS[key] || null;

  try {
    const geo = await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(raw)}&count=1&language=en`
    );
    const place = geo?.results?.[0];
    const lat = place?.latitude ?? fb?.lat;
    const lon = place?.longitude ?? fb?.lon;
    const cityName = place?.name || fb?.name || raw;
    const country = place?.country || fb?.country || '';

    if (lat != null && lon != null) {
      const fc = await fetchJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto`
      );
      const cur = fc?.current;
      if (cur) {
        return {
          name: cityName,
          country,
          temp: Math.round(cur.temperature_2m),
          feelsLike: Math.round(cur.apparent_temperature ?? cur.temperature_2m),
          hum: Math.round(cur.relative_humidity_2m ?? 50),
          wind: Math.round(cur.wind_speed_10m ?? 10),
          code: cur.weather_code ?? 0,
          min: Math.round(fc.daily?.temperature_2m_min?.[0] ?? cur.temperature_2m - 4),
          max: Math.round(fc.daily?.temperature_2m_max?.[0] ?? cur.temperature_2m + 4),
          source: 'jonli',
        };
      }
    }
  } catch {
    // fall back
  }

  const def = fb || { ...CITY_FALLBACKS.toshkent, name: raw };
  return {
    name: def.name,
    country: def.country || '',
    temp: def.temp,
    feelsLike: def.temp - 1,
    hum: def.hum,
    wind: def.wind,
    code: def.code,
    min: def.min,
    max: def.max,
    source: 'zaxira',
  };
}

function formatWeatherCard(w) {
  const loc = w.country ? `${w.name}, ${w.country}` : w.name;
  return [
    `🌍 ${loc} — Ob-havo (${w.source})`,
    '',
    `${describeWeatherCode(w.code)}`,
    `🌡 Harorat: ${w.temp}°C (His qilinishi: ${w.feelsLike}°C)`,
    `📉/📈 Bugun: ${w.min}°C ... ${w.max}°C`,
    `💧 Namlik: ${w.hum}% | 💨 Shamol: ${w.wind} km/soat`,
  ].join('\n');
}

function mainKeyboard(isAdmin, city = 'Toshkent') {
  const rows = [
    [
      { text: '🏙 Toshkent', callback_data: 'wt:city:Toshkent' },
      { text: '🕌 Samarqand', callback_data: 'wt:city:Samarqand' },
      { text: '🏛 Buxoro', callback_data: 'wt:city:Buxoro' },
    ],
    [
      { text: `☀️ Kunlik obuna (50 ⭐)`, callback_data: `wt:sub:${city}` },
    ],
  ];
  if (isAdmin) {
    rows.push([{ text: '👑 Admin statistika', callback_data: 'wt:admin' }]);
  }
  return { inline_keyboard: rows };
}

function formatAdminStats(store) {
  const stats = store.getAdminStats(BOT_NAME);
  const b = stats.bots[BOT_NAME] || {};
  return [
    '👑 @Weather_bot — Admin Panel (@hold)',
    '',
    `👥 Foydalanuvchilar: ${stats.totalUsers}`,
    `📨 So'rovlar: ${b.totalRequests || 0}`,
    `☀️ Kunlik obunachilar: ${subscriptions.size}`,
    `💎 Pullik obunalar: ${b.paidUses || 0}`,
    `💰 Gross daromad: ${b.revenueStars || 0} ⭐`,
  ].join('\n');
}

export async function register({ api, store, botInfo, logger }) {
  const commands = [
    { command: 'start', description: 'Ob-havo ma\'lumoti' },
    { command: 'weather', description: 'Shahar ob-havosini ko\'rish' },
    { command: 'subscribe', description: 'Kunlik ob-havo obunasi (50 ⭐)' },
    { command: 'admin', description: 'Admin statistika (@hold)' },
  ];

  async function safeAnswerCallback(id, opts = {}) {
    try {
      await api.answerCallbackQuery(id, opts);
    } catch (err) {
      logger.warn(`answerCallbackQuery failed: ${err.message}`);
    }
  }

  async function activateSubscription(chatId, user, city, isPaid) {
    const w = await getCityWeather(city || 'Toshkent');
    subscriptions.set(user.id, {
      userId: user.id,
      city: w.name,
      activatedAt: new Date().toISOString(),
    });
    if (!isPaid && store.isAdmin(user)) {
      store.recordRequest(BOT_NAME, user);
    }
    await api.sendMessage(
      chatId,
      [
        `✅ ${w.name} shahri uchun kunlik ob-havo obunasi yoqildi!`,
        '',
        formatWeatherCard(w),
      ].join('\n'),
      { reply_markup: mainKeyboard(store.isAdmin(user), w.name) }
    );
  }

  async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const user = msg.from;
    if (!user) return;
    store.touchUser(BOT_NAME, user);

    if (msg.successful_payment) {
      const sp = msg.successful_payment;
      const payload = String(sp.invoice_payload || '');
      const stars = Number(sp.total_amount || SUB_STARS);
      store.recordPaidUse(BOT_NAME, user, stars, {
        payload,
        chargeId: sp.telegram_payment_charge_id,
      });
      const city = payload.split(':')[2] || 'Toshkent';
      await activateSubscription(chatId, user, city, true);
      return;
    }

    const text = (msg.text || '').trim();
    if (!text) return;
    const [rawCmd, ...rest] = text.split(/\s+/);
    const cmd = rawCmd.split('@')[0].toLowerCase();
    const argText = rest.join(' ');

    if (cmd === '/admin') {
      if (!store.isAdmin(user)) {
        await api.sendMessage(chatId, '⛔ Bu buyruq faqat admin (@hold) uchun.');
        return;
      }
      await api.sendMessage(chatId, formatAdminStats(store));
      return;
    }

    if (cmd === '/subscribe') {
      const city = argText || 'Toshkent';
      if (store.isAdmin(user)) {
        await activateSubscription(chatId, user, city, false);
        return;
      }
      await api.sendInvoice({
        chat_id: chatId,
        title: `Kunlik ob-havo (${city})`,
        description: `${city} bo'yicha har kuni shaxsiy ob-havo xabarnomasi`,
        payload: `wt_sub:${user.id}:${city.slice(0, 32)}`,
        prices: [{ label: 'Kunlik obuna (50 ⭐)', amount: SUB_STARS }],
      });
      return;
    }

    if (cmd === '/start' || cmd === '/weather') {
      store.recordRequest(BOT_NAME, user);
      const city = argText || 'Toshkent';
      const w = await getCityWeather(city);
      await api.sendMessage(
        chatId,
        `${formatWeatherCard(w)}\n\nIstalgan shahar nomini yozing (masalan: Samarqand) yoki @${botInfo.username || 'Weather_bot'} Toshkent`,
        { reply_markup: mainKeyboard(store.isAdmin(user), w.name) }
      );
      return;
    }

    if (msg.chat.type === 'private' && !text.startsWith('/')) {
      store.recordRequest(BOT_NAME, user);
      const w = await getCityWeather(text);
      await api.sendMessage(chatId, formatWeatherCard(w), {
        reply_markup: mainKeyboard(store.isAdmin(user), w.name),
      });
    }
  }

  async function handleCallback(query) {
    const user = query.from;
    if (!user) return;
    store.touchUser(BOT_NAME, user);

    const parts = String(query.data || '').split(':');
    const action = parts[1];
    const chatId = query.message?.chat?.id;

    if (action === 'admin') {
      if (!store.isAdmin(user)) {
        await safeAnswerCallback(query.id, { text: '⛔ Faqat admin uchun.', show_alert: true });
        return;
      }
      await safeAnswerCallback(query.id);
      if (chatId) await api.sendMessage(chatId, formatAdminStats(store));
      return;
    }

    if (action === 'city') {
      const city = parts[2] || 'Toshkent';
      store.recordRequest(BOT_NAME, user);
      const w = await getCityWeather(city);
      await safeAnswerCallback(query.id);
      if (chatId) {
        await api.sendMessage(chatId, formatWeatherCard(w), {
          reply_markup: mainKeyboard(store.isAdmin(user), w.name),
        });
      }
      return;
    }

    if (action === 'sub') {
      const city = parts[2] || 'Toshkent';
      await safeAnswerCallback(query.id);
      if (!chatId) return;
      if (store.isAdmin(user)) {
        await activateSubscription(chatId, user, city, false);
        return;
      }
      await api.sendInvoice({
        chat_id: chatId,
        title: `Kunlik ob-havo (${city})`,
        description: `${city} bo'yicha har kuni shaxsiy ob-havo xabarnomasi`,
        payload: `wt_sub:${user.id}:${city.slice(0, 32)}`,
        prices: [{ label: 'Kunlik obuna (50 ⭐)', amount: SUB_STARS }],
      });
      return;
    }

    await safeAnswerCallback(query.id);
  }

  async function handleInlineQuery(iq) {
    const user = iq.from;
    if (!user) return;
    store.touchUser(BOT_NAME, user);
    store.recordRequest(BOT_NAME, user);

    const city = (iq.query || '').trim() || 'Toshkent';
    const w = await getCityWeather(city);
    await api.answerInlineQuery(
      iq.id,
      [
        {
          type: 'article',
          id: `wt_${w.name}`,
          title: `${w.name}: ${w.temp}°C — ${describeWeatherCode(w.code)}`,
          description: `Namlik ${w.hum}% • Shamol ${w.wind} km/soat`,
          input_message_content: { message_text: formatWeatherCard(w) },
        },
      ],
      { cache_time: 60 }
    );
  }

  async function handlePreCheckout(pcq) {
    try {
      await api.answerPreCheckoutQuery(pcq.id, true);
    } catch (err) {
      logger.error(`answerPreCheckoutQuery error: ${err.message}`);
    }
  }

  async function handleUpdate(update) {
    if (update.pre_checkout_query) return handlePreCheckout(update.pre_checkout_query);
    if (update.inline_query) return handleInlineQuery(update.inline_query);
    if (update.callback_query) return handleCallback(update.callback_query);
    if (update.message) return handleMessage(update.message);
  }

  return { handleUpdate, commands };
}
