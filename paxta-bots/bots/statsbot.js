const BOT_NAME = 'statsbot';
const FULL_CARD_STARS = 50;

function fmtNum(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-US').replace(/,/g, ' ');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

function estimateAgeTier(id) {
  const num = Number(id);
  if (!Number.isFinite(num) || num <= 0) return 'Nomaʼlum';
  if (num <= 200) return '👑 OG (Ilk 200 talik)';
  if (num <= 1000) return '⚡ Veteran (Top 1 000)';
  if (num <= 5000) return '🌟 Tajribali (Top 5 000)';
  return '🌱 Yangi avlod';
}

function computeFunRank({ ratingPoints, giftCount, premium, verified, collectorTier }) {
  const score =
    (Number(ratingPoints) || 0) +
    (Number(giftCount) || 0) * 500 +
    (premium ? 5000 : 0) +
    (verified ? 10000 : 0) +
    (Number(collectorTier) || 0) * 3000;

  if (score >= 300_000) return '👑 Paxta Afsonasi';
  if (score >= 100_000) return '💎 Elita Magnati';
  if (score >= 30_000) return '🔥 Pro Kolleksioner';
  if (score >= 5_000) return '⚡ Faol Yulduz';
  return '🌱 Boshlovchi';
}

async function fetchProfileStats(target, api, webApi) {
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
          members_count: chat.members_count || null,
          bio: chat.description || chat.bio || null,
        };
        isChannel = chat.type === 'channel' || chat.type === 'supergroup' || chat.type === 'group';
      }
    } catch {
      return null;
    }
  }

  if (!entity?.id) return null;

  const giftsRes = await webApi.getUserGifts(entity.id).catch(() => ({ total: 0, gifts: [] }));
  const giftCount = Number(giftsRes?.total ?? giftsRes?.gifts?.length ?? 0) || 0;
  const ratingPoints = Number(entity.rating?.points ?? 0);
  const ratingLevel = Number(entity.rating?.level ?? 0);
  const collectorTier = Number(entity.collector?.tier ?? 0);

  const funRank = computeFunRank({
    ratingPoints,
    giftCount,
    premium: Boolean(entity.premium),
    verified: Boolean(entity.verified || entity.verification),
    collectorTier,
  });

  return {
    entity,
    isChannel,
    giftCount,
    ratingPoints,
    ratingLevel,
    funRank,
    ageTier: estimateAgeTier(entity.id),
  };
}

function formatQuickSummaryText(stats) {
  const { entity, isChannel, giftCount, ratingLevel, funRank } = stats;
  const handle = entity.username ? `@${entity.username}` : `ID: ${entity.id}`;
  const name = entity.name || handle;
  const badges = [
    entity.premium ? '⭐ Premium' : null,
    entity.verified || entity.verification ? '✅ Tasdiqlangan' : null,
  ]
    .filter(Boolean)
    .join(' • ') || 'Oddiy profil';

  const lines = [
    `${isChannel ? '📢' : '👤'} Qisqa Statistika — ${name} (${handle})`,
    ``,
    `🆔 ID: ${entity.id}`,
    `🛡 Status: ${badges}`,
    `🎁 Giftlar: ${fmtNum(giftCount)} ta`,
    `📈 Daraja: ${ratingLevel ? `Level ${ratingLevel}` : '—'}`,
    `🏆 Unvon: ${funRank}`,
  ];
  return lines.join('\n');
}

function formatFullCardText(stats) {
  const { entity, isChannel, giftCount, ratingPoints, ratingLevel, funRank, ageTier } = stats;
  const handle = entity.username ? `@${entity.username}` : `ID: ${entity.id}`;
  const name = entity.name || handle;

  const verifierName = entity.verification?.verifier?.name;
  const verifiedStr = entity.verified || entity.verification
    ? `✅ Ha${verifierName ? ` (${verifierName})` : ''}`
    : '❌ Yo‘q';

  const lines = [
    `${isChannel ? '📢' : '💎'} TO‘LIQ PROFIL KARTASI — ${name}`,
    ``,
    `👤 Username: ${handle}`,
    `🆔 ID / Davr: ${entity.id} • ${ageTier}`,
    `⭐ Premium: ${entity.premium ? '✅ Bor' : '❌ Yo‘q'}`,
    `🛡 Tasdiq: ${verifiedStr}`,
    `🎁 Giftlar: ${fmtNum(giftCount)} ta`,
    `📊 Reyting: ${fmtNum(ratingPoints)} ball (Level ${ratingLevel})`,
    `🏆 Unvon: ${funRank}`,
  ];

  if (entity.collector?.key) {
    lines.push(`🖼 Kolleksioner: ${entity.collector.key.toUpperCase()} (Tier ${entity.collector.tier ?? 1})`);
  }
  if (entity.worn_gift?.title) {
    lines.push(`✨ Taqilgan gift: ${entity.worn_gift.title} #${entity.worn_gift.number}`);
  }
  if (entity.personal_channel?.username) {
    lines.push(`📢 Kanal: @${entity.personal_channel.username}`);
  }
  if (Array.isArray(entity.also_usernames) && entity.also_usernames.length > 0) {
    lines.push(`🔗 Qo‘shimcha usernamelar: ${entity.also_usernames.length} ta`);
  }
  if (entity.dc?.name) {
    lines.push(`🌐 Server: ${entity.dc.name}${entity.dc.city ? ` (${entity.dc.city})` : ''}`);
  }

  return lines.join('\n');
}

function formatInlineHtml(stats) {
  const { entity, isChannel, giftCount, ratingPoints, ratingLevel, funRank, ageTier } = stats;
  const handle = entity.username ? `@${entity.username}` : `ID: ${entity.id}`;
  const name = escapeHtml(entity.name || handle);

  const lines = [
    `${isChannel ? '📢' : '📊'} <b>${name}</b> (<code>${escapeHtml(handle)}</code>)`,
    ``,
    `🆔 ID: <code>${entity.id}</code> • ${escapeHtml(ageTier)}`,
    `⭐ Premium: ${entity.premium ? '✅' : '❌'} | 🛡 Tasdiq: ${entity.verified || entity.verification ? '✅' : '❌'}`,
    `🎁 Giftlar: <b>${fmtNum(giftCount)} ta</b>`,
    `📈 Reyting: <b>${fmtNum(ratingPoints)} ball</b> (Lvl ${ratingLevel})`,
    `🏆 Unvon: <b>${escapeHtml(funRank)}</b>`,
  ];
  return lines.join('\n');
}

function formatAdminStats(store) {
  const all = store.getAdminStats();
  const bot = store.getAdminStats(BOT_NAME);
  return [
    `🛠 @Statsbot Admin Panel`,
    ``,
    `📊 @Statsbot statistikasi:`,
    `• So'rovlar: ${fmtNum(bot.totalRequests)}`,
    `• Bepul ko'rishlar: ${fmtNum(bot.freeUses)}`,
    `• Pullik kartalar: ${fmtNum(bot.paidUses)}`,
    `• Tushum: ${fmtNum(bot.revenueStars)} ⭐`,
    ``,
    `🌐 Jami barcha botlar:`,
    `• Foydalanuvchilar: ${fmtNum(all.totalUsers)}`,
    `• Umumiy tushum: ${fmtNum(all.totalRevenueStars)} ⭐`,
  ].join('\n');
}

export async function register({ api, webApi, store, botInfo, logger }) {
  const botUsername = botInfo?.username || 'Statsbot';

  async function sendSummary(chatId, from, target, replyToMessageId) {
    const isAdmin = store.isAdmin(from);
    store.consumeFreeUse(BOT_NAME, from, Infinity);

    const stats = await fetchProfileStats(target, api, webApi);
    if (!stats) {
      await api.sendMessage(chatId, `❌ "${target}" topilmadi. To'g'ri @username yoki ID kiriting.`);
      return;
    }

    const resolvedKey = stats.entity.username || String(stats.entity.id);
    const fullBtnText = isAdmin
      ? `🔓 To'liq karta (Admin — Bepul)`
      : `🔓 To'liq karta (${FULL_CARD_STARS} ⭐)`;

    await api.sendMessage(chatId, formatQuickSummaryText(stats), {
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      reply_markup: {
        inline_keyboard: [
          [{ text: fullBtnText, callback_data: `full:${resolvedKey}` }],
          [{ text: '📤 Ulashish', switch_inline_query: `@${resolvedKey}` }],
        ],
      },
    });
  }

  async function sendFullCard(chatId, from, target, { editMessageId } = {}) {
    const stats = await fetchProfileStats(target, api, webApi);
    if (!stats) {
      await api.sendMessage(chatId, `❌ "${target}" topilmadi.`);
      return;
    }
    const resolvedKey = stats.entity.username || String(stats.entity.id);
    const text = formatFullCardText(stats);
    const replyMarkup = {
      inline_keyboard: [
        [{ text: '📤 Ulashish', switch_inline_query: `@${resolvedKey}` }],
      ],
    };

    if (editMessageId) {
      try {
        await api.editMessageText(chatId, editMessageId, text, { reply_markup: replyMarkup });
        return;
      } catch {
        // Fallback to sending new message
      }
    }
    await api.sendMessage(chatId, text, { reply_markup: replyMarkup });
  }

  async function handleUpdate(update) {
    // 1. Pre-checkout query
    if (update.pre_checkout_query) {
      await api.answerPreCheckoutQuery(update.pre_checkout_query.id, true);
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
            title: '📊 Profil statistikasi',
            description: 'Masalan: @Statsbot @hold',
            input_message_content: {
              message_text: `📊 Profil statistikasi uchun <b>@${escapeHtml(botUsername)} @username</b> deb yozing.`,
              parse_mode: 'HTML',
            },
          },
        ], { cache_time: 10 });
        return;
      }

      store.recordRequest(BOT_NAME, from);
      const stats = await fetchProfileStats(target, api, webApi);
      if (!stats) {
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

      const resolvedKey = stats.entity.username || String(stats.entity.id);
      await api.answerInlineQuery(iq.id, [
        {
          type: 'article',
          id: `stats_${resolvedKey}_${Date.now()}`,
          title: `📊 ${stats.entity.name || resolvedKey} — ${stats.funRank}`,
          description: `ID: ${stats.entity.id} • ${stats.giftCount} gift • Lvl ${stats.ratingLevel}`,
          input_message_content: {
            message_text: formatInlineHtml(stats),
            parse_mode: 'HTML',
          },
          reply_markup: {
            inline_keyboard: [
              [{ text: `📊 @${botUsername} da ochish`, url: `https://paxta.online/${botUsername}` }],
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
        await sendSummary(chatId, from, 'hold');
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

      if (dataStr.startsWith('full:')) {
        const target = dataStr.slice('full:'.length);
        if (store.isAdmin(from)) {
          store.recordRequest(BOT_NAME, from);
          await api.answerCallbackQuery(cq.id, { text: 'Admin — bepul!' });
          await sendFullCard(chatId, from, target, { editMessageId: msgId });
          return;
        }

        await api.answerCallbackQuery(cq.id);
        const balance = store.getBalance(from.id);
        if (balance >= FULL_CARD_STARS) {
          await api.sendMessage(
            chatId,
            `🔓 @${target} to'liq kartasini ochish: ${FULL_CARD_STARS} ⭐`,
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: `💰 Balansdan to'lash (${FULL_CARD_STARS} ⭐)`, callback_data: `paybal:${target}` }],
                ],
              },
            }
          );
        }
        try {
          await api.sendInvoice({
            chat_id: chatId,
            title: `To'liq karta: @${target}`,
            description: `ID davri, reyting ballari, taqilgan gift, kolleksioner va kanal ma'lumotlari`,
            payload: `stats:${target}:${from.id}`,
            currency: 'XTR',
            prices: [{ label: "To'liq karta", amount: FULL_CARD_STARS }],
          });
        } catch (err) {
          logger.warn(`sendInvoice failed: ${err.message}`);
        }
        return;
      }

      if (dataStr.startsWith('paybal:')) {
        const target = dataStr.slice('paybal:'.length);
        const res = store.deductBalance(from, FULL_CARD_STARS, {
          type: 'stats_full_card',
          botName: BOT_NAME,
          ref: target,
        });
        if (!res.ok) {
          await api.answerCallbackQuery(cq.id, { text: 'Balans yetarli emas!', show_alert: true });
          return;
        }
        store.recordPaidUse(BOT_NAME, from, FULL_CARD_STARS, { payload: `bal:${target}` });
        await api.answerCallbackQuery(cq.id, { text: `${FULL_CARD_STARS} ⭐ yechildi!` });
        await sendFullCard(chatId, from, target);
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
      const target = payload.split(':')[1];
      const starsPaid = Number(sp.total_amount) || FULL_CARD_STARS;
      store.recordPaidUse(BOT_NAME, from, starsPaid, {
        payload,
        chargeId: sp.telegram_payment_charge_id,
      });
      if (target) {
        await sendFullCard(chatId, from, target);
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
      const rows = [
        [{ text: '👤 @hold statistikasi', callback_data: 'demo:hold' }],
        [{ text: '⚡ Inline rejimda sinash', switch_inline_query: '@hold' }],
      ];
      if (isAdmin) {
        rows.push([{ text: '🛠 Admin panel', callback_data: 'admin:stats' }]);
      }

      await api.sendMessage(
        chatId,
        `📊 @${botUsername} — Profil va guruh statistikasi!\n\nIstalgan @username yoki ID yuboring:\n• Qisqa xulosa — BEPUL\n• To'liq karta — ${isAdmin ? 'Admin uchun BEPUL' : `${FULL_CARD_STARS} ⭐`}`,
        { reply_markup: { inline_keyboard: rows } }
      );
      return;
    }

    if (cmd === '/help') {
      await api.sendMessage(
        chatId,
        `📖 Qo'llanma:\n• @username yoki ID yuboring (masalan: @hold)\n• Qisqa ma'lumot bepul, to'liq karta ${FULL_CARD_STARS} ⭐\n• Inline rejim: @${botUsername} @username`
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

    const argText = text.startsWith('/stats') ? text.slice(6).trim() : text;
    const target = parseTarget(argText);
    if (!target) {
      await api.sendMessage(chatId, `✏️ Menga @username yoki ID yuboring (masalan: @hold).`);
      return;
    }

    await sendSummary(chatId, from, target, msg.message_id);
  }

  return {
    handleUpdate,
    commands: [
      { command: 'start', description: 'Botni boshlash' },
      { command: 'help', description: 'Qisqa qo‘llanma' },
      { command: 'admin', description: 'Admin statistika (@hold)' },
    ],
  };
}
