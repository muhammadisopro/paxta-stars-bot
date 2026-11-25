import crypto from 'node:crypto';

const BOT_NAME = 'soatbot';
const TIMER_STARS = 50;

const NEW_YEAR_2027_MS = Date.parse('2027-01-01T00:00:00+05:00');
const UZ_MONTHS = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
];
const UZ_DAYS = [
  'Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba',
];

const customTimers = new Map();

function getTashkentParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const uzDate = new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+05:00`);
  return {
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    day: Number(parts.day),
    monthName: UZ_MONTHS[Number(parts.month) - 1],
    year: Number(parts.year),
    weekday: UZ_DAYS[uzDate.getDay()],
  };
}

function formatCountdown(targetMs) {
  const diff = Math.max(0, targetMs - Date.now());
  if (diff === 0) return '🎉 Vaqt tugadi!';
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return `${days} kun ${String(hours).padStart(2, '0')} soat ${String(mins).padStart(2, '0')} daqiqa ${String(secs).padStart(2, '0')} soniya`;
}

function formatWorldTimes() {
  const zones = [
    ['🇺🇿 Toshkent', 'Asia/Tashkent'],
    ['🇹🇷 Istanbul', 'Europe/Istanbul'],
    ['🇦🇪 Dubay', 'Asia/Dubai'],
    ['🇬🇧 London', 'Europe/London'],
    ['🇺🇸 Nyu-York', 'America/New_York'],
  ];
  const lines = ['🌍 Dunyo soatlari (hozir):', ''];
  for (const [label, tz] of zones) {
    const t = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date());
    lines.push(`${label}: ${t}`);
  }
  return lines.join('\n');
}

function formatTimeCard() {
  const tk = getTashkentParts();
  return [
    '🕒 O\'zbekiston Vaqti (Asia/Tashkent)',
    '',
    `⏰ Soat: ${tk.time}`,
    `📅 Sana: ${tk.day} ${tk.monthName} ${tk.year}, ${tk.weekday}`,
    `🎄 Yangi Yil 2027 gacha: ${formatCountdown(NEW_YEAR_2027_MS)}`,
  ].join('\n');
}

function formatTimerCard(t) {
  return [
    `⏱ Taymer: ${t.title}`,
    '',
    `⏳ Qoldi: ${formatCountdown(t.targetMs)}`,
    `👤 Muallif: ${t.ownerName}`,
  ].join('\n');
}

function parseTimerArgs(text) {
  const parts = String(text || '').trim().split(/\s+/);
  const durRaw = parts[0] || '1h';
  const title = parts.slice(1).join(' ').slice(0, 60) || 'Maxsus Taymer';
  const m = durRaw.match(/^(\d+)(m|min|h|soat|d|kun)$/i);
  let ms = 3600 * 1000;
  if (m) {
    const val = Number(m[1]);
    const unit = m[2].toLowerCase();
    if (unit === 'm' || unit === 'min') ms = val * 60 * 1000;
    else if (unit === 'h' || unit === 'soat') ms = val * 3600 * 1000;
    else if (unit === 'd' || unit === 'kun') ms = val * 86400 * 1000;
  }
  return { ms: Math.min(ms, 365 * 86400 * 1000), title };
}

function mainKeyboard(isAdmin) {
  const rows = [
    [
      { text: '🔄 Yangilash', callback_data: 'st:refresh' },
      { text: '🌍 Dunyo soatlari', callback_data: 'st:world' },
    ],
    [
      { text: '⏱ Maxsus taymer (50 ⭐)', callback_data: 'st:timer' },
    ],
  ];
  if (isAdmin) {
    rows.push([{ text: '👑 Admin statistika', callback_data: 'st:admin' }]);
  }
  return { inline_keyboard: rows };
}

function formatAdminStats(store) {
  const stats = store.getAdminStats(BOT_NAME);
  const b = stats.bots[BOT_NAME] || {};
  return [
    '👑 @Soat_bot — Admin Panel (@hold)',
    '',
    `👥 Foydalanuvchilar: ${stats.totalUsers}`,
    `📨 So'rovlar: ${b.totalRequests || 0}`,
    `⏱ Faol taymerlar: ${customTimers.size}`,
    `💎 Pullik taymerlar: ${b.paidUses || 0}`,
    `💰 Gross daromad: ${b.revenueStars || 0} ⭐`,
  ].join('\n');
}

export async function register({ api, store, botInfo, logger }) {
  const commands = [
    { command: 'start', description: 'O\'zbekiston vaqti va Yangi Yil' },
    { command: 'time', description: 'Jonli soat va dunyo vaqtlari' },
    { command: 'timer', description: 'Maxsus taymer yaratish (50 ⭐)' },
    { command: 'admin', description: 'Admin statistika (@hold)' },
  ];

  async function safeAnswerCallback(id, opts = {}) {
    try {
      await api.answerCallbackQuery(id, opts);
    } catch (err) {
      logger.warn(`answerCallbackQuery failed: ${err.message}`);
    }
  }

  async function createAndSendTimer(chatId, user, { ms, title }) {
    const id = crypto.randomBytes(4).toString('hex');
    const timer = {
      id,
      title,
      targetMs: Date.now() + ms,
      ownerId: user.id,
      ownerName: user.username ? `@${user.username}` : user.first_name || `ID:${user.id}`,
    };
    customTimers.set(id, timer);
    await api.sendMessage(chatId, formatTimerCard(timer), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Vaqtni yangilash', callback_data: `st:tref:${id}` }],
          [{ text: '📤 Guruhga ulashish', switch_inline_query: `timer:${id}` }],
        ],
      },
    });
  }

  async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const user = msg.from;
    if (!user) return;
    store.touchUser(BOT_NAME, user);

    if (msg.successful_payment) {
      const sp = msg.successful_payment;
      const payload = String(sp.invoice_payload || '');
      const stars = Number(sp.total_amount || TIMER_STARS);
      store.recordPaidUse(BOT_NAME, user, stars, {
        payload,
        chargeId: sp.telegram_payment_charge_id,
      });
      const [, , msStr, ...titleParts] = payload.split(':');
      await createAndSendTimer(chatId, user, {
        ms: Number(msStr) || 3600 * 1000,
        title: titleParts.join(':') || 'Maxsus Taymer',
      });
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

    if (cmd === '/timer') {
      const parsed = parseTimerArgs(argText);
      if (store.isAdmin(user)) {
        store.recordRequest(BOT_NAME, user);
        await createAndSendTimer(chatId, user, parsed);
        return;
      }
      await api.sendInvoice({
        chat_id: chatId,
        title: `Maxsus Taymer: ${parsed.title.slice(0, 20)}`,
        description: 'Guruh yoki kanal uchun maxsus taymer yaratish',
        payload: `st_tm:${user.id}:${parsed.ms}:${parsed.title.slice(0, 40)}`,
        prices: [{ label: 'Maxsus taymer (50 ⭐)', amount: TIMER_STARS }],
      });
      return;
    }

    if (cmd === '/start' || cmd === '/time' || cmd === '/newyear') {
      store.recordRequest(BOT_NAME, user);
      await api.sendMessage(chatId, formatTimeCard(), {
        reply_markup: mainKeyboard(store.isAdmin(user)),
      });
      return;
    }

    if (msg.chat.type === 'private') {
      store.recordRequest(BOT_NAME, user);
      await api.sendMessage(chatId, formatTimeCard(), {
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
      await safeAnswerCallback(query.id);
      if (chatId && query.message?.message_id) {
        try {
          await api.editMessageText({
            chat_id: chatId,
            message_id: query.message.message_id,
            text: formatTimeCard(),
            reply_markup: mainKeyboard(store.isAdmin(user)),
          });
        } catch {
          // ignore not modified
        }
      }
      return;
    }

    if (action === 'world') {
      await safeAnswerCallback(query.id);
      if (chatId) {
        await api.sendMessage(chatId, formatWorldTimes(), {
          reply_markup: mainKeyboard(store.isAdmin(user)),
        });
      }
      return;
    }

    if (action === 'timer') {
      await safeAnswerCallback(query.id);
      if (!chatId) return;
      if (store.isAdmin(user)) {
        await createAndSendTimer(chatId, user, { ms: 3600 * 1000, title: '1 Soatlik Taymer' });
        return;
      }
      await api.sendInvoice({
        chat_id: chatId,
        title: 'Maxsus Taymer (1 soat)',
        description: 'Guruh yoki kanal uchun jonli taymer yaratish (/timer 30m Nom)',
        payload: `st_tm:${user.id}:${3600 * 1000}:Maxsus Taymer`,
        prices: [{ label: 'Maxsus taymer (50 ⭐)', amount: TIMER_STARS }],
      });
      return;
    }

    if (action === 'tref') {
      const id = parts[2];
      const timer = customTimers.get(id);
      if (!timer) {
        await safeAnswerCallback(query.id, { text: '❌ Taymer topilmadi.', show_alert: true });
        return;
      }
      await safeAnswerCallback(query.id);
      const target = query.inline_message_id
        ? { inline_message_id: query.inline_message_id }
        : { chat_id: chatId, message_id: query.message?.message_id };
      try {
        await api.editMessageText({
          ...target,
          text: formatTimerCard(timer),
          reply_markup: {
            inline_keyboard: [[{ text: '🔄 Vaqtni yangilash', callback_data: `st:tref:${id}` }]],
          },
        });
      } catch {
        // ignore
      }
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
    const results = [];

    if (q.startsWith('timer:')) {
      const id = q.slice(6);
      const timer = customTimers.get(id);
      if (timer) {
        results.push({
          type: 'article',
          id: `tm_${id}`,
          title: `⏱ ${timer.title}`,
          description: formatCountdown(timer.targetMs),
          input_message_content: { message_text: formatTimerCard(timer) },
          reply_markup: {
            inline_keyboard: [[{ text: '🔄 Vaqtni yangilash', callback_data: `st:tref:${id}` }]],
          },
        });
      }
    }

    const tk = getTashkentParts();
    results.push({
      type: 'article',
      id: 'tashkent_now',
      title: `🕒 Toshkent vaqti: ${tk.time}`,
      description: `${tk.day} ${tk.monthName} • Yangi Yil 2027 gacha: ${formatCountdown(NEW_YEAR_2027_MS)}`,
      input_message_content: { message_text: formatTimeCard() },
    });

    await api.answerInlineQuery(iq.id, results, { cache_time: 0 });
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
