import sharp from 'sharp';

const BOT_NAME = 'pricebot';
const CHECK_PRICE_STARS = 50;
const FREE_DEMO_LIMIT = 1;
const MARKET_CACHE_TTL_MS = 60_000;

let marketCache = {
  fetchedAt: 0,
  floorByGiftId: new Map(),
  titleByGiftId: new Map(),
};

function fmtNum(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-US').replace(/,/g, ' ');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXml(str) {
  return String(str ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncateText(str, maxLen = 28) {
  const s = String(str ?? '').trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

function getInitials(name) {
  const parts = String(name || 'P').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'P';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

async function buildCircularAvatar(entity, webApi, size = 128) {
  const rawAvatar = entity?.avatar ?? entity?.photo ?? null;
  const avatarUrl =
    typeof rawAvatar === 'string'
      ? rawAvatar
      : rawAvatar?.url || rawAvatar?.thumb || null;

  if (avatarUrl) {
    try {
      const buf = await webApi.fetchBuffer(avatarUrl);
      const mask = Buffer.from(
        `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#ffffff"/></svg>`
      );
      return await sharp(buf)
        .resize(size, size, { fit: 'cover' })
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
    } catch {
      // Fallback to initials avatar
    }
  }

  const initials = escapeXml(getInitials(entity?.name || entity?.username || 'P'));
  const fallbackSvg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="avBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#2a2210"/>
          <stop offset="100%" stop-color="#161b22"/>
        </linearGradient>
      </defs>
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="url(#avBg)"/>
      <text x="${size / 2}" y="${size / 2 + 14}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="44" font-weight="700" fill="#f5b942">${initials}</text>
    </svg>`
  );
  return sharp(fallbackSvg).png().toBuffer();
}

async function renderValuationCardPng(data, webApi, botUsername) {
  const W = 960;
  const H = 540;
  const { entity, totalCount, totalValue, top3 } = data;
  const displayName = escapeXml(truncateText(entity.name || entity.username || `ID ${entity.id}`, 26));
  const handleText = escapeXml(entity.username ? `@${entity.username}` : `ID ${entity.id}`);
  const idBadge = escapeXml(`ID: ${entity.id}`);
  const totalValStr = escapeXml(`${fmtNum(totalValue)} STARS`);
  const totalGiftsStr = escapeXml(`${fmtNum(totalCount)} ta gift`);
  const footerBrand = escapeXml(`PAXTAGRAM • @${botUsername}`);

  const topRows = [0, 1, 2].map((idx) => {
    const g = top3[idx];
    const y = 260 + idx * 66;
    if (!g) {
      return `
        <rect x="480" y="${y}" width="424" height="54" rx="12" fill="#131820" stroke="#252c38" stroke-width="1"/>
        <text x="504" y="${y + 33}" font-family="DejaVu Sans, Arial, sans-serif" font-size="18" fill="#6e7681">${idx + 1}. Gift mavjud emas</text>
      `;
    }
    const numStr = g.number != null ? ` #${g.number}` : '';
    const titleStr = escapeXml(truncateText(`${idx + 1}. ${g.title}${numStr}`, 24));
    const priceStr = escapeXml(`${fmtNum(g.value)} ★`);
    return `
      <rect x="480" y="${y}" width="424" height="54" rx="12" fill="#1b212c" stroke="#2d3646" stroke-width="1.2"/>
      <text x="502" y="${y + 33}" font-family="DejaVu Sans, Arial, sans-serif" font-size="19" font-weight="600" fill="#e6edf3">${titleStr}</text>
      <text x="884" y="${y + 33}" text-anchor="end" font-family="DejaVu Sans, Arial, sans-serif" font-size="19" font-weight="700" fill="#f5b942">${priceStr}</text>
    `;
  }).join('');

  const svg = `
  <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0d1117"/>
        <stop offset="100%" stop-color="#161b22"/>
      </linearGradient>
      <linearGradient id="goldGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#f5b942"/>
        <stop offset="50%" stop-color="#ffd97d"/>
        <stop offset="100%" stop-color="#d4941e"/>
      </linearGradient>
      <linearGradient id="valBox" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#211b0e"/>
        <stop offset="100%" stop-color="#151922"/>
      </linearGradient>
    </defs>

    <!-- Base Background -->
    <rect width="${W}" height="${H}" rx="28" fill="url(#bg)"/>
    <!-- Subtle Luxury Glow -->
    <circle cx="840" cy="80" r="190" fill="#f5b942" fill-opacity="0.06"/>
    <circle cx="120" cy="480" r="160" fill="#f5b942" fill-opacity="0.04"/>

    <!-- Gold Outer Border -->
    <rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="22" fill="none" stroke="url(#goldGrad)" stroke-width="2.5"/>
    <rect x="22" y="22" width="${W - 44}" height="${H - 44}" rx="18" fill="none" stroke="#f5b942" stroke-opacity="0.2" stroke-width="1"/>

    <!-- Header Row -->
    <text x="54" y="64" font-family="DejaVu Sans, Arial, sans-serif" font-size="15" font-weight="700" letter-spacing="2.5" fill="#f5b942">GIFT PORTFOLIO VALUATION</text>
    <rect x="760" y="42" width="144" height="30" rx="15" fill="#231d10" stroke="#f5b942" stroke-opacity="0.55" stroke-width="1"/>
    <text x="832" y="62" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="14" font-weight="700" fill="#f5b942">${idBadge}</text>

    <!-- Avatar Ring -->
    <circle cx="118" cy="154" r="68" fill="#0d1117" stroke="url(#goldGrad)" stroke-width="3.5"/>

    <!-- Identity -->
    <text x="208" y="144" font-family="DejaVu Sans, Arial, sans-serif" font-size="34" font-weight="700" fill="#ffffff">${displayName}</text>
    <text x="208" y="182" font-family="DejaVu Sans, Arial, sans-serif" font-size="22" font-weight="500" fill="#8b949e">${handleText}</text>

    <!-- Divider -->
    <line x1="54" y1="238" x2="${W - 54}" y2="238" stroke="#30363d" stroke-width="1.2"/>

    <!-- Left Panel: Total Value & Gift Count -->
    <rect x="54" y="260" width="398" height="186" rx="18" fill="url(#valBox)" stroke="#f5b942" stroke-opacity="0.45" stroke-width="1.5"/>
    <text x="82" y="298" font-family="DejaVu Sans, Arial, sans-serif" font-size="15" font-weight="700" letter-spacing="1.5" fill="#c9a24d">UMUMIY QIYMAT</text>
    <text x="82" y="356" font-family="DejaVu Sans, Arial, sans-serif" font-size="40" font-weight="800" fill="#f5b942">${totalValStr}</text>

    <rect x="82" y="382" width="180" height="40" rx="10" fill="#1c222d" stroke="#30363d" stroke-width="1"/>
    <text x="172" y="408" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="18" font-weight="700" fill="#e6edf3">${totalGiftsStr}</text>

    <!-- Right Panel: Top 3 Gifts -->
    <text x="480" y="250" font-family="DejaVu Sans, Arial, sans-serif" font-size="14" font-weight="700" letter-spacing="1.5" fill="#8b949e">TOP 3 ENG QIMMAT GIFT</text>
    ${topRows}

    <!-- Footer -->
    <text x="54" y="492" font-family="DejaVu Sans, Arial, sans-serif" font-size="15" font-weight="700" letter-spacing="1.5" fill="#8b949e">${footerBrand}</text>
    <text x="904" y="492" text-anchor="end" font-family="DejaVu Sans, Arial, sans-serif" font-size="14" fill="#6e7681">Jonli Paxta Market narxlari</text>
  </svg>`;

  const avatarBuf = await buildCircularAvatar(entity, webApi, 124);
  return sharp(Buffer.from(svg))
    .composite([{ input: avatarBuf, left: 56, top: 92 }])
    .png()
    .toBuffer();
}

function parseTarget(raw) {
  if (!raw) return null;
  let text = String(raw).trim();
  const urlMatch = text.match(/paxta\.online\/(?:@)?([a-zA-Z0-9_]{2,64})/i);
  if (urlMatch) text = urlMatch[1];
  text = text.split(/\s+/)[0].replace(/^@/, '').trim();
  if (!text || text.startsWith('/')) return null;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(text)) return null;
  return text;
}

async function getMarketFloors(webApi) {
  const now = Date.now();
  if (now - marketCache.fetchedAt < MARKET_CACHE_TTL_MS && marketCache.floorByGiftId.size > 0) {
    return marketCache;
  }
  try {
    const market = await webApi.getMarket();
    const floorByGiftId = new Map();
    const titleByGiftId = new Map();
    for (const col of market?.collections || []) {
      const giftId = col?.gift?.id;
      if (!giftId) continue;
      const floor = Number(col.floor) || Number(col.gift?.price) || 0;
      floorByGiftId.set(giftId, floor);
      if (col.gift?.title) titleByGiftId.set(giftId, col.gift.title);
    }
    marketCache = { fetchedAt: now, floorByGiftId, titleByGiftId };
  } catch {
    // Keep stale cache if market temporarily fails
  }
  return marketCache;
}

async function resolveTargetAndGifts(target, api, webApi) {
  let entity = null;
  let isChannel = false;

  try {
    entity = await webApi.getUser(target);
  } catch {
    try {
      const chatArg = /^\d+$/.test(target) ? Number(target) : `@${target}`;
      const chat = await api.getChat(chatArg);
      if (chat?.id) {
        entity = {
          id: chat.id,
          username: chat.username || null,
          name: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || String(chat.id),
          is_bot: chat.type === 'bot',
          premium: false,
          verified: false,
        };
        isChannel = chat.type === 'channel' || chat.type === 'supergroup' || chat.type === 'group';
      }
    } catch {
      return null;
    }
  }

  if (!entity?.id) return null;

  const [market, giftsRes] = await Promise.all([
    getMarketFloors(webApi),
    webApi.getUserGifts(entity.id).catch(() => ({ total: 0, gifts: [] })),
  ]);

  const gifts = Array.isArray(giftsRes?.gifts) ? giftsRes.gifts : [];
  const totalCount = Number(giftsRes?.total ?? gifts.length) || 0;

  let totalValue = 0;
  const valuedGifts = gifts.map((item) => {
    const giftId = item?.gift?.id;
    const title = item?.gift?.title || market.titleByGiftId.get(giftId) || 'Gift';
    const marketFloor = giftId ? market.floorByGiftId.get(giftId) : null;
    const fallbackPrice =
      Number(item?.resale?.price) ||
      Number(item?.last_sale?.price) ||
      Number(item?.stars) ||
      Number(item?.gift?.price) ||
      0;
    const value = marketFloor && marketFloor > 0 ? marketFloor : fallbackPrice;
    totalValue += value;

    return {
      title,
      number: item?.number ?? null,
      value,
      isUnique: Boolean(item?.unique),
    };
  });

  valuedGifts.sort((a, b) => b.value - a.value);
  const top3 = valuedGifts.slice(0, 3);

  return {
    entity,
    isChannel,
    totalCount,
    analyzedCount: gifts.length,
    totalValue,
    top3,
  };
}

function formatValuationText(data) {
  const { entity, isChannel, totalCount, totalValue, top3 } = data;
  const handle = entity.username ? `@${entity.username}` : `ID: ${entity.id}`;
  const icon = isChannel ? '📢' : '👤';
  const name = entity.name || handle;

  const lines = [
    `💎 Gift Narxi — ${name} (${handle})`,
    ``,
    `💰 Umumiy qiymat: ${fmtNum(totalValue)} ⭐`,
    `🎁 Giftlar soni: ${fmtNum(totalCount)} ta`,
  ];

  if (top3.length > 0) {
    lines.push(``, `🏆 Top 3 eng qimmat gift:`);
    top3.forEach((g, idx) => {
      const numStr = g.number != null ? ` #${g.number}` : '';
      lines.push(`${idx + 1}. ${g.title}${numStr} — ${fmtNum(g.value)} ⭐`);
    });
  } else {
    lines.push(``, `${icon} Ochilgan giftlar topilmadi.`);
  }

  return lines.join('\n');
}

function formatValuationHtml(data) {
  const { entity, isChannel, totalCount, totalValue, top3 } = data;
  const handle = entity.username ? `@${entity.username}` : `ID: ${entity.id}`;
  const icon = isChannel ? '📢' : '👤';
  const name = escapeHtml(entity.name || handle);

  const lines = [
    `💎 <b>Gift Narxi</b> — ${name} (<code>${escapeHtml(handle)}</code>)`,
    ``,
    `💰 Umumiy qiymat: <b>${fmtNum(totalValue)} ⭐</b>`,
    `🎁 Giftlar soni: <b>${fmtNum(totalCount)} ta</b>`,
  ];

  if (top3.length > 0) {
    lines.push(``, `🏆 <b>Top 3 eng qimmat gift:</b>`);
    top3.forEach((g, idx) => {
      const numStr = g.number != null ? ` #${g.number}` : '';
      lines.push(`${idx + 1}. ${escapeHtml(g.title)}${numStr} — <b>${fmtNum(g.value)} ⭐</b>`);
    });
  } else {
    lines.push(``, `${icon} Ochilgan giftlar topilmadi.`);
  }

  return lines.join('\n');
}

function buildValuationKeyboard(target, botUsername) {
  const clean = String(target).replace(/^@/, '');
  return {
    inline_keyboard: [
      [
        { text: '🔄 Yangilash', callback_data: `refresh:${clean}` },
        { text: '📤 Ulashish', switch_inline_query: `@${clean}` },
      ],
    ],
  };
}

function formatAdminStats(store) {
  const all = store.getAdminStats();
  const bot = store.getAdminStats(BOT_NAME);
  const lines = [
    `🛠 @Pricebot Admin Panel`,
    ``,
    `📊 @Pricebot statistikasi:`,
    `• So'rovlar: ${fmtNum(bot.totalRequests)}`,
    `• Bepul tekshiruvlar: ${fmtNum(bot.freeUses)}`,
    `• Pullik tekshiruvlar: ${fmtNum(bot.paidUses)}`,
    `• Tushum: ${fmtNum(bot.revenueStars)} ⭐`,
    ``,
    `🌐 Jami barcha botlar:`,
    `• Foydalanuvchilar: ${fmtNum(all.totalUsers)}`,
    `• Umumiy tushum: ${fmtNum(all.totalRevenueStars)} ⭐`,
  ];
  return lines.join('\n');
}

export async function register({ api, webApi, store, botInfo, logger }) {
  const botUsername = botInfo?.username || 'Pricebot';
  const pendingTargets = new Map();

  async function sendValuation(chatId, from, target, { chargeMode = 'auto', replyToMessageId } = {}) {
    const isAdmin = store.isAdmin(from);

    if (chargeMode === 'auto' && !isAdmin) {
      if (store.canUseFree(BOT_NAME, from.id, FREE_DEMO_LIMIT)) {
        store.consumeFreeUse(BOT_NAME, from, FREE_DEMO_LIMIT);
      } else {
        const balance = store.getBalance(from.id);
        const buttons = [];
        if (balance >= CHECK_PRICE_STARS) {
          buttons.push([{ text: `💰 Balansdan to'lash (${CHECK_PRICE_STARS} ⭐)`, callback_data: `paybal:${target}` }]);
        }
        await api.sendMessage(
          chatId,
          `🔒 Bepul demo tekshiruvingiz tugadi.\n\n@${target} giftlarini baholash: ${CHECK_PRICE_STARS} ⭐`,
          {
            ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
            ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
          }
        );
        try {
          await api.sendInvoice({
            chat_id: chatId,
            title: `Gift baholash: @${target}`,
            description: `Jonli Paxta Market narxlari bo'yicha to'liq gift bahosi`,
            payload: `price:${target}:${from.id}`,
            currency: 'XTR',
            prices: [{ label: 'Baholash', amount: CHECK_PRICE_STARS }],
          });
        } catch (err) {
          logger.warn(`sendInvoice failed: ${err.message}`);
        }
        return;
      }
    } else if (isAdmin) {
      store.recordRequest(BOT_NAME, from);
    }

    const data = await resolveTargetAndGifts(target, api, webApi);
    if (!data) {
      await api.sendMessage(chatId, `❌ "${target}" topilmadi. To'g'ri @username yoki ID kiriting.`);
      return;
    }

    const resolvedKey = data.entity.username || String(data.entity.id);
    const caption = formatValuationText(data);
    const replyMarkup = buildValuationKeyboard(resolvedKey, botUsername);
    try {
      const cardPng = await renderValuationCardPng(data, webApi, botUsername);
      await api.sendPhoto(chatId, cardPng, {
        caption,
        filename: `price_${resolvedKey}.png`,
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
        reply_markup: replyMarkup,
      });
    } catch (err) {
      logger.warn(`sendPhoto valuation card failed, falling back to text: ${err.message}`);
      await api.sendMessage(chatId, caption, {
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
        reply_markup: replyMarkup,
      });
    }
  }

  async function handleUpdate(update) {
    // 1. Pre-checkout query (must answer within 10s)
    if (update.pre_checkout_query) {
      const pq = update.pre_checkout_query;
      await api.answerPreCheckoutQuery(pq.id, true);
      return;
    }

    // 2. Inline query
    if (update.inline_query) {
      const iq = update.inline_query;
      const from = iq.from;
      store.touchUser(BOT_NAME, from);

      const target = parseTarget(iq.query);
      if (!target) {
        await api.answerInlineQuery(iq.id, [
          {
            type: 'article',
            id: 'help',
            title: '💎 Gift narxini bilish',
            description: 'Masalan: @Pricebot @hold',
            input_message_content: {
              message_text: `💎 Giftlar qiymatini bilish uchun <b>@${escapeHtml(botUsername)} @username</b> deb yozing.`,
              parse_mode: 'HTML',
            },
          },
        ], { cache_time: 10 });
        return;
      }

      store.recordRequest(BOT_NAME, from);
      const data = await resolveTargetAndGifts(target, api, webApi);
      if (!data) {
        await api.answerInlineQuery(iq.id, [
          {
            type: 'article',
            id: `notfound_${target}`,
            title: `❌ @${target} topilmadi`,
            description: 'Boshqa username yoki ID kiriting',
            input_message_content: {
              message_text: `❌ <b>${escapeHtml(target)}</b> topilmadi.`,
              parse_mode: 'HTML',
            },
          },
        ], { cache_time: 10 });
        return;
      }

      const resolvedKey = data.entity.username || String(data.entity.id);
      await api.answerInlineQuery(iq.id, [
        {
          type: 'article',
          id: `val_${resolvedKey}_${Date.now()}`,
          title: `💎 ${data.entity.name || resolvedKey}: ${fmtNum(data.totalValue)} ⭐`,
          description: `${data.totalCount} ta gift • Top: ${data.top3[0]?.title || '—'}`,
          input_message_content: {
            message_text: formatValuationHtml(data),
            parse_mode: 'HTML',
          },
          reply_markup: {
            inline_keyboard: [
              [{ text: `💎 @${botUsername} orqali tekshirish`, url: `https://paxta.online/${botUsername}` }],
            ],
          },
        },
      ], { cache_time: 15 });
      return;
    }

    // 3. Callback query
    if (update.callback_query) {
      const cq = update.callback_query;
      const from = cq.from;
      const chatId = cq.message?.chat?.id;
      const msgId = cq.message?.message_id;
      const dataStr = cq.data || '';
      store.touchUser(BOT_NAME, from);

      if (dataStr === 'demo:hold') {
        await api.answerCallbackQuery(cq.id, { text: 'Yuklanmoqda...' });
        await sendValuation(chatId, from, 'hold', { chargeMode: 'auto' });
        return;
      }

      if (dataStr === 'my:balance') {
        const isAdmin = store.isAdmin(from);
        const freeLeft = isAdmin ? 'Cheksiz (Admin)' : `${store.getFreeUsesRemaining(BOT_NAME, from.id, FREE_DEMO_LIMIT)} ta`;
        const bal = store.getBalance(from.id);
        await api.answerCallbackQuery(cq.id);
        await api.sendMessage(
          chatId,
          `📊 Hisobingiz:\n• Bepul demo: ${freeLeft}\n• Balans: ${fmtNum(bal)} ⭐\n• Tekshiruv narxi: ${CHECK_PRICE_STARS} ⭐`
        );
        return;
      }

      if (dataStr === 'admin:stats') {
        if (!store.isAdmin(from)) {
          await api.answerCallbackQuery(cq.id, { text: 'Ruxsat yo‘q', show_alert: true });
          return;
        }
        await api.answerCallbackQuery(cq.id);
        await api.sendMessage(chatId, formatAdminStats(store));
        return;
      }

      if (dataStr.startsWith('refresh:')) {
        const target = dataStr.slice('refresh:'.length);
        await api.answerCallbackQuery(cq.id, { text: 'Narxlar yangilanmoqda...' });
        const val = await resolveTargetAndGifts(target, api, webApi);
        if (!val) {
          await api.answerCallbackQuery(cq.id, { text: 'Topilmadi', show_alert: true });
          return;
        }
        const resolvedKey = val.entity.username || String(val.entity.id);
        const caption = formatValuationText(val);
        const replyMarkup = buildValuationKeyboard(resolvedKey, botUsername);
        try {
          const cardPng = await renderValuationCardPng(val, webApi, botUsername);
          await api.sendPhoto(chatId, cardPng, {
            caption,
            filename: `price_${resolvedKey}.png`,
            reply_markup: replyMarkup,
          });
        } catch (err) {
          logger.warn(`refresh sendPhoto failed: ${err.message}`);
          await api.sendMessage(chatId, caption, { reply_markup: replyMarkup }).catch(() => {});
        }
        return;
      }

      if (dataStr.startsWith('paybal:')) {
        const target = dataStr.slice('paybal:'.length);
        const res = store.deductBalance(from, CHECK_PRICE_STARS, {
          type: 'price_check',
          botName: BOT_NAME,
          ref: target,
        });
        if (!res.ok) {
          await api.answerCallbackQuery(cq.id, { text: 'Balans yetarli emas!', show_alert: true });
          return;
        }
        store.recordPaidUse(BOT_NAME, from, CHECK_PRICE_STARS, { payload: `bal:${target}` });
        await api.answerCallbackQuery(cq.id, { text: `${CHECK_PRICE_STARS} ⭐ yechildi!` });
        await sendValuation(chatId, from, target, { chargeMode: 'paid' });
        return;
      }

      await api.answerCallbackQuery(cq.id);
      return;
    }

    // 4. Messages
    const msg = update.message;
    if (!msg) return;
    const chatId = msg.chat?.id;
    const from = msg.from;
    if (!chatId || !from) return;

    store.touchUser(BOT_NAME, from);

    // Successful Stars payment
    if (msg.successful_payment) {
      const sp = msg.successful_payment;
      const payload = sp.invoice_payload || '';
      const parts = payload.split(':');
      const target = parts[1] || pendingTargets.get(from.id);
      const starsPaid = Number(sp.total_amount) || CHECK_PRICE_STARS;
      store.recordPaidUse(BOT_NAME, from, starsPaid, {
        payload,
        chargeId: sp.telegram_payment_charge_id,
      });
      if (target) {
        await sendValuation(chatId, from, target, { chargeMode: 'paid', replyToMessageId: msg.message_id });
      } else {
        await api.sendMessage(chatId, `✅ To'lov qabul qilindi! Endi @username yuboring.`);
      }
      return;
    }

    const text = (msg.text || '').trim();
    if (!text) return;

    const cmd = text.split(/\s+/)[0].split('@')[0].toLowerCase();

    if (cmd === '/start') {
      const isAdmin = store.isAdmin(from);
      const freeLeft = store.getFreeUsesRemaining(BOT_NAME, from.id, FREE_DEMO_LIMIT);
      const rows = [
        [
          { text: '💎 @hold ni tekshirish', callback_data: 'demo:hold' },
          { text: '📊 Hisobim', callback_data: 'my:balance' },
        ],
        [{ text: '⚡ Inline rejimda sinash', switch_inline_query: '@hold' }],
      ];
      if (isAdmin) {
        rows.push([{ text: '🛠 Admin panel', callback_data: 'admin:stats' }]);
      }

      const demoLine = isAdmin
        ? '👑 Admin rejim: barcha tekshiruvlar BEPUL!'
        : freeLeft > 0
          ? `🎁 Sizda ${freeLeft} ta bepul demo tekshiruv bor.`
          : `⭐ Tekshiruv narxi: ${CHECK_PRICE_STARS} ⭐`;

      await api.sendMessage(
        chatId,
        `💎 @${botUsername} — Giftlar qiymatini jonli baholash!\n\nUser yoki kanal @username / ID yuboring — Paxta Market narxlari bo'yicha jami qiymat va Top-3 giftlarni ko'rsataman.\n\n${demoLine}`,
        { reply_markup: { inline_keyboard: rows } }
      );
      return;
    }

    if (cmd === '/help') {
      await api.sendMessage(
        chatId,
        `📖 Qo'llanma:\n• @username yoki ID yuboring (masalan: @hold)\n• Inline rejim: istalgan chatda @${botUsername} @username yozing\n• Narx: 1-tekshiruv bepul, keyin ${CHECK_PRICE_STARS} ⭐`
      );
      return;
    }

    if (cmd === '/balance') {
      const isAdmin = store.isAdmin(from);
      const freeLeft = isAdmin ? 'Cheksiz (Admin)' : `${store.getFreeUsesRemaining(BOT_NAME, from.id, FREE_DEMO_LIMIT)} ta`;
      const bal = store.getBalance(from.id);
      await api.sendMessage(
        chatId,
        `📊 Hisobingiz:\n• Bepul demo: ${freeLeft}\n• Balans: ${fmtNum(bal)} ⭐\n• Tekshiruv narxi: ${CHECK_PRICE_STARS} ⭐`
      );
      return;
    }

    if (cmd === '/admin') {
      if (!store.isAdmin(from)) {
        await api.sendMessage(chatId, `⛔ Bu buyruq faqat admin uchun.`);
        return;
      }
      await api.sendMessage(chatId, formatAdminStats(store));
      return;
    }

    // Regular target lookup
    const argText = text.startsWith('/check') ? text.slice(6).trim() : text;
    const target = parseTarget(argText);
    if (!target) {
      await api.sendMessage(chatId, `✏️ Menga @username yoki ID yuboring (masalan: @hold).`);
      return;
    }

    pendingTargets.set(from.id, target);
    await sendValuation(chatId, from, target, {
      chargeMode: 'auto',
      replyToMessageId: msg.message_id,
    });
  }

  return {
    handleUpdate,
    commands: [
      { command: 'start', description: 'Botni boshlash va demo tekshiruv' },
      { command: 'balance', description: 'Balans va bepul limitni ko‘rish' },
      { command: 'help', description: 'Qisqa qo‘llanma' },
      { command: 'admin', description: 'Admin statistika (@hold)' },
    ],
  };
}
