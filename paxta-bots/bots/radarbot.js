const BOT_NAME = 'radarbot';
const VIP_SCAN_STARS = 50;

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

function computeRadarMetrics(entity, giftCount) {
  const rating = Number(entity.rating?.points ?? 0);
  const level = Number(entity.rating?.level ?? 0);
  const premium = Boolean(entity.premium);
  const verified = Boolean(entity.verified || entity.verification);

  const rawPower =
    Math.min(40, Math.floor(rating / 10_000)) +
    Math.min(30, giftCount) +
    (premium ? 15 : 0) +
    (verified ? 15 : 0);
  const powerScore = Math.min(100, Math.max(12, rawPower));

  let aura = '🌿 Tinch Aura';
  let badge = '🌱 Yangi Signal';
  if (powerScore >= 85) {
    aura = '👑 Oltin Imperator Aurasi';
    badge = '🔥 Viral Legenda';
  } else if (powerScore >= 65) {
    aura = '⚡ Neon Magnat Aurasi';
    badge = '💎 Top Faol';
  } else if (powerScore >= 40) {
    aura = '🔮 Yulduzli Aura';
    badge = '⚡ Kuchli Signal';
  }

  return { powerScore, aura, badge, level, rating };
}

async function scanTarget(target, api, webApi) {
  let entity = null;
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
      }
    } catch {
      return null;
    }
  }

  if (!entity?.id) return null;
  const giftsRes = await webApi.getUserGifts(entity.id).catch(() => ({ total: 0, gifts: [] }));
  const giftCount = Number(giftsRes?.total ?? giftsRes?.gifts?.length ?? 0) || 0;
  const metrics = computeRadarMetrics(entity, giftCount);

  return { entity, giftCount, ...metrics };
}

function formatQuickRadarText(data) {
  const handle = data.entity.username ? `@${data.entity.username}` : `ID: ${data.entity.id}`;
  return [
    `📡 RADAR SKAN — ${data.entity.name || handle} (${handle})`,
    ``,
    `⚡ Power Score: ${data.powerScore}/100`,
    `✨ Aura: ${data.aura}`,
    `🏅 Nishon: ${data.badge}`,
  ].join('\n');
}

function formatVipRadarText(data) {
  const handle = data.entity.username ? `@${data.entity.username}` : `ID: ${data.entity.id}`;
  const e = data.entity;
  const rarityNote = data.powerScore >= 80
    ? 'Top 1% eng kuchli profillar qatorida!'
    : data.powerScore >= 50
      ? 'Top 15% faol foydalanuvchilar qatorida!'
      : 'O‘sib borayotgan profil!';

  return [
    `🛰 VIP CHUQUR RADAR — ${e.name || handle} (${handle})`,
    ``,
    `⚡ Power Score: ${data.powerScore}/100`,
    `✨ Aura: ${data.aura}`,
    `🏅 Nishon: ${data.badge}`,
    `📊 Reyting: ${fmtNum(data.rating)} ball (Level ${data.level})`,
    `🎁 Giftlar: ${fmtNum(data.giftCount)} ta`,
    `📈 Status: ${rarityNote}`,
    `🌐 Server: ${e.dc?.name || 'Paxta Cloud'}`,
  ].join('\n');
}

function formatRadarHtml(data) {
  const handle = data.entity.username ? `@${data.entity.username}` : `ID: ${data.entity.id}`;
  return [
    `📡 <b>RADAR: ${escapeHtml(data.entity.name || handle)}</b> (<code>${escapeHtml(handle)}</code>)`,
    ``,
    `⚡ Power Score: <b>${data.powerScore}/100</b>`,
    `✨ Aura: <b>${escapeHtml(data.aura)}</b>`,
    `🏅 Nishon: <b>${escapeHtml(data.badge)}</b>`,
  ].join('\n');
}

function formatAdminStats(store) {
  const all = store.getAdminStats();
  const bot = store.getAdminStats(BOT_NAME);
  return [
    `🛠 @Radarbot Admin Panel`,
    ``,
    `📊 @Radarbot statistikasi:`,
    `• So'rovlar: ${fmtNum(bot.totalRequests)}`,
    `• Bepul skan: ${fmtNum(bot.freeUses)}`,
    `• VIP skan: ${fmtNum(bot.paidUses)}`,
    `• Tushum: ${fmtNum(bot.revenueStars)} ⭐`,
    ``,
    `🌐 Jami foydalanuvchilar: ${fmtNum(all.totalUsers)}`,
  ].join('\n');
}

export async function register({ api, webApi, store, botInfo, logger }) {
  const botUsername = botInfo?.username || 'Radarbot';

  async function sendQuickScan(chatId, from, target, replyToMessageId) {
    const isAdmin = store.isAdmin(from);
    store.consumeFreeUse(BOT_NAME, from, Infinity);

    const data = await scanTarget(target, api, webApi);
    if (!data) {
      await api.sendMessage(chatId, `❌ "${target}" topilmadi.`);
      return;
    }

    const resolvedKey = data.entity.username || String(data.entity.id);
    const vipText = isAdmin
      ? `🛰 VIP Chuqur Skan (Admin — Bepul)`
      : `🛰 VIP Chuqur Skan (${VIP_SCAN_STARS} ⭐)`;

    await api.sendMessage(chatId, formatQuickRadarText(data), {
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      reply_markup: {
        inline_keyboard: [
          [{ text: vipText, callback_data: `vip:${resolvedKey}` }],
          [{ text: '📤 Ulashish', switch_inline_query: `@${resolvedKey}` }],
        ],
      },
    });
  }

  async function sendVipScan(chatId, from, target, { editMessageId } = {}) {
    const data = await scanTarget(target, api, webApi);
    if (!data) {
      await api.sendMessage(chatId, `❌ "${target}" topilmadi.`);
      return;
    }
    const resolvedKey = data.entity.username || String(data.entity.id);
    const text = formatVipRadarText(data);
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
        // Fallback
      }
    }
    await api.sendMessage(chatId, text, { reply_markup: replyMarkup });
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
            title: '📡 Profil Radar skaneri',
            description: 'Masalan: @Radarbot @hold',
            input_message_content: {
              message_text: `📡 Profilni skanerlash uchun <b>@${escapeHtml(botUsername)} @username</b> deb yozing.`,
              parse_mode: 'HTML',
            },
          },
        ], { cache_time: 10 });
        return;
      }

      store.recordRequest(BOT_NAME, from);
      const data = await scanTarget(target, api, webApi);
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
          id: `r_${resolvedKey}_${Date.now()}`,
          title: `📡 ${data.entity.name || resolvedKey}: ${data.powerScore}/100`,
          description: `${data.aura} • ${data.badge}`,
          input_message_content: {
            message_text: formatRadarHtml(data),
            parse_mode: 'HTML',
          },
          reply_markup: {
            inline_keyboard: [
              [{ text: `📡 @${botUsername} da sinash`, url: `https://paxta.online/${botUsername}` }],
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
      const msgId = cq.message?.message_id;
      const dataStr = cq.data || '';
      store.touchUser(BOT_NAME, from);

      if (dataStr === 'demo:hold') {
        await api.answerCallbackQuery(cq.id, { text: 'Skanerlanmoqda...' });
        await sendQuickScan(chatId, from, 'hold');
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

      if (dataStr.startsWith('vip:')) {
        const target = dataStr.slice('vip:'.length);
        if (store.isAdmin(from)) {
          store.recordRequest(BOT_NAME, from);
          await api.answerCallbackQuery(cq.id, { text: 'Admin — bepul!' });
          await sendVipScan(chatId, from, target, { editMessageId: msgId });
          return;
        }

        await api.answerCallbackQuery(cq.id);
        const balance = store.getBalance(from.id);
        if (balance >= VIP_SCAN_STARS) {
          await api.sendMessage(
            chatId,
            `🛰 @${target} VIP chuqur skan: ${VIP_SCAN_STARS} ⭐`,
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: `💰 Balansdan to'lash (${VIP_SCAN_STARS} ⭐)`, callback_data: `paybal:${target}` }],
                ],
              },
            }
          );
        }
        try {
          await api.sendInvoice({
            chat_id: chatId,
            title: `VIP Radar: @${target}`,
            description: `Chuqur aura, reyting foizi va server tahlili`,
            payload: `radar:${target}:${from.id}`,
            currency: 'XTR',
            prices: [{ label: 'VIP Radar', amount: VIP_SCAN_STARS }],
          });
        } catch (err) {
          logger.warn(`sendInvoice failed: ${err.message}`);
        }
        return;
      }

      if (dataStr.startsWith('paybal:')) {
        const target = dataStr.slice('paybal:'.length);
        const res = store.deductBalance(from, VIP_SCAN_STARS, {
          type: 'radar_vip',
          botName: BOT_NAME,
          ref: target,
        });
        if (!res.ok) {
          await api.answerCallbackQuery(cq.id, { text: 'Balans yetarli emas!', show_alert: true });
          return;
        }
        store.recordPaidUse(BOT_NAME, from, VIP_SCAN_STARS, { payload: `bal:${target}` });
        await api.answerCallbackQuery(cq.id, { text: `${VIP_SCAN_STARS} ⭐ yechildi!` });
        await sendVipScan(chatId, from, target);
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
      const target = (sp.invoice_payload || '').split(':')[1];
      const starsPaid = Number(sp.total_amount) || VIP_SCAN_STARS;
      store.recordPaidUse(BOT_NAME, from, starsPaid, {
        payload: sp.invoice_payload,
        chargeId: sp.telegram_payment_charge_id,
      });
      if (target) {
        await sendVipScan(chatId, from, target);
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
        [{ text: '📡 @hold ni skanerlash', callback_data: 'demo:hold' }],
        [{ text: '⚡ Inline rejim', switch_inline_query: '@hold' }],
      ];
      if (isAdmin) rows.push([{ text: '🛠 Admin panel', callback_data: 'admin:stats' }]);

      await api.sendMessage(
        chatId,
        `📡 @${botUsername} — Profil Aura & Power Skaneri!\n\n@username yuboring:\n• Tezkor skan — BEPUL\n• VIP chuqur skan — ${isAdmin ? 'Admin uchun BEPUL' : `${VIP_SCAN_STARS} ⭐`}`,
        { reply_markup: { inline_keyboard: rows } }
      );
      return;
    }

    if (cmd === '/help') {
      await api.sendMessage(
        chatId,
        `📖 Qo'llanma:\n• @username yuboring — aura va power score ko'rasiz\n• Inline: @${botUsername} @username\n• VIP chuqur skan: ${VIP_SCAN_STARS} ⭐`
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

    const argText = cmd === '/radar' ? text.slice(6).trim() : text;
    const target = parseTarget(argText);
    if (!target) {
      await api.sendMessage(chatId, `✏️ Menga @username yoki ID yuboring (masalan: @hold).`);
      return;
    }

    await sendQuickScan(chatId, from, target, msg.message_id);
  }

  return {
    handleUpdate,
    commands: [
      { command: 'start', description: 'Botni boshlash' },
      { command: 'radar', description: 'Profilni skanerlash' },
      { command: 'help', description: 'Qisqa qo‘llanma' },
      { command: 'admin', description: 'Admin statistika (@hold)' },
    ],
  };
}
