const BOT_NAME = 'ratebot';
const VIP_STARS = 50;
const STAR_USD = 0.015;
const CACHE_TTL_MS = 5 * 60 * 1000;

const FALLBACK_RATES = {
  usdUzs: 12850,
  tonUsd: 5.2,
  btcUsd: 95000,
  starUsd: STAR_USD,
  source: 'zaxira',
  updatedAt: 0,
};

let cachedRates = { ...FALLBACK_RATES };

// Tracks VIP alert subscribers in memory + store
const vipAlerts = new Map();

async function fetchJsonWithTimeout(url, timeoutMs = 4500) {
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

async function getRates() {
  const now = Date.now();
  if (cachedRates.updatedAt && now - cachedRates.updatedAt < CACHE_TTL_MS) {
    return cachedRates;
  }

  let usdUzs = cachedRates.usdUzs;
  let tonUsd = cachedRates.tonUsd;
  let btcUsd = cachedRates.btcUsd;
  let liveCount = 0;

  try {
    const fx = await fetchJsonWithTimeout('https://open.er-api.com/v6/latest/USD');
    if (fx?.rates?.UZS) {
      usdUzs = Math.round(Number(fx.rates.UZS));
      liveCount += 1;
    }
  } catch {
    // fallback
  }

  try {
    const cg = await fetchJsonWithTimeout(
      'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,bitcoin&vs_currencies=usd'
    );
    if (cg?.['the-open-network']?.usd) {
      tonUsd = Number(cg['the-open-network'].usd);
      liveCount += 1;
    }
    if (cg?.bitcoin?.usd) {
      btcUsd = Number(cg.bitcoin.usd);
      liveCount += 1;
    }
  } catch {
    // fallback
  }

  cachedRates = {
    usdUzs,
    tonUsd,
    btcUsd,
    starUsd: STAR_USD,
    source: liveCount > 0 ? 'jonli' : 'zaxira',
    updatedAt: now,
  };
  return cachedRates;
}

function fmtNum(n, decimals = 0) {
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function parseConversionQuery(text) {
  const q = String(text || '').trim().toLowerCase();
  if (!q) return null;

  const m = q.match(/^(\d+(?:[.,]\d+)?)\s*(usd|\$|uzs|som|so'm|ton|btc|star|stars|xtr|⭐)?$/i);
  if (!m) return null;
  const amount = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const rawUnit = (m[2] || 'usd').toLowerCase();
  let unit = 'USD';
  if (rawUnit === 'uzs' || rawUnit === 'som' || rawUnit === "so'm") unit = 'UZS';
  else if (rawUnit === 'ton') unit = 'TON';
  else if (rawUnit === 'btc') unit = 'BTC';
  else if (['star', 'stars', 'xtr', '⭐'].includes(rawUnit)) unit = 'STARS';

  return { amount, unit };
}

function convertAmount(amount, unit, r) {
  let usd = amount;
  if (unit === 'UZS') usd = amount / r.usdUzs;
  else if (unit === 'TON') usd = amount * r.tonUsd;
  else if (unit === 'BTC') usd = amount * r.btcUsd;
  else if (unit === 'STARS') usd = amount * r.starUsd;

  return {
    usd,
    uzs: usd * r.usdUzs,
    ton: usd / r.tonUsd,
    btc: usd / r.btcUsd,
    stars: usd / r.starUsd,
  };
}

function formatRatesCard(r) {
  const starUzs = Math.round(r.starUsd * r.usdUzs);
  return [
    `💱 Jonli Valyuta & Kripto Kurslari (${r.source})`,
    '',
    `💵 1 USD = ${fmtNum(r.usdUzs)} so'm`,
    `💎 1 TON = $${fmtNum(r.tonUsd, 2)} (${fmtNum(r.tonUsd * r.usdUzs)} so'm)`,
    `₿ 1 BTC = $${fmtNum(r.btcUsd)}`,
    `⭐ 1 Star ≈ $${r.starUsd} (${fmtNum(starUzs)} so'm)`,
    '',
    'Misol: 100$ yoki 10 ton deb yozing!',
  ].join('\n');
}

function formatConversionCard(amount, unit, r) {
  const c = convertAmount(amount, unit, r);
  return [
    `💱 Konvertatsiya: ${fmtNum(amount, unit === 'BTC' ? 4 : 2)} ${unit}`,
    '',
    `💵 USD: $${fmtNum(c.usd, 2)}`,
    `🇺🇿 UZS: ${fmtNum(Math.round(c.uzs))} so'm`,
    `💎 TON: ${fmtNum(c.ton, 2)} TON`,
    `₿ BTC: ${c.btc.toFixed(6)} BTC`,
    `⭐ Stars: ${fmtNum(Math.round(c.stars))} ⭐`,
  ].join('\n');
}

function mainKeyboard(isAdmin) {
  const rows = [
    [
      { text: '🔄 Kurslarni yangilash', callback_data: 'rt:refresh' },
      { text: '🔔 VIP Signal (50 ⭐)', callback_data: 'rt:vip' },
    ],
    [
      { text: '💵 100$', callback_data: 'rt:q:100:USD' },
      { text: '💎 10 TON', callback_data: 'rt:q:10:TON' },
      { text: '⭐ 100 Stars', callback_data: 'rt:q:100:STARS' },
    ],
  ];
  if (isAdmin) {
    rows.push([{ text: '👑 Admin statistika', callback_data: 'rt:admin' }]);
  }
  return { inline_keyboard: rows };
}

function formatAdminStats(store) {
  const stats = store.getAdminStats(BOT_NAME);
  const b = stats.bots[BOT_NAME] || {};
  return [
    '👑 @Ratebot — Admin Panel (@hold)',
    '',
    `👥 Foydalanuvchilar: ${stats.totalUsers}`,
    `📨 So'rovlar: ${b.totalRequests || 0}`,
    `🔔 VIP obunachilar: ${vipAlerts.size}`,
    `💎 Pullik xaridlar: ${b.paidUses || 0}`,
    `💰 Gross daromad: ${b.revenueStars || 0} ⭐`,
  ].join('\n');
}

export async function register({ api, store, botInfo, logger }) {
  const commands = [
    { command: 'start', description: 'Kurslar va konvertor' },
    { command: 'rate', description: 'Jonli valyuta va kripto kurslari' },
    { command: 'vip', description: 'VIP narx signallari (50 ⭐)' },
    { command: 'admin', description: 'Admin statistika (@hold)' },
  ];

  async function safeAnswerCallback(id, opts = {}) {
    try {
      await api.answerCallbackQuery(id, opts);
    } catch (err) {
      logger.warn(`answerCallbackQuery failed: ${err.message}`);
    }
  }

  async function activateVip(chatId, user, isPaid) {
    const r = await getRates();
    vipAlerts.set(user.id, {
      userId: user.id,
      username: user.username || user.first_name || `ID:${user.id}`,
      usdUzs: r.usdUzs,
      tonUsd: r.tonUsd,
      activatedAt: new Date().toISOString(),
    });
    if (!isPaid && store.isAdmin(user)) {
      store.recordRequest(BOT_NAME, user);
    }
    await api.sendMessage(
      chatId,
      [
        '🔔 VIP Narx Signallari faollashtirildi!',
        '',
        `💵 Joriy USD: ${fmtNum(r.usdUzs)} so'm`,
        `💎 Joriy TON: $${fmtNum(r.tonUsd, 2)}`,
        `₿ Joriy BTC: $${fmtNum(r.btcUsd)}`,
        '',
        'Keskin o\'zgarishlarda sizga birinchi bo\'lib xabar beramiz!',
      ].join('\n'),
      { reply_markup: mainKeyboard(store.isAdmin(user)) }
    );
  }

  async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const user = msg.from;
    if (!user) return;
    store.touchUser(BOT_NAME, user);

    if (msg.successful_payment) {
      const sp = msg.successful_payment;
      const stars = Number(sp.total_amount || VIP_STARS);
      store.recordPaidUse(BOT_NAME, user, stars, {
        payload: sp.invoice_payload,
        chargeId: sp.telegram_payment_charge_id,
      });
      await activateVip(chatId, user, true);
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

    if (cmd === '/start' || cmd === '/rate') {
      store.recordRequest(BOT_NAME, user);
      const r = await getRates();
      if (argText) {
        const parsed = parseConversionQuery(argText);
        if (parsed) {
          await api.sendMessage(chatId, formatConversionCard(parsed.amount, parsed.unit, r), {
            reply_markup: mainKeyboard(store.isAdmin(user)),
          });
          return;
        }
      }
      await api.sendMessage(chatId, formatRatesCard(r), {
        reply_markup: mainKeyboard(store.isAdmin(user)),
      });
      return;
    }

    if (cmd === '/vip') {
      if (store.isAdmin(user)) {
        await activateVip(chatId, user, false);
        return;
      }
      await api.sendInvoice({
        chat_id: chatId,
        title: 'Ratebot VIP Signal',
        description: 'USD, TON va BTC bo\'yicha VIP narx signallari',
        payload: `rt_vip:${user.id}`,
        prices: [{ label: 'VIP Signal (50 ⭐)', amount: VIP_STARS }],
      });
      return;
    }

    const parsed = parseConversionQuery(text);
    if (parsed) {
      store.recordRequest(BOT_NAME, user);
      const r = await getRates();
      await api.sendMessage(chatId, formatConversionCard(parsed.amount, parsed.unit, r), {
        reply_markup: mainKeyboard(store.isAdmin(user)),
      });
      return;
    }

    if (msg.chat.type === 'private') {
      const r = await getRates();
      await api.sendMessage(chatId, formatRatesCard(r), {
        reply_markup: mainKeyboard(store.isAdmin(user)),
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

    if (action === 'refresh') {
      cachedRates.updatedAt = 0;
      const r = await getRates();
      await safeAnswerCallback(query.id, { text: '🔄 Yangilandi!' });
      if (chatId) {
        await api.sendMessage(chatId, formatRatesCard(r), {
          reply_markup: mainKeyboard(store.isAdmin(user)),
        });
      }
      return;
    }

    if (action === 'q') {
      const amount = Number(parts[2]);
      const unit = parts[3] || 'USD';
      const r = await getRates();
      await safeAnswerCallback(query.id);
      if (chatId && Number.isFinite(amount)) {
        await api.sendMessage(chatId, formatConversionCard(amount, unit, r), {
          reply_markup: mainKeyboard(store.isAdmin(user)),
        });
      }
      return;
    }

    if (action === 'vip') {
      await safeAnswerCallback(query.id);
      if (!chatId) return;
      if (store.isAdmin(user)) {
        await activateVip(chatId, user, false);
        return;
      }
      await api.sendInvoice({
        chat_id: chatId,
        title: 'Ratebot VIP Signal',
        description: 'USD, TON va BTC bo\'yicha VIP narx signallari',
        payload: `rt_vip:${user.id}`,
        prices: [{ label: 'VIP Signal (50 ⭐)', amount: VIP_STARS }],
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

    const q = (iq.query || '').trim();
    const r = await getRates();
    const results = [];

    const parsed = parseConversionQuery(q);
    if (parsed) {
      const text = formatConversionCard(parsed.amount, parsed.unit, r);
      results.push({
        type: 'article',
        id: `conv_${parsed.amount}_${parsed.unit}`,
        title: `💱 ${parsed.amount} ${parsed.unit} konvertatsiyasi`,
        description: `USD / UZS / TON / BTC / Stars`,
        input_message_content: { message_text: text },
      });
    }

    results.push({
      type: 'article',
      id: 'rates_live',
      title: `💱 Jonli kurslar: 1$ = ${fmtNum(r.usdUzs)} so'm | TON = $${fmtNum(r.tonUsd, 2)}`,
      description: `@${botInfo.username || 'Ratebot'} — USD, TON, BTC, Stars`,
      input_message_content: { message_text: formatRatesCard(r) },
    });

    await api.answerInlineQuery(iq.id, results, { cache_time: 10 });
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
