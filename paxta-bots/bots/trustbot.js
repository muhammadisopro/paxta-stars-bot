const BOT_NAME = 'trustbot';
const TRUST_PRICE_STARS = 50;
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

function getAgeTier(id) {
  const num = Number(id);
  if (!Number.isFinite(num) || num <= 0) return { label: 'Nomaʼlum', pts: 5 };
  if (num <= 200) return { label: '👑 OG (Ilk 200)', pts: 25 };
  if (num <= 1000) return { label: '⚡ Veteran (Top 1K)', pts: 20 };
  if (num <= 5000) return { label: '🌟 Tajribali (Top 5K)', pts: 12 };
  return { label: '🌱 Yangi akkaunt', pts: 5 };
}

function computeTrustScore({ id, premium, verified, giftCount, ratingLevel, hasChannel }) {
  const age = getAgeTier(id);
  let score = 20 + age.pts;
  if (verified) score += 22;
  if (premium) score += 12;
  if (giftCount >= 50) score += 15;
  else if (giftCount >= 10) score += 10;
  else if (giftCount >= 1) score += 5;
  if (ratingLevel >= 20) score += 6;
  else if (ratingLevel >= 5) score += 3;
  if (hasChannel) score += 5;

  score = Math.min(100, Math.max(10, score));
  let verdict = '⚠️ Ehtiyotkorlik tavsiya etiladi';
  if (score >= 85) verdict = '🛡 Yuqori ishonch (Sotuvchi / VIP)';
  else if (score >= 65) verdict = '✅ Ishonchli profil';
  else if (score >= 45) verdict = '🟡 O‘rtacha ishonch';

  return { score, verdict, ageLabel: age.label };
}

async function fetchTrustProfile(target, api, webApi) {
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

  const giftsRes = await webApi.getUserGifts(entity.id).catch(() => ({ total: 0, gifts: [] }));
  const giftCount = Number(giftsRes?.total ?? giftsRes?.gifts?.length ?? 0) || 0;
  const verified = Boolean(entity.verified || entity.verification);
  const premium = Boolean(entity.premium);
  const ratingLevel = Number(entity.rating?.level ?? 0);
  const hasChannel = Boolean(entity.personal_channel?.username);

  const trust = computeTrustScore({
    id: entity.id,
    premium,
    verified,
    giftCount,
    ratingLevel,
    hasChannel,
  });

  return {
    entity,
    isChannel,
    giftCount,
    verified,
    premium,
    ratingLevel,
    trust,
  };
}

function formatTrustText(data) {
  const { entity, isChannel, giftCount, verified, premium, trust } = data;
  const handle = entity.username ? `@${entity.username}` : `ID: ${entity.id}`;
  const name = entity.name || handle;

  return [
    `🛡 ISHONCH KARTASI — ${name} (${handle})`,
    ``,
    `📊 Trust Score: ${trust.score}/100`,
    `📌 Xulosa: ${trust.verdict}`,
    ``,
    `🆔 ID / Davr: ${entity.id} • ${trust.ageLabel}`,
    `${isChannel ? '📢 Turi: Kanal/Guruh' : `⭐ Premium: ${premium ? '✅ Bor' : '❌ Yo‘q'}`}`,
    `🛡 Tasdiq: ${verified ? '✅ Tasdiqlangan' : '❌ Yo‘q'}`,
    `🎁 Giftlar: ${fmtNum(giftCount)} ta`,
  ].join('\n');
}

function formatTrustHtml(data) {
  const { entity, giftCount, verified, premium, trust } = data;
  const handle = entity.username ? `@${entity.username}` : `ID: ${entity.id}`;
  const name = escapeHtml(entity.name || handle);

  return [
    `🛡 <b>ISHONCH KARTASI</b> — ${name} (<code>${escapeHtml(handle)}</code>)`,
    ``,
    `📊 Trust Score: <b>${trust.score}/100</b>`,
    `📌 ${escapeHtml(trust.verdict)}`,
    `🆔 ID: <code>${entity.id}</code> • ${escapeHtml(trust.ageLabel)}`,
    `⭐ Premium: ${premium ? '✅' : '❌'} | 🛡 Tasdiq: ${verified ? '✅' : '❌'} | 🎁 Giftlar: <b>${fmtNum(giftCount)}</b>`,
  ].join('\n');
}

function formatAdminStats(store) {
  const all = store.getAdminStats();
  const bot = store.getAdminStats(BOT_NAME);
  return [
    `🛠 @Trustbot Admin Panel`,
    ``,
    `📊 @Trustbot statistikasi:`,
    `• So'rovlar: ${fmtNum(bot.totalRequests)}`,
    `• Bepul tekshiruv: ${fmtNum(bot.freeUses)}`,
    `• Pullik tekshiruv: ${fmtNum(bot.paidUses)}`,
    `• Tushum: ${fmtNum(bot.revenueStars)} ⭐`,
    ``,
    `🌐 Jami foydalanuvchilar: ${fmtNum(all.totalUsers)}`,
  ].join('\n');
}

export async function register({ api, webApi, store, botInfo, logger }) {
  const botUsername = botInfo?.username || 'Trustbot';
  const pendingTargets = new Map();

  async function sendTrustCard(chatId, from, target, { chargeMode = 'auto', replyToMessageId } = {}) {
    const isAdmin = store.isAdmin(from);

    if (chargeMode === 'auto' && !isAdmin) {
      if (store.canUseFree(BOT_NAME, from.id, FREE_DEMO_LIMIT)) {
        store.consumeFreeUse(BOT_NAME, from, FREE_DEMO_LIMIT);
      } else {
        const balance = store.getBalance(from.id);
        const buttons = [];
        if (balance >= TRUST_PRICE_STARS) {
          buttons.push([{ text: `💰 Balansdan to'lash (${TRUST_PRICE_STARS} ⭐)`, callback_data: `paybal:${target}` }]);
        }
        await api.sendMessage(
          chatId,
          `🔒 Bepul demo tekshiruvingiz tugadi.\n\n@${target} ishonch kartasi: ${TRUST_PRICE_STARS} ⭐`,
          {
            ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
            ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
          }
        );
        try {
          await api.sendInvoice({
            chat_id: chatId,
            title: `Ishonch kartasi: @${target}`,
            description: `Sotuvchi yoki kanalning to'liq ishonch tahlili`,
            payload: `trust:${target}:${from.id}`,
            currency: 'XTR',
            prices: [{ label: 'Trust Card', amount: TRUST_PRICE_STARS }],
          });
        } catch (err) {
          logger.warn(`sendInvoice failed: ${err.message}`);
        }
        return;
      }
    } else if (isAdmin) {
      store.recordRequest(BOT_NAME, from);
    }

    const data = await fetchTrustProfile(target, api, webApi);
    if (!data) {
      await api.sendMessage(chatId, `❌ "${target}" topilmadi.`);
      return;
    }

    const resolvedKey = data.entity.username || String(data.entity.id);
    await api.sendMessage(chatId, formatTrustText(data), {
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      reply_markup: {
        inline_keyboard: [
          [{ text: '📤 Ulashish', switch_inline_query: `@${resolvedKey}` }],
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

      const target = parseTarget(iq.query);
      if (!target) {
        await api.answerInlineQuery(iq.id, [
          {
            type: 'article',
            id: 'help',
            title: '🛡 Sotuvchi ishonchini tekshirish',
            description: 'Masalan: @Trustbot @hold',
            input_message_content: {
              message_text: `🛡 Ishonch kartasi uchun <b>@${escapeHtml(botUsername)} @username</b> deb yozing.`,
              parse_mode: 'HTML',
            },
          },
        ], { cache_time: 10 });
        return;
      }

      store.recordRequest(BOT_NAME, from);
      const data = await fetchTrustProfile(target, api, webApi);
      if (!data) {
        await api.answerInlineQuery(iq.id, [
          {
            type: 'article',
            id: `nf_${target}`,
            title: `❌ @${target} topilmadi`,
            description: 'Boshqa username kiriting',
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
          id: `t_${resolvedKey}_${Date.now()}`,
          title: `🛡 ${data.entity.name || resolvedKey}: ${data.trust.score}/100`,
          description: data.trust.verdict,
          input_message_content: {
            message_text: formatTrustHtml(data),
            parse_mode: 'HTML',
          },
          reply_markup: {
            inline_keyboard: [
              [{ text: `🛡 @${botUsername} da ochish`, url: `https://paxta.online/${botUsername}` }],
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

      if (dataStr === 'demo:hold') {
        await api.answerCallbackQuery(cq.id, { text: 'Tekshirilmoqda...' });
        await sendTrustCard(chatId, from, 'hold', { chargeMode: 'auto' });
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
        const target = dataStr.slice('paybal:'.length);
        const res = store.deductBalance(from, TRUST_PRICE_STARS, {
          type: 'trust_check',
          botName: BOT_NAME,
          ref: target,
        });
        if (!res.ok) {
          await api.answerCallbackQuery(cq.id, { text: 'Balans yetarli emas!', show_alert: true });
          return;
        }
        store.recordPaidUse(BOT_NAME, from, TRUST_PRICE_STARS, { payload: `bal:${target}` });
        await api.answerCallbackQuery(cq.id, { text: `${TRUST_PRICE_STARS} ⭐ yechildi!` });
        await sendTrustCard(chatId, from, target, { chargeMode: 'paid' });
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
      const target = (sp.invoice_payload || '').split(':')[1] || pendingTargets.get(from.id);
      const starsPaid = Number(sp.total_amount) || TRUST_PRICE_STARS;
      store.recordPaidUse(BOT_NAME, from, starsPaid, {
        payload: sp.invoice_payload,
        chargeId: sp.telegram_payment_charge_id,
      });
      if (target) {
        await sendTrustCard(chatId, from, target, { chargeMode: 'paid', replyToMessageId: msg.message_id });
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
        [{ text: '🛡 @hold ishonch kartasi', callback_data: 'demo:hold' }],
        [{ text: '⚡ Inline tekshirish', switch_inline_query: '@hold' }],
      ];
      if (isAdmin) rows.push([{ text: '🛠 Admin panel', callback_data: 'admin:stats' }]);

      const priceNote = isAdmin
        ? '👑 Admin rejim: barcha tekshiruvlar BEPUL!'
        : freeLeft > 0
          ? `🎁 Sizda ${freeLeft} ta bepul demo tekshiruv bor.`
          : `⭐ Tekshiruv narxi: ${TRUST_PRICE_STARS} ⭐`;

      await api.sendMessage(
        chatId,
        `🛡 @${botUsername} — Sotuvchi va kanal ishonchini tekshirish!\n\n@username yoki ID yuboring — ID davri, tasdiq, giftlar va Trust Score (0-100) ni ko‘rsataman.\n\n${priceNote}`,
        { reply_markup: { inline_keyboard: rows } }
      );
      return;
    }

    if (cmd === '/help') {
      await api.sendMessage(
        chatId,
        `📖 Qo'llanma:\n• @username yoki ID yuboring\n• Inline: @${botUsername} @username\n• 1-tekshiruv bepul, keyin ${TRUST_PRICE_STARS} ⭐`
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

    const argText = cmd === '/trust' ? text.slice(6).trim() : text;
    const target = parseTarget(argText);
    if (!target) {
      await api.sendMessage(chatId, `✏️ Menga @username yoki ID yuboring (masalan: @hold).`);
      return;
    }

    pendingTargets.set(from.id, target);
    await sendTrustCard(chatId, from, target, {
      chargeMode: 'auto',
      replyToMessageId: msg.message_id,
    });
  }

  return {
    handleUpdate,
    commands: [
      { command: 'start', description: 'Botni boshlash' },
      { command: 'trust', description: 'Ishonch kartasini tekshirish' },
      { command: 'help', description: 'Qisqa qo‘llanma' },
      { command: 'admin', description: 'Admin statistika (@hold)' },
    ],
  };
}
