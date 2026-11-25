const BOT_NAME = 'searchbot';
const SEARCH_PRICE_STARS = 50;
const FREE_DEMO_LIMIT = 1;

function fmtNum(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-US').replace(/,/g, ' ');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseQuery(raw) {
  const text = String(raw || '').trim();
  if (!text || text.startsWith('/')) return null;
  return text;
}

function isUsernameLookup(q) {
  const s = q.trim();
  if (s.startsWith('@')) return true;
  if (/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(s) && !/^(black|gold|white|blue|red|green|pink|onyx|silver|emerald|cyber|neon)$/i.test(s)) {
    // Could be a username or a color/gift keyword; treat 5-6 char or explicit @ as username if no number/price
    return s.length >= 5 && s.length <= 6 && !/\d/.test(s);
  }
  return false;
}

async function checkUsernameAvailability(username, api, webApi) {
  const clean = username.replace(/^@/, '').trim();
  try {
    const user = await webApi.getUser(clean);
    if (user?.id) {
      return { username: clean, available: false, owner: user };
    }
  } catch (err) {
    if (err.status === 404) {
      try {
        await api.getChat(`@${clean}`);
        return { username: clean, available: false, owner: { username: clean } };
      } catch {
        return { username: clean, available: true };
      }
    }
  }
  return { username: clean, available: true };
}

function generateCandidateUsernames(count = 6) {
  const prefixes = ['pax', 'xol', 'uzb', 'pro', 'top', 'vip', 'sky', 'zen', 'neo', 'lux'];
  const suffixes = ['99', '77', '01', 'ox', 'ex', 'ly', 'go', 'ai'];
  const out = new Set();
  while (out.size < count) {
    const p = prefixes[Math.floor(Math.random() * prefixes.length)];
    const s = suffixes[Math.floor(Math.random() * suffixes.length)];
    const candidate = `${p}${s}`;
    if (candidate.length >= 5 && candidate.length <= 6) out.add(candidate);
  }
  return [...out];
}

async function searchMarketItems(queryStr, webApi) {
  const q = queryStr.trim().toLowerCase();
  const numMatch = q.match(/#(\d+)/) || q.match(/^(\d{1,6})$/);
  const maxPriceMatch = q.match(/(?:<=|under|gacha|max)\s*(\d+)/i);
  const targetNum = numMatch ? Number(numMatch[1]) : null;
  const maxPrice = maxPriceMatch ? Number(maxPriceMatch[1]) : null;
  const keyword = q
    .replace(/#\d+/g, '')
    .replace(/(?:<=|under|gacha|max)\s*\d+/gi, '')
    .replace(/^\d{1,6}$/, '')
    .trim();

  const market = await webApi.getMarket();
  const cols = Array.isArray(market?.collections) ? market.collections : [];
  const topCols = cols.slice(0, 8);

  const pages = await Promise.all(
    topCols.map((c) => webApi.getMarketGift(c.gift.id).catch(() => null))
  );

  const matches = [];
  for (let i = 0; i < topCols.length; i++) {
    const col = topCols[i];
    const page = pages[i];
    const giftTitle = col?.gift?.title || 'Gift';
    for (const item of page?.items || []) {
      const price = Number(item.price) || 0;
      const num = Number(item.number);
      const backdrop = item?.unique?.backdrop?.name || '';
      const model = item?.unique?.model?.name || '';
      const pattern = item?.unique?.pattern?.name || '';

      if (targetNum !== null && num !== targetNum) continue;
      if (maxPrice !== null && price > maxPrice) continue;
      if (keyword) {
        const hay = `${giftTitle} ${backdrop} ${model} ${pattern}`.toLowerCase();
        if (!hay.includes(keyword)) continue;
      }

      matches.push({
        title: giftTitle,
        number: num,
        price,
        backdrop,
        model,
        link: item?.unique?.link || null,
      });
    }
  }

  matches.sort((a, b) => a.price - b.price);
  return matches.slice(0, 5);
}

function formatSearchText(result) {
  if (result.type === 'username') {
    const { username, available, owner } = result.data;
    if (available) {
      return `✅ @${username} — BO‘SH!\n\nUzunligi: ${username.length} belgi\nHolat: Band qilinmagan, olishingiz mumkin.`;
    }
    return `❌ @${username} — BAND\n\nEgasi: ${owner?.name || `@${username}`}`;
  }

  if (result.type === 'free_list') {
    const freeOnes = result.data.filter((r) => r.available);
    if (freeOnes.length === 0) {
      return `🔍 Tekshirilgan usernamelar band chiqdi. Qayta urinib ko‘ring.`;
    }
    return [
      `🎯 Bo‘sh 5-6 harfli usernamelar:`,
      ``,
      ...freeOnes.map((r) => `• @${r.username} (${r.username.length} belgi) — ✅ Bo‘sh`),
    ].join('\n');
  }

  const items = result.data;
  if (!items.length) {
    return `🔍 "${result.query}" bo‘yicha Paxta Marketda mos gift topilmadi.`;
  }
  const lines = [`🛒 Paxta Market natijalari ("${result.query}"):`, ``];
  items.forEach((it, idx) => {
    const attrs = [it.backdrop, it.model].filter(Boolean).join(' • ');
    lines.push(`${idx + 1}. ${it.title} #${it.number} — ${fmtNum(it.price)} ⭐`);
    if (attrs) lines.push(`   🎨 ${attrs}`);
  });
  return lines.join('\n');
}

function formatSearchHtml(result) {
  if (result.type === 'username') {
    const { username, available, owner } = result.data;
    if (available) {
      return `✅ <code>@${escapeHtml(username)}</code> — <b>BO‘SH!</b>\nUzunligi: ${username.length} belgi`;
    }
    return `❌ <code>@${escapeHtml(username)}</code> — <b>BAND</b> (${escapeHtml(owner?.name || username)})`;
  }
  const items = result.data || [];
  if (!items.length) {
    return `🔍 <b>${escapeHtml(result.query)}</b> bo‘yicha marketda natija topilmadi.`;
  }
  const lines = [`🛒 <b>Paxta Market: ${escapeHtml(result.query)}</b>`, ``];
  items.forEach((it, idx) => {
    lines.push(`${idx + 1}. <b>${escapeHtml(it.title)} #${it.number}</b> — <b>${fmtNum(it.price)} ⭐</b>`);
  });
  return lines.join('\n');
}

function formatAdminStats(store) {
  const all = store.getAdminStats();
  const bot = store.getAdminStats(BOT_NAME);
  return [
    `🛠 @Searchbot Admin Panel`,
    ``,
    `📊 @Searchbot statistikasi:`,
    `• So'rovlar: ${fmtNum(bot.totalRequests)}`,
    `• Bepul qidiruv: ${fmtNum(bot.freeUses)}`,
    `• Pullik qidiruv: ${fmtNum(bot.paidUses)}`,
    `• Tushum: ${fmtNum(bot.revenueStars)} ⭐`,
    ``,
    `🌐 Jami foydalanuvchilar: ${fmtNum(all.totalUsers)}`,
  ].join('\n');
}

export async function register({ api, webApi, store, botInfo, logger }) {
  const botUsername = botInfo?.username || 'Searchbot';
  const pendingQueries = new Map();

  async function executeSearch(chatId, from, query, { chargeMode = 'auto', replyToMessageId } = {}) {
    const isAdmin = store.isAdmin(from);

    if (chargeMode === 'auto' && !isAdmin) {
      if (store.canUseFree(BOT_NAME, from.id, FREE_DEMO_LIMIT)) {
        store.consumeFreeUse(BOT_NAME, from, FREE_DEMO_LIMIT);
      } else {
        const balance = store.getBalance(from.id);
        const buttons = [];
        if (balance >= SEARCH_PRICE_STARS) {
          buttons.push([{ text: `💰 Balansdan to'lash (${SEARCH_PRICE_STARS} ⭐)`, callback_data: `paybal:${query.slice(0, 40)}` }]);
        }
        await api.sendMessage(
          chatId,
          `🔒 Bepul demo qidiruvingiz tugadi.\n\nQidiruv narxi: ${SEARCH_PRICE_STARS} ⭐`,
          {
            ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
            ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
          }
        );
        try {
          await api.sendInvoice({
            chat_id: chatId,
            title: `Qidiruv: ${query.slice(0, 24)}`,
            description: `Username yoki Paxta Market qidiruvi`,
            payload: `search:${from.id}:${Date.now()}`,
            currency: 'XTR',
            prices: [{ label: 'Qidiruv', amount: SEARCH_PRICE_STARS }],
          });
        } catch (err) {
          logger.warn(`sendInvoice failed: ${err.message}`);
        }
        return;
      }
    } else if (isAdmin) {
      store.recordRequest(BOT_NAME, from);
    }

    let result;
    if (query === '__FREE_LIST__') {
      const candidates = generateCandidateUsernames(6);
      const checked = await Promise.all(candidates.map((u) => checkUsernameAvailability(u, api, webApi)));
      result = { type: 'free_list', data: checked, query };
    } else if (isUsernameLookup(query)) {
      const data = await checkUsernameAvailability(query, api, webApi);
      result = { type: 'username', data, query };
    } else {
      const items = await searchMarketItems(query, webApi);
      result = { type: 'market', data: items, query };
    }

    await api.sendMessage(chatId, formatSearchText(result), {
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🎯 Bo‘sh usernamelar', callback_data: 'act:freelist' },
            { text: '📤 Ulashish', switch_inline_query: query === '__FREE_LIST__' ? 'black' : query },
          ],
        ],
      },
    });
  }

  async function handleUpdate(update) {
    if (update.pre_checkout_query) {
      await api.answerPreCheckoutQuery(update.pre_checkout_query.id, true);
      return;
    }

    if (update.inline_query) {
      const iq = update.inline_query;
      const from = iq.from;
      store.touchUser(BOT_NAME, from);

      const q = parseQuery(iq.query);
      if (!q) {
        await api.answerInlineQuery(iq.id, [
          {
            type: 'article',
            id: 'help',
            title: '🔍 Market va Username qidiruvi',
            description: 'Masalan: @Searchbot black yoki @Searchbot @salom',
            input_message_content: {
              message_text: `🔍 Qidirish uchun <b>@${escapeHtml(botUsername)} black</b> yoki <b>@${escapeHtml(botUsername)} @name</b> yozing.`,
              parse_mode: 'HTML',
            },
          },
        ], { cache_time: 10 });
        return;
      }

      store.recordRequest(BOT_NAME, from);
      const result = isUsernameLookup(q)
        ? { type: 'username', data: await checkUsernameAvailability(q, api, webApi), query: q }
        : { type: 'market', data: await searchMarketItems(q, webApi), query: q };

      await api.answerInlineQuery(iq.id, [
        {
          type: 'article',
          id: `s_${Date.now()}`,
          title: result.type === 'username'
            ? `${result.data.available ? '✅ Bo‘sh' : '❌ Band'}: @${result.data.username}`
            : `🛒 Market: ${result.data.length} ta natija (${q})`,
          description: 'Natijani chatga yuborish uchun bosing',
          input_message_content: {
            message_text: formatSearchHtml(result),
            parse_mode: 'HTML',
          },
          reply_markup: {
            inline_keyboard: [
              [{ text: `🔍 @${botUsername} da ochish`, url: `https://paxta.online/${botUsername}` }],
            ],
          },
        },
      ], { cache_time: 15 });
      return;
    }

    if (update.callback_query) {
      const cq = update.callback_query;
      const from = cq.from;
      const chatId = cq.message?.chat?.id;
      const dataStr = cq.data || '';
      store.touchUser(BOT_NAME, from);

      if (dataStr === 'act:freelist') {
        await api.answerCallbackQuery(cq.id, { text: 'Qidirilmoqda...' });
        pendingQueries.set(from.id, '__FREE_LIST__');
        await executeSearch(chatId, from, '__FREE_LIST__', { chargeMode: 'auto' });
        return;
      }

      if (dataStr === 'demo:black') {
        await api.answerCallbackQuery(cq.id, { text: 'Market qidirilmoqda...' });
        pendingQueries.set(from.id, 'black');
        await executeSearch(chatId, from, 'black', { chargeMode: 'auto' });
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

      if (dataStr.startsWith('paybal:')) {
        const query = dataStr.slice('paybal:'.length);
        const res = store.deductBalance(from, SEARCH_PRICE_STARS, {
          type: 'search_query',
          botName: BOT_NAME,
          ref: query,
        });
        if (!res.ok) {
          await api.answerCallbackQuery(cq.id, { text: 'Balans yetarli emas!', show_alert: true });
          return;
        }
        store.recordPaidUse(BOT_NAME, from, SEARCH_PRICE_STARS, { payload: `bal:${query}` });
        await api.answerCallbackQuery(cq.id, { text: `${SEARCH_PRICE_STARS} ⭐ yechildi!` });
        await executeSearch(chatId, from, query, { chargeMode: 'paid' });
        return;
      }

      await api.answerCallbackQuery(cq.id);
      return;
    }

    const msg = update.message;
    if (!msg) return;
    const chatId = msg.chat?.id;
    const from = msg.from;
    if (!chatId || !from) return;

    store.touchUser(BOT_NAME, from);

    if (msg.successful_payment) {
      const sp = msg.successful_payment;
      const starsPaid = Number(sp.total_amount) || SEARCH_PRICE_STARS;
      store.recordPaidUse(BOT_NAME, from, starsPaid, {
        payload: sp.invoice_payload,
        chargeId: sp.telegram_payment_charge_id,
      });
      const q = pendingQueries.get(from.id);
      if (q) {
        await executeSearch(chatId, from, q, { chargeMode: 'paid', replyToMessageId: msg.message_id });
      } else {
        await api.sendMessage(chatId, `✅ To'lov qabul qilindi! Endi so'rov yuboring.`);
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
          { text: '🎯 Bo‘sh 5-6 harfli usernamelar', callback_data: 'act:freelist' },
          { text: '🖤 Black giftlar', callback_data: 'demo:black' },
        ],
        [{ text: '⚡ Inline qidiruv', switch_inline_query: 'black' }],
      ];
      if (isAdmin) rows.push([{ text: '🛠 Admin panel', callback_data: 'admin:stats' }]);

      const priceNote = isAdmin
        ? '👑 Admin rejim: barcha qidiruvlar BEPUL!'
        : freeLeft > 0
          ? `🎁 Sizda ${freeLeft} ta bepul demo qidiruv bor.`
          : `⭐ Qidiruv narxi: ${SEARCH_PRICE_STARS} ⭐`;

      await api.sendMessage(
        chatId,
        `🔍 @${botUsername} — Username & Paxta Market qidiruvi!\n\n• @username yuboring — bo‘sh/bandligini tekshiraman\n• Rang, raqam (#77) yoki narx (<=500) yozing — marketdan topaman\n\n${priceNote}`,
        { reply_markup: { inline_keyboard: rows } }
      );
      return;
    }

    if (cmd === '/help') {
      await api.sendMessage(
        chatId,
        `📖 Qo'llanma:\n• @salom — username tekshirish\n• black / #77 / <=500 — market qidiruvi\n• Inline: @${botUsername} black\n• 1-qidiruv bepul, keyin ${SEARCH_PRICE_STARS} ⭐`
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

    const argText = cmd === '/search' ? text.slice(7).trim() : text;
    const q = parseQuery(argText);
    if (!q) {
      await api.sendMessage(chatId, `✏️ Qidirish uchun @username, rang (black) yoki raqam (#77) yuboring.`);
      return;
    }

    pendingQueries.set(from.id, q);
    await executeSearch(chatId, from, q, {
      chargeMode: 'auto',
      replyToMessageId: msg.message_id,
    });
  }

  return {
    handleUpdate,
    commands: [
      { command: 'start', description: 'Botni boshlash' },
      { command: 'search', description: 'Username yoki market qidirish' },
      { command: 'help', description: 'Qisqa qo‘llanma' },
      { command: 'admin', description: 'Admin statistika (@hold)' },
    ],
  };
}
