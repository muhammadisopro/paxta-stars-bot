import crypto from 'node:crypto';

const BOT_NAME = 'checkbot';

const MIN_STARS = 50;
const DEPOSIT_BUNDLES = [
  { credit: 50, pay: 65 },
  { credit: 100, pay: 125 },
  { credit: 250, pay: 310 },
  { credit: 500, pay: 620 },
];
const WITHDRAW_GIFTS = [
  { id: 1, title: '🍁 Maple Leaf', realPrice: 50, botCost: 60 },
  { id: 2, title: '🌳 Money Tree', realPrice: 75, botCost: 85 },
  { id: 6, title: '🎂 Cake', realPrice: 100, botCost: 115 },
];
const QUICK_CHECK_AMOUNTS = [50, 100, 250, 500];

// Per-user interactive state for step-by-step check creation
const pendingInput = new Map();

function calcFee(claims) {
  return claims > 1 ? 75 : 50;
}

function formatUserLabel(user) {
  if (!user) return 'Foydalanuvchi';
  if (user.username) return `@${user.username.replace(/^@/, '')}`;
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || `ID:${user.id}`;
}

function mainMenuKeyboard(isAdmin) {
  const rows = [
    [
      { text: '🎁 Chek yaratish', callback_data: 'cb:new' },
      { text: '💳 Balans to\'ldirish', callback_data: 'cb:deposit' },
    ],
    [
      { text: '🎁 Gift chiqarish', callback_data: 'cb:withdraw' },
      { text: '📋 Mening cheklarim', callback_data: 'cb:mychecks' },
    ],
    [
      { text: 'ℹ️ Qanday ishlaydi', callback_data: 'cb:help' },
    ],
  ];
  if (isAdmin) {
    rows.push([{ text: '👑 Admin statistika', callback_data: 'cb:admin' }]);
  }
  return { inline_keyboard: rows };
}

function formatCheckText(check) {
  const remaining = Math.max(0, check.totalClaims - check.claimedBy.length);
  const totalStars = check.amountPerClaim * check.totalClaims;
  const statusLine =
    check.status === 'cancelled'
      ? '❌ Bekor qilingan'
      : remaining === 0 || check.status === 'completed'
        ? '✅ To\'liq tarqatildi!'
        : `🟢 Faol (${remaining}/${check.totalClaims} ta qoldi)`;

  const lines = [
    `🎁 Stars Chek — ${check.amountPerClaim} ⭐`,
    `👤 Muallif: ${check.creatorName}`,
    `💰 Jami: ${totalStars} ⭐ (${check.totalClaims} kishi × ${check.amountPerClaim} ⭐)`,
    `📊 Holat: ${statusLine}`,
  ];

  if (check.comment) {
    lines.push(`💬 Izoh: ${check.comment}`);
  }

  if (check.claimedBy.length > 0) {
    const recent = check.claimedBy
      .slice(-5)
      .map((c) => `• ${c.username} (+${c.amount} ⭐)`)
      .join('\n');
    lines.push('', '🎉 Olganlar:', recent);
  }

  return lines.join('\n');
}

function checkMarkup(check, { includeShare = false } = {}) {
  const remaining = Math.max(0, check.totalClaims - check.claimedBy.length);
  const rows = [];
  if (check.status === 'active' && remaining > 0) {
    rows.push([
      { text: `🎁 ${check.amountPerClaim} ⭐ Olish (${remaining}/${check.totalClaims})`, callback_data: `cb:claim:${check.code}` },
    ]);
  }
  if (includeShare && check.status === 'active' && remaining > 0) {
    rows.push([
      { text: '📤 Guruhga / Do\'stga ulashish', switch_inline_query: check.code },
    ]);
  }
  return rows.length > 0 ? { inline_keyboard: rows } : undefined;
}

function formatAdminStats(store) {
  const stats = store.getAdminStats(BOT_NAME);
  const botStats = stats.bots[BOT_NAME] || {};
  const allChecks = Object.values(store.data.checks);
  const completedChecks = allChecks.filter((c) => c.status === 'completed').length;
  const totalClaimedStars = allChecks.reduce(
    (sum, c) => sum + c.claimedBy.length * c.amountPerClaim,
    0
  );

  const lines = [
    '👑 @Checkbot — Admin Panel (@hold)',
    '',
    `👥 Foydalanuvchilar: ${stats.totalUsers}`,
    `📨 Jami so'rovlar: ${botStats.totalRequests || 0}`,
    `💵 Gross invoice: ${stats.totalRevenueStars} ⭐`,
    `🏦 Net (85%, 15% komissiyasiz): ${stats.totalRealStarsReceived} ⭐`,
    `🎁 Gift chiqarish: ${stats.totalGiftWithdrawalsCount} ta (${stats.totalGiftWithdrawalsCost} ⭐ xarajat)`,
    `💎 Sof foyda (Net Profit): ${stats.netProfitStars} ⭐`,
    `🎟 Jami cheklar: ${stats.totalChecksCount} (Faol: ${stats.activeChecksCount}, Tugagan: ${completedChecks})`,
    `📦 Cheklar hajmi: ${stats.totalChecksVolume} ⭐ | Tarqatilgan: ${totalClaimedStars} ⭐`,
  ];

  if (stats.topUsers.length > 0) {
    lines.push('', '🏆 Top foydalanuvchilar:');
    for (const u of stats.topUsers.slice(0, 5)) {
      const label = u.username ? `@${u.username}` : u.first_name || `ID:${u.id}`;
      lines.push(`• ${label}: balans ${u.balance} ⭐ | sarf ${u.totalStarsSpent} ⭐`);
    }
  }

  return lines.join('\n');
}

function parseCheckArgs(text) {
  const cleaned = String(text || '').trim();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)(?:\s+(\d+))?(?:\s+(.+))?$/s);
  if (!match) return null;
  const amount = Math.floor(Number(match[1]));
  const claims = match[2] ? Math.floor(Number(match[2])) : 1;
  const comment = match[3] ? match[3].trim().slice(0, 120) : '';
  if (!Number.isFinite(amount) || amount < MIN_STARS || amount > 100000) return null;
  if (!Number.isFinite(claims) || claims < 1 || claims > 100) return null;
  return { amount, claims, comment };
}

export async function register({ api, webApi, store, botInfo, logger }) {
  const commands = [
    { command: 'start', description: 'Asosiy menyu va balans' },
    { command: 'check', description: 'Yangi Stars chek yaratish' },
    { command: 'balance', description: 'Balansni ko\'rish' },
    { command: 'deposit', description: 'Balansni Stars bilan to\'ldirish' },
    { command: 'withdraw', description: 'Balansdan real gift chiqarish' },
    { command: 'mychecks', description: 'Mening faol cheklarim' },
    { command: 'admin', description: 'Admin statistika (@hold)' },
  ];

  async function safeAnswerCallback(id, opts = {}) {
    try {
      await api.answerCallbackQuery(id, opts);
    } catch (err) {
      logger.warn(`answerCallbackQuery failed: ${err.message}`);
    }
  }

  async function safeEdit(target, text, replyMarkup) {
    try {
      const params = { ...target, text };
      if (replyMarkup) params.reply_markup = replyMarkup;
      await api.editMessageText(params);
    } catch (err) {
      if (!String(err.message).includes('not modified')) {
        logger.warn(`editMessageText failed: ${err.message}`);
      }
    }
  }

  async function sendHome(chatId, user) {
    const isAdmin = store.isAdmin(user);
    const balance = store.getBalance(user.id);
    const activeCount = store.getUserChecks(user.id).filter((c) => c.status === 'active').length;

    const lines = [
      `🎁 @${botInfo.username || 'Checkbot'} — Stars Cheklar`,
      '',
      `💳 Balansingiz: ${balance} ⭐`,
      `🎟 Faol cheklar: ${activeCount} ta`,
      isAdmin ? '👑 Admin rejimi: barcha cheklar BEPUL (0 ⭐ komissiya)' : '💡 Minimal chek: 50 ⭐ | Xizmat haqi: 50 ⭐ (1 kishi) / 75 ⭐ (ko\'p kishi)',
      '',
      'Inline rejimda ham ishlaydi:',
      `@${botInfo.username || 'Checkbot'} 50  yoki  @${botInfo.username || 'Checkbot'} 50 5`,
    ];

    await api.sendMessage(chatId, lines.join('\n'), {
      reply_markup: mainMenuKeyboard(isAdmin),
    });
  }

  async function sendDepositOptions(chatId, user) {
    const balance = store.getBalance(user.id);
    const buttons = DEPOSIT_BUNDLES.map((b) => ({
      text: `+${b.credit} ⭐ (${b.pay} ⭐)`,
      callback_data: `cb:dep:${b.credit}:${b.pay}`,
    }));
    await api.sendMessage(
      chatId,
      [
        '💳 Balansni to\'ldirish',
        '',
        `Hozirgi balans: ${balance} ⭐`,
        'Paketni tanlang (PaxtaGram 15% komissiyasi hisobga olingan):',
      ].join('\n'),
      {
        reply_markup: {
          inline_keyboard: [
            buttons.slice(0, 2),
            buttons.slice(2, 4),
            [{ text: '⬅️ Orqaga', callback_data: 'cb:home' }],
          ],
        },
      }
    );
  }

  async function sendWithdrawOptions(chatId, user) {
    const isAdmin = store.isAdmin(user);
    const balance = store.getBalance(user.id);
    const rows = WITHDRAW_GIFTS.map((g) => [
      {
        text: isAdmin ? `${g.title} — BEPUL (Admin)` : `${g.title} — ${g.botCost} ⭐`,
        callback_data: `cb:wd:${g.id}`,
      },
    ]);
    rows.push([{ text: '⬅️ Orqaga', callback_data: 'cb:home' }]);

    await api.sendMessage(
      chatId,
      [
        '🎁 Real Gift chiqarish',
        '',
        `Balansingiz: ${balance} ⭐`,
        'Qaysi sovg\'ani hisobingizga yuboraylik?',
      ].join('\n'),
      { reply_markup: { inline_keyboard: rows } }
    );
  }

  async function sendCheckCreationStep1(chatId, user) {
    const isAdmin = store.isAdmin(user);
    const balance = store.getBalance(user.id);
    const rows = [
      QUICK_CHECK_AMOUNTS.map((amt) => ({
        text: `${amt} ⭐`,
        callback_data: `cb:amt:${amt}`,
      })),
      [{ text: '⬅️ Orqaga', callback_data: 'cb:home' }],
    ];

    pendingInput.set(user.id, { step: 'awaiting_custom_check' });

    await api.sendMessage(
      chatId,
      [
        '🎁 Yangi chek yaratish',
        '',
        `Balans: ${balance} ⭐${isAdmin ? ' (Admin: BEPUL)' : ''}`,
        `Minimal summa: ${MIN_STARS} ⭐`,
        'Tugmadan summa tanlang yoki yozib yuboring:',
        'Masalan: 50 (1 kishiga) yoki 50 5 (5 kishiga 50 ⭐ dan)',
      ].join('\n'),
      { reply_markup: { inline_keyboard: rows } }
    );
  }

  async function createAndSendCheck(chatId, user, { amount, claims, comment = '', paidDirectly = false }) {
    const isAdmin = store.isAdmin(user);
    const feeStars = isAdmin ? 0 : calcFee(claims);
    const totalCost = amount * claims + feeStars;

    const res = store.createCheck({
      creator: user,
      creatorName: formatUserLabel(user),
      amountPerClaim: amount,
      totalClaims: claims,
      feeStars,
      comment,
      chargeCreator: !paidDirectly,
    });

    if (!res.ok && res.reason === 'insufficient_balance') {
      const shortage = Math.max(1, totalCost - res.balance);
      await api.sendMessage(
        chatId,
        [
          '⚠️ Balans yetarli emas',
          '',
          `Kerak: ${totalCost} ⭐ (${amount}×${claims} + ${feeStars} ⭐ komissiya)`,
          `Balansingiz: ${res.balance} ⭐ (Yetishmayapti: ${shortage} ⭐)`,
          '',
          'To\'g\'ridan-to\'g\'ri Stars bilan to\'lab chek yaratishingiz mumkin:',
        ].join('\n'),
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: `⭐ ${totalCost} to'lash va yaratish`, callback_data: `cb:paychk:${amount}:${claims}` }],
              [{ text: '💳 Balans to\'ldirish', callback_data: 'cb:deposit' }],
            ],
          },
        }
      );
      return;
    }

    if (!res.ok) {
      await api.sendMessage(chatId, '❌ Chek yaratishda xatolik. Iltimos, qayta urinib ko\'ring.');
      return;
    }

    if (paidDirectly && !isAdmin && feeStars > 0) {
      store.recordPaidUse(BOT_NAME, user, feeStars, { payload: `chk:${amount}:${claims}` });
    }

    await api.sendMessage(chatId, formatCheckText(res.check), {
      reply_markup: checkMarkup(res.check, { includeShare: true }),
    });
  }

  async function sendMyChecks(chatId, user) {
    const checks = store.getUserChecks(user.id).slice(0, 8);
    if (checks.length === 0) {
      await api.sendMessage(chatId, '📋 Sizda hali cheklar yo\'q.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎁 Chek yaratish', callback_data: 'cb:new' }],
            [{ text: '⬅️ Orqaga', callback_data: 'cb:home' }],
          ],
        },
      });
      return;
    }

    const lines = ['📋 Mening cheklarim (oxirgi 8 ta):', ''];
    const rows = [];

    for (const c of checks) {
      const rem = Math.max(0, c.totalClaims - c.claimedBy.length);
      const badge = c.status === 'active' ? '🟢' : c.status === 'completed' ? '✅' : '❌';
      lines.push(`${badge} ${c.amountPerClaim} ⭐ × ${c.totalClaims} | Qoldi: ${rem}/${c.totalClaims} | #${c.code}`);
      if (c.status === 'active' && rem > 0) {
        rows.push([
          { text: `📤 Ulashish (${c.amountPerClaim}⭐)`, switch_inline_query: c.code },
          { text: '❌ Bekor qilish', callback_data: `cb:cancel:${c.code}` },
        ]);
      }
    }

    rows.push([{ text: '⬅️ Orqaga', callback_data: 'cb:home' }]);
    await api.sendMessage(chatId, lines.join('\n'), {
      reply_markup: { inline_keyboard: rows },
    });
  }

  async function handleCheckClaim(query, code) {
    const res = store.claimCheck(code, query.from);
    if (!res.ok) {
      const msgMap = {
        not_found: '❌ Chek topilmadi.',
        already_claimed: '⚠️ Siz bu chekni allaqachon olgansiz!',
        completed: '😔 Bu chek allaqachon tugagan.',
        cancelled: '❌ Bu chek muallif tomonidan bekor qilingan.',
      };
      await safeAnswerCallback(query.id, {
        text: msgMap[res.reason] || '❌ Chekni olib bo\'lmadi.',
        show_alert: true,
      });
      if (res.check && (res.reason === 'completed' || res.reason === 'cancelled')) {
        const target = query.inline_message_id
          ? { inline_message_id: query.inline_message_id }
          : { chat_id: query.message.chat.id, message_id: query.message.message_id };
        await safeEdit(target, formatCheckText(res.check), checkMarkup(res.check));
      }
      return;
    }

    await safeAnswerCallback(query.id, {
      text: `🎉 +${res.amount} ⭐ hisobingizga qo'shildi!\nBalans: ${res.balance} ⭐`,
      show_alert: true,
    });

    const target = query.inline_message_id
      ? { inline_message_id: query.inline_message_id }
      : { chat_id: query.message.chat.id, message_id: query.message.message_id };
    await safeEdit(target, formatCheckText(res.check), checkMarkup(res.check));
  }

  async function handleInlineLazyClaim(query, parts) {
    // Format: cb:ic:<creatorId>:<amount>:<claims>:<nonce>
    const creatorId = Number(parts[2]);
    const amount = Number(parts[3]);
    const claims = Number(parts[4]);
    const nonce = parts[5];
    const checkCode = `in_${nonce}`;

    let existing = store.getCheck(checkCode);
    if (!existing) {
      const isAdmin = store.isAdmin(creatorId);
      const feeStars = isAdmin ? 0 : calcFee(claims);
      const creatorUser = store.getUser(creatorId) || { id: creatorId };
      const totalCost = amount * claims + feeStars;

      if (!isAdmin && store.getBalance(creatorId) < totalCost) {
        await safeAnswerCallback(query.id, {
          text: '⚠️ Chek muallifining balansi yetarli emas.',
          show_alert: true,
        });
        return;
      }

      // Create check with deterministic inline code so multiple clicks map to same check
      const created = store.createCheck({
        creator: creatorUser,
        creatorName: formatUserLabel(creatorUser),
        amountPerClaim: amount,
        totalClaims: claims,
        feeStars,
        chargeCreator: true,
      });

      if (!created.ok) {
        await safeAnswerCallback(query.id, {
          text: '❌ Chekni faollashtirib bo\'lmadi.',
          show_alert: true,
        });
        return;
      }

      // Re-key check under deterministic nonce code so future clicks reuse it
      const realCode = created.check.code;
      created.check.code = checkCode;
      created.check.id = checkCode;
      delete store.data.checks[realCode];
      store.data.checks[checkCode] = created.check;
      await store.flush();
      existing = created.check;
    }

    await handleCheckClaim(query, existing.code);
  }

  async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const user = msg.from;
    if (!user) return;
    store.touchUser(BOT_NAME, user);

    // Successful Stars Payment
    if (msg.successful_payment) {
      const sp = msg.successful_payment;
      const payload = String(sp.invoice_payload || '');
      const amount = Number(sp.total_amount || 0);
      const chargeId = sp.telegram_payment_charge_id || null;

      if (payload.startsWith('dep:')) {
        const [, creditStr] = payload.split(':');
        const creditStars = Number(creditStr) || amount;
        const realStars = Math.floor(amount * 0.85);
        store.addBalance(user, creditStars, {
          type: 'deposit',
          botName: BOT_NAME,
          ref: chargeId,
        });
        store.recordPaidUse(BOT_NAME, user, amount, { payload, chargeId, realStars });
        const newBal = store.getBalance(user.id);
        await api.sendMessage(
          chatId,
          `✅ Balans +${creditStars} ⭐ ga to'ldirildi!\n💳 Yangi balans: ${newBal} ⭐`,
          { reply_markup: mainMenuKeyboard(store.isAdmin(user)) }
        );
        return;
      }

      if (payload.startsWith('chk:')) {
        const [, amtStr, claimsStr] = payload.split(':');
        const checkAmount = Number(amtStr);
        const checkClaims = Number(claimsStr);
        const realStars = Math.floor(amount * 0.85);
        store.recordPaidUse(BOT_NAME, user, amount, { payload, chargeId, realStars });
        await createAndSendCheck(chatId, user, {
          amount: checkAmount,
          claims: checkClaims,
          paidDirectly: true,
        });
        return;
      }
      return;
    }

    const text = (msg.text || '').trim();
    if (!text) return;

    const [rawCmd, ...rest] = text.split(/\s+/);
    const cmd = rawCmd.split('@')[0].toLowerCase();
    const argText = rest.join(' ');

    if (cmd === '/start') {
      pendingInput.delete(user.id);
      if (argText.startsWith('c_')) {
        const code = argText.slice(2);
        const check = store.getCheck(code);
        if (check) {
          await api.sendMessage(chatId, formatCheckText(check), {
            reply_markup: checkMarkup(check),
          });
          return;
        }
      }
      await sendHome(chatId, user);
      return;
    }

    if (cmd === '/admin') {
      if (!store.isAdmin(user)) {
        await api.sendMessage(chatId, '⛔ Bu buyruq faqat admin (@hold) uchun.');
        return;
      }
      await api.sendMessage(chatId, formatAdminStats(store));
      return;
    }

    if (cmd === '/balance') {
      const bal = store.getBalance(user.id);
      await api.sendMessage(chatId, `💳 Balansingiz: ${bal} ⭐`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '💳 Balans to\'ldirish', callback_data: 'cb:deposit' }],
            [{ text: '🎁 Chek yaratish', callback_data: 'cb:new' }],
          ],
        },
      });
      return;
    }

    if (cmd === '/deposit') {
      const customCredit = Math.floor(Number(argText));
      if (argText && (!Number.isFinite(customCredit) || customCredit < MIN_STARS || customCredit > 100000)) {
        await api.sendMessage(chatId, `⚠️ Minimal to'ldirish summasi: ${MIN_STARS} ⭐`);
        return;
      }
      if (Number.isFinite(customCredit) && customCredit >= MIN_STARS && customCredit <= 100000) {
        const bundle = DEPOSIT_BUNDLES.find((b) => b.credit === customCredit);
        const payStars = bundle ? bundle.pay : Math.ceil(customCredit / 0.85) + 5;
        await api.sendInvoice({
          chat_id: chatId,
          title: `Balans +${customCredit} ⭐`,
          description: `Checkbot hisobiga +${customCredit} ⭐ qo'shish (to'lov: ${payStars} ⭐)`,
          payload: `dep:${customCredit}:${payStars}:${user.id}`,
          prices: [{ label: `+${customCredit} Stars`, amount: payStars }],
        });
        return;
      }
      await sendDepositOptions(chatId, user);
      return;
    }

    if (cmd === '/withdraw') {
      await sendWithdrawOptions(chatId, user);
      return;
    }

    if (cmd === '/mychecks') {
      await sendMyChecks(chatId, user);
      return;
    }

    if (cmd === '/check') {
      if (!argText) {
        await sendCheckCreationStep1(chatId, user);
        return;
      }
      const parsed = parseCheckArgs(argText);
      if (!parsed) {
        await api.sendMessage(
          chatId,
          `❗ Format: /check <summa> [soni] [izoh]\nMinimal summa: ${MIN_STARS} ⭐\nMasalan: /check 50 5 Bayram muborak!`
        );
        return;
      }
      await createAndSendCheck(chatId, user, parsed);
      return;
    }

    // Handle pending interactive input
    const state = pendingInput.get(user.id);
    if (state?.step === 'awaiting_custom_check') {
      const parsed = parseCheckArgs(text);
      if (!parsed) {
        await api.sendMessage(
          chatId,
          `❗ To'g'ri format kiriting (minimal ${MIN_STARS} ⭐): masalan 50 yoki 50 5`
        );
        return;
      }
      pendingInput.delete(user.id);
      await createAndSendCheck(chatId, user, parsed);
      return;
    }

    if (msg.chat.type === 'private') {
      const parsed = parseCheckArgs(text);
      if (parsed) {
        await createAndSendCheck(chatId, user, parsed);
      } else {
        await sendHome(chatId, user);
      }
    }
  }

  async function handleCallback(query) {
    const user = query.from;
    if (!user) return;
    store.touchUser(BOT_NAME, user);

    const data = String(query.data || '');
    const parts = data.split(':');
    const action = parts[1];
    const chatId = query.message?.chat?.id;

    if (action === 'claim') {
      await handleCheckClaim(query, parts[2]);
      return;
    }

    if (action === 'ic') {
      await handleInlineLazyClaim(query, parts);
      return;
    }

    if (action === 'home') {
      pendingInput.delete(user.id);
      await safeAnswerCallback(query.id);
      if (chatId) await sendHome(chatId, user);
      return;
    }

    if (action === 'new') {
      await safeAnswerCallback(query.id);
      if (chatId) await sendCheckCreationStep1(chatId, user);
      return;
    }

    if (action === 'amt') {
      const amount = Number(parts[2]);
      await safeAnswerCallback(query.id);
      if (!chatId) return;
      await api.sendMessage(
        chatId,
        `🎁 ${amount} ⭐ li chek — nechta kishi uchun?`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '1 kishi', callback_data: `cb:mk:${amount}:1` },
                { text: '3 kishi', callback_data: `cb:mk:${amount}:3` },
                { text: '5 kishi', callback_data: `cb:mk:${amount}:5` },
              ],
              [
                { text: '10 kishi', callback_data: `cb:mk:${amount}:10` },
                { text: '⬅️ Orqaga', callback_data: 'cb:new' },
              ],
            ],
          },
        }
      );
      return;
    }

    if (action === 'mk') {
      const amount = Number(parts[2]);
      const claims = Number(parts[3]);
      pendingInput.delete(user.id);
      await safeAnswerCallback(query.id);
      if (chatId) await createAndSendCheck(chatId, user, { amount, claims });
      return;
    }

    if (action === 'deposit') {
      await safeAnswerCallback(query.id);
      if (chatId) await sendDepositOptions(chatId, user);
      return;
    }

    if (action === 'dep') {
      const creditStars = Number(parts[2]);
      const payStars = Number(parts[3]) || (Math.ceil(creditStars / 0.85) + 5);
      await safeAnswerCallback(query.id);
      if (!chatId || !Number.isFinite(creditStars) || creditStars < MIN_STARS) return;
      await api.sendInvoice({
        chat_id: chatId,
        title: `Balans +${creditStars} ⭐`,
        description: `Checkbot hisobiga +${creditStars} ⭐ qo'shish (to'lov: ${payStars} ⭐)`,
        payload: `dep:${creditStars}:${payStars}:${user.id}`,
        prices: [{ label: `+${creditStars} Stars`, amount: payStars }],
      });
      return;
    }

    if (action === 'withdraw') {
      await safeAnswerCallback(query.id);
      if (chatId) await sendWithdrawOptions(chatId, user);
      return;
    }

    if (action === 'wd') {
      const giftId = Number(parts[2]);
      const gift = WITHDRAW_GIFTS.find((g) => g.id === giftId);
      if (!gift || !chatId) {
        await safeAnswerCallback(query.id);
        return;
      }

      const isAdmin = store.isAdmin(user);
      const costToCharge = isAdmin ? 0 : gift.botCost;

      if (costToCharge > 0) {
        const deduct = store.deductBalance(user, costToCharge, {
          type: 'gift_withdraw',
          botName: BOT_NAME,
          ref: `gift:${gift.id}`,
        });
        if (!deduct.ok) {
          await safeAnswerCallback(query.id, {
            text: `⚠️ Balans yetarli emas! Kerak: ${costToCharge} ⭐, Balans: ${deduct.balance} ⭐`,
            show_alert: true,
          });
          return;
        }
      }

      await safeAnswerCallback(query.id, { text: `🎁 ${gift.title} yuborilmoqda...` });

      try {
        await webApi.sendStoreGift({
          giftId: gift.id,
          userId: user.id,
          expectedPrice: gift.realPrice,
        });
        store.recordGiftWithdrawal(user.id, costToCharge, gift.realPrice, gift.title);
        const newBal = store.getBalance(user.id);
        await api.sendMessage(
          chatId,
          `🎉 ${gift.title} profilingizga yuborildi!\n💳 Qolgan balans: ${newBal} ⭐`,
          { reply_markup: mainMenuKeyboard(isAdmin) }
        );
      } catch (err) {
        logger.error(`sendStoreGift failed for user ${user.id} gift ${gift.id}: ${err.message}`);
        if (costToCharge > 0) {
          store.addBalance(user, costToCharge, {
            type: 'gift_refund',
            botName: BOT_NAME,
            ref: `gift:${gift.id}`,
          });
        }
        await api.sendMessage(
          chatId,
          `❌ Gift yuborib bo'lmadi (${err.message}).${costToCharge > 0 ? ` ${costToCharge} ⭐ balansingizga qaytarildi.` : ''}`
        );
      }
      return;
    }

    if (action === 'paychk') {
      const amount = Number(parts[2]);
      const claims = Number(parts[3]);
      const feeStars = store.isAdmin(user) ? 0 : calcFee(claims);
      const totalCost = amount * claims + feeStars;
      const invoiceStars = Math.ceil(totalCost / 0.85);
      await safeAnswerCallback(query.id);
      if (!chatId) return;
      await api.sendInvoice({
        chat_id: chatId,
        title: `Chek: ${amount} ⭐ × ${claims}`,
        description: `${amount} ⭐ dan ${claims} kishiga chek (+${feeStars} ⭐ xizmat haqi)`,
        payload: `chk:${amount}:${claims}:${user.id}`,
        prices: [{ label: `Chek (${invoiceStars} ⭐)`, amount: invoiceStars }],
      });
      return;
    }

    if (action === 'mychecks') {
      await safeAnswerCallback(query.id);
      if (chatId) await sendMyChecks(chatId, user);
      return;
    }

    if (action === 'cancel') {
      const code = parts[2];
      const res = store.cancelCheck(code, user.id);
      if (!res.ok) {
        await safeAnswerCallback(query.id, { text: '❌ Bekor qilib bo\'lmadi.', show_alert: true });
        return;
      }
      await safeAnswerCallback(query.id, {
        text: res.refund > 0
          ? `✅ Chek bekor qilindi. +${res.refund} ⭐ qaytarildi.`
          : '✅ Chek bekor qilindi.',
        show_alert: true,
      });
      if (chatId) await sendMyChecks(chatId, user);
      return;
    }

    if (action === 'help') {
      await safeAnswerCallback(query.id);
      if (!chatId) return;
      await api.sendMessage(
        chatId,
        [
          'ℹ️ @Checkbot qanday ishlaydi?',
          '',
          `1. Balans to'ldiring (/deposit, minimal ${MIN_STARS} ⭐) yoki to'g'ridan-to'g'ri Stars to'lang.`,
          '2. Chek yarating: /check 50 yoki /check 50 5',
          '3. Chekni guruhga yuboring yoki istalgan chatda @Checkbot 50 deb yozing.',
          '4. Har bir foydalanuvchi chekni faqat 1 marta ola oladi!',
        ].join('\n'),
        { reply_markup: { inline_keyboard: [[{ text: '⬅️ Orqaga', callback_data: 'cb:home' }]] } }
      );
      return;
    }

    if (action === 'admin') {
      if (!store.isAdmin(user)) {
        await safeAnswerCallback(query.id, { text: '⛔ Faqat admin uchun.', show_alert: true });
        return;
      }
      await safeAnswerCallback(query.id);
      if (chatId) await api.sendMessage(chatId, formatAdminStats(store));
      return;
    }

    await safeAnswerCallback(query.id);
  }

  async function handleInlineQuery(iq) {
    const user = iq.from;
    if (!user) return;
    store.touchUser(BOT_NAME, user);

    const q = (iq.query || '').trim();
    const results = [];

    // 1. Check if query matches an existing check code
    const byCode = q ? store.getCheck(q) : null;
    if (byCode && byCode.status === 'active') {
      const rem = Math.max(0, byCode.totalClaims - byCode.claimedBy.length);
      results.push({
        type: 'article',
        id: `existing_${byCode.code}`,
        title: `🎁 ${byCode.amountPerClaim} ⭐ Chek (${rem}/${byCode.totalClaims} qoldi)`,
        description: `Muallif: ${byCode.creatorName} — Ulashish uchun bosing`,
        input_message_content: {
          message_text: formatCheckText(byCode),
        },
        reply_markup: checkMarkup(byCode),
      });
    }

    // 2. Parse "<amount> [claims]" from query
    const parsed = parseCheckArgs(q);
    if (parsed) {
      const isAdmin = store.isAdmin(user);
      const fee = isAdmin ? 0 : calcFee(parsed.claims);
      const totalCost = parsed.amount * parsed.claims + fee;
      const balance = store.getBalance(user.id);
      const canAfford = isAdmin || balance >= totalCost;
      const nonce = crypto.randomBytes(4).toString('hex');

      const previewLines = [
        `🎁 Stars Chek — ${parsed.amount} ⭐`,
        `👤 Muallif: ${formatUserLabel(user)}`,
        `💰 Jami: ${parsed.amount * parsed.claims} ⭐ (${parsed.claims} kishi × ${parsed.amount} ⭐)`,
        `📊 Holat: 🟢 Faol (${parsed.claims}/${parsed.claims} ta qoldi)`,
      ];
      if (parsed.comment) previewLines.push(`💬 Izoh: ${parsed.comment}`);

      results.push({
        type: 'article',
        id: `new_${parsed.amount}_${parsed.claims}_${nonce}`,
        title: `🎁 ${parsed.amount} ⭐ chek (${parsed.claims} kishi)`,
        description: canAfford
          ? isAdmin
            ? `Admin: BEPUL — Yuborish uchun bosing`
            : `Narxi: ${totalCost} ⭐ (Balans: ${balance} ⭐)`
          : `⚠️ Balans yetarli emas (kerak: ${totalCost} ⭐, balans: ${balance} ⭐)`,
        input_message_content: {
          message_text: previewLines.join('\n'),
        },
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: `🎁 ${parsed.amount} ⭐ Olish (${parsed.claims}/${parsed.claims})`,
                callback_data: `cb:ic:${user.id}:${parsed.amount}:${parsed.claims}:${nonce}`,
              },
            ],
          ],
        },
      });
    }

    // 3. If query is empty, show user's active checks
    if (!q) {
      const activeChecks = store
        .getUserChecks(user.id)
        .filter((c) => c.status === 'active')
        .slice(0, 5);

      for (const c of activeChecks) {
        const rem = Math.max(0, c.totalClaims - c.claimedBy.length);
        results.push({
          type: 'article',
          id: `mine_${c.code}`,
          title: `🎁 ${c.amountPerClaim} ⭐ Chek (${rem}/${c.totalClaims} qoldi)`,
          description: `Kod: #${c.code} — Chatga yuborish`,
          input_message_content: {
            message_text: formatCheckText(c),
          },
          reply_markup: checkMarkup(c),
        });
      }

      if (results.length === 0) {
        results.push({
          type: 'article',
          id: 'hint_empty',
          title: '💡 Misol: @Checkbot 50 yoki @Checkbot 50 5',
          description: `Minimal summa: ${MIN_STARS} ⭐ — masalan 50 (1 kishi) yoki 50 5 (5 kishi)`,
          input_message_content: {
            message_text: '🎁 Stars chek yuborish uchun @Checkbot 50 deb yozing!',
          },
        });
      }
    } else if (!parsed && /^\d+/.test(q)) {
      results.push({
        type: 'article',
        id: 'hint_min',
        title: `⚠️ Minimal chek summasi: ${MIN_STARS} ⭐`,
        description: `Masalan: @Checkbot ${MIN_STARS} yoki @Checkbot ${MIN_STARS} 5`,
        input_message_content: {
          message_text: `🎁 Minimal chek summasi ${MIN_STARS} ⭐!`,
        },
      });
    }

    await api.answerInlineQuery(iq.id, results.slice(0, 20), {
      cache_time: 0,
      is_personal: true,
    });
  }

  async function handlePreCheckout(pcq) {
    try {
      await api.answerPreCheckoutQuery(pcq.id, true);
    } catch (err) {
      logger.error(`answerPreCheckoutQuery error: ${err.message}`);
    }
  }

  async function handleUpdate(update) {
    if (update.pre_checkout_query) {
      await handlePreCheckout(update.pre_checkout_query);
      return;
    }
    if (update.inline_query) {
      await handleInlineQuery(update.inline_query);
      return;
    }
    if (update.callback_query) {
      await handleCallback(update.callback_query);
      return;
    }
    if (update.message) {
      await handleMessage(update.message);
    }
  }

  return { handleUpdate, commands };
}
