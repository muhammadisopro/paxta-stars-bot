import sharp from 'sharp';

const BOT_NAME = 'pixelbot';
const PRICE_STARS = 50;
const FREE_LIMIT = 1;

const STYLES = {
  gold: {
    key: 'gold',
    label: '🥇 Pure Gold',
    badge: 'PURE GOLD',
    bg1: '#1A1305',
    bg2: '#3B2806',
    border1: '#FFF3B0',
    border2: '#FFD700',
    border3: '#B8860B',
    accent: '#FFE066',
    badgeBg: '#2B1D04',
    badgeText: '#FFD700',
  },
  onyx: {
    key: 'onyx',
    label: '🖤 Onyx Black',
    badge: 'ONYX BLACK',
    bg1: '#070709',
    bg2: '#16161D',
    border1: '#E2E8F0',
    border2: '#64748B',
    border3: '#1E293B',
    accent: '#CBD5E1',
    badgeBg: '#0F172A',
    badgeText: '#F8FAFC',
  },
  cyber: {
    key: 'cyber',
    label: '⚡ Cyberpunk Neon',
    badge: 'CYBERPUNK NEON',
    bg1: '#090218',
    bg2: '#1D0636',
    border1: '#00F5D4',
    border2: '#FF007F',
    border3: '#7B2CBF',
    accent: '#00F5D4',
    badgeBg: '#140429',
    badgeText: '#00F5D4',
  },
  emerald: {
    key: 'emerald',
    label: '💚 Royal Emerald',
    badge: 'ROYAL EMERALD',
    bg1: '#021A12',
    bg2: '#064E3B',
    border1: '#A7F3D0',
    border2: '#10B981',
    border3: '#047857',
    accent: '#34D399',
    badgeBg: '#022C22',
    badgeText: '#6EE7B7',
  },
};

// Stores last photo buffer or file_id per userId
const userPhotos = new Map();

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatUserTag(user) {
  if (!user) return 'PAXTA';
  if (user.username) return `@${user.username.replace(/^@/, '')}`;
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || `ID ${user.id}`;
}

function styleKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: STYLES.gold.label, callback_data: 'px:style:gold' },
        { text: STYLES.onyx.label, callback_data: 'px:style:onyx' },
      ],
      [
        { text: STYLES.cyber.label, callback_data: 'px:style:cyber' },
        { text: STYLES.emerald.label, callback_data: 'px:style:emerald' },
      ],
      [{ text: '🖼 Profil avatarimni olish', callback_data: 'px:avatar' }],
    ],
  };
}

function formatAdminStats(store) {
  const stats = store.getAdminStats(BOT_NAME);
  const b = stats.bots[BOT_NAME] || {};
  const lines = [
    '👑 @Pixelbot — Admin Panel (@hold)',
    '',
    `👥 Foydalanuvchilar: ${stats.totalUsers}`,
    `📨 Jami so'rovlar: ${b.totalRequests || 0}`,
    `🆓 Bepul sinovlar: ${b.freeUses || 0}`,
    `💎 Pullik rasmlar: ${b.paidUses || 0}`,
    `💰 Jami daromad: ${b.revenueStars || 0} ⭐`,
  ];

  if (stats.topUsers.length > 0) {
    lines.push('', '🏆 Top foydalanuvchilar:');
    for (const u of stats.topUsers.slice(0, 5)) {
      const label = u.username ? `@${u.username}` : u.first_name || `ID:${u.id}`;
      lines.push(`• ${label}: sarf ${u.totalStarsSpent} ⭐`);
    }
  }
  return lines.join('\n');
}

/**
 * Render a crisp 900x900 framed PNG with custom metallic/neon border and badge.
 */
async function renderStyledImage(photoBuffer, styleKey, user) {
  const s = STYLES[styleKey] || STYLES.gold;
  const size = 900;
  const innerSize = 740;
  const offset = (size - innerSize) / 2; // 80
  const userTag = escapeXml(formatUserTag(user).slice(0, 24));
  const badgeText = escapeXml(s.badge);

  // Prepare rounded inner photo
  const roundedMask = Buffer.from(
    `<svg width="${innerSize}" height="${innerSize}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${innerSize}" height="${innerSize}" rx="28" ry="28" fill="#ffffff"/>
    </svg>`
  );

  const innerPhoto = await sharp(photoBuffer)
    .rotate()
    .resize(innerSize, innerSize, { fit: 'cover', position: 'centre' })
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // Background + outer frame SVG
  const bgSvg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${s.bg1}"/>
          <stop offset="100%" stop-color="${s.bg2}"/>
        </linearGradient>
        <linearGradient id="frameGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${s.border1}"/>
          <stop offset="50%" stop-color="${s.border2}"/>
          <stop offset="100%" stop-color="${s.border3}"/>
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" fill="url(#bgGrad)"/>
      <rect x="28" y="28" width="${size - 56}" height="${size - 56}" rx="42" fill="none" stroke="url(#frameGrad)" stroke-width="6" opacity="0.9"/>
      <rect x="44" y="44" width="${size - 88}" height="${size - 88}" rx="34" fill="none" stroke="${s.accent}" stroke-width="1.5" opacity="0.4"/>
      <rect x="${offset - 6}" y="${offset - 6}" width="${innerSize + 12}" height="${innerSize + 12}" rx="32" fill="none" stroke="url(#frameGrad)" stroke-width="8"/>
    </svg>`
  );

  // Foreground overlay SVG (corner accents + top/bottom badges)
  const overlaySvg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <!-- Corner accents -->
      <path d="M 60 110 L 60 60 L 110 60" fill="none" stroke="${s.border1}" stroke-width="5" stroke-linecap="round"/>
      <path d="M 790 60 L 840 60 L 840 110" fill="none" stroke="${s.border1}" stroke-width="5" stroke-linecap="round"/>
      <path d="M 60 790 L 60 840 L 110 840" fill="none" stroke="${s.border1}" stroke-width="5" stroke-linecap="round"/>
      <path d="M 790 840 L 840 840 L 840 790" fill="none" stroke="${s.border1}" stroke-width="5" stroke-linecap="round"/>

      <!-- Top Style Badge -->
      <rect x="290" y="18" width="320" height="44" rx="22" fill="${s.badgeBg}" stroke="${s.border2}" stroke-width="2.5"/>
      <text x="450" y="46" font-family="DejaVu Sans, Arial, sans-serif" font-size="19" font-weight="bold" fill="${s.badgeText}" text-anchor="middle" letter-spacing="2.5">${badgeText}</text>

      <!-- Bottom User Badge -->
      <rect x="270" y="838" width="360" height="42" rx="21" fill="${s.badgeBg}" stroke="${s.border2}" stroke-width="2"/>
      <text x="450" y="865" font-family="DejaVu Sans, Arial, sans-serif" font-size="18" font-weight="bold" fill="${s.accent}" text-anchor="middle" letter-spacing="1">${userTag} • PIXELBOT</text>
    </svg>`
  );

  return sharp(bgSvg)
    .composite([
      { input: innerPhoto, left: offset, top: offset },
      { input: overlaySvg, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

export async function register({ api, webApi, store, botInfo, logger }) {
  const commands = [
    { command: 'start', description: 'Boshlash va uslublar' },
    { command: 'avatar', description: 'Profil avatarini bezash' },
    { command: 'admin', description: 'Admin statistika (@hold)' },
  ];

  async function safeAnswerCallback(id, opts = {}) {
    try {
      await api.answerCallbackQuery(id, opts);
    } catch (err) {
      logger.warn(`answerCallbackQuery failed: ${err.message}`);
    }
  }

  async function sendHome(chatId, user) {
    const isAdmin = store.isAdmin(user);
    const freeLeft = store.getFreeUsesRemaining(BOT_NAME, user.id, FREE_LIMIT);
    const statusLine = isAdmin
      ? '👑 Admin rejimi: barcha uslublar BEPUL!'
      : freeLeft > 0
        ? `🎁 Sizda ${freeLeft} ta bepul sinov bor! (Keyin ${PRICE_STARS} ⭐)`
        : `💎 Narx: har bir rasm uchun ${PRICE_STARS} ⭐`;

    const rows = [
      [{ text: '🖼 Profil avatarimni bezash', callback_data: 'px:avatar' }],
      [
        { text: STYLES.gold.label, callback_data: 'px:style:gold' },
        { text: STYLES.onyx.label, callback_data: 'px:style:onyx' },
      ],
      [
        { text: STYLES.cyber.label, callback_data: 'px:style:cyber' },
        { text: STYLES.emerald.label, callback_data: 'px:style:emerald' },
      ],
    ];
    if (isAdmin) {
      rows.push([{ text: '👑 Admin statistika', callback_data: 'px:admin' }]);
    }

    await api.sendMessage(
      chatId,
      [
        `🎨 @${botInfo.username || 'Pixelbot'} — Premium Rasm Ramkalari`,
        '',
        'Rasm yuboring yoki profil avataringizni tanlang, so\'ng 4 ta uslubdan birini bosing!',
        statusLine,
      ].join('\n'),
      { reply_markup: { inline_keyboard: rows } }
    );
  }

  async function loadUserAvatarBuffer(user) {
    const profile = await webApi.getUser(user.id);
    const avatarUrl =
      typeof profile?.avatar === 'string'
        ? profile.avatar
        : profile?.avatar?.url || profile?.avatar?.thumb || null;
    if (!avatarUrl) return null;
    return webApi.fetchBuffer(avatarUrl);
  }

  async function resolveUserPhotoBuffer(user) {
    const saved = userPhotos.get(user.id);
    if (saved?.buffer) return saved.buffer;
    if (saved?.fileId) {
      const buf = await api.downloadFile(saved.fileId);
      userPhotos.set(user.id, { buffer: buf, updatedAt: Date.now() });
      return buf;
    }
    return null;
  }

  async function processAndSendStyle(chatId, user, styleKey, { isPaid = false } = {}) {
    const style = STYLES[styleKey];
    if (!style) return;

    let photoBuf = await resolveUserPhotoBuffer(user);
    if (!photoBuf) {
      try {
        photoBuf = await loadUserAvatarBuffer(user);
      } catch (err) {
        logger.warn(`Avatar fallback failed for ${user.id}: ${err.message}`);
      }
    }

    if (!photoBuf) {
      await api.sendMessage(
        chatId,
        '📸 Avval rasm yuboring yoki profilingizga avatar o\'rnating!',
        { reply_markup: { inline_keyboard: [[{ text: '🖼 Profil avatarimni olish', callback_data: 'px:avatar' }]] } }
      );
      return;
    }

    const rendered = await renderStyledImage(photoBuf, styleKey, user);
    await api.sendPhoto(chatId, rendered, {
      filename: `pixelbot-${styleKey}.png`,
      caption: `✨ ${style.label} uslubi tayyor!\nYana boshqa uslub sinab ko'rasizmi?`,
      reply_markup: styleKeyboard(),
    });

    if (!isPaid && !store.isAdmin(user)) {
      store.consumeFreeUse(BOT_NAME, user, FREE_LIMIT);
    } else if (!isPaid && store.isAdmin(user)) {
      store.recordRequest(BOT_NAME, user);
    }
  }

  async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const user = msg.from;
    if (!user) return;
    store.touchUser(BOT_NAME, user);

    // Handle Stars payment completion
    if (msg.successful_payment) {
      const sp = msg.successful_payment;
      const payload = String(sp.invoice_payload || '');
      const stars = Number(sp.total_amount || PRICE_STARS);
      const chargeId = sp.telegram_payment_charge_id || null;

      if (payload.startsWith('px:')) {
        const [, styleKey] = payload.split(':');
        store.recordPaidUse(BOT_NAME, user, stars, { payload, chargeId });
        try {
          await processAndSendStyle(chatId, user, styleKey, { isPaid: true });
        } catch (err) {
          logger.error(`Render after payment failed: ${err.message}`);
          await api.sendMessage(chatId, '❌ Rasmni qayta ishlashda xatolik yuz berdi.');
        }
      }
      return;
    }

    // Handle incoming photo
    if (Array.isArray(msg.photo) && msg.photo.length > 0) {
      const best = msg.photo[msg.photo.length - 1];
      userPhotos.set(user.id, { fileId: best.file_id, updatedAt: Date.now() });

      const isAdmin = store.isAdmin(user);
      const freeLeft = store.getFreeUsesRemaining(BOT_NAME, user.id, FREE_LIMIT);
      const priceNote = isAdmin
        ? '👑 Admin: BEPUL'
        : freeLeft > 0
          ? '🎁 1-rasm BEPUL!'
          : `💎 Narxi: ${PRICE_STARS} ⭐`;

      await api.sendMessage(
        chatId,
        `📸 Rasm qabul qilindi! Endi uslub tanlang (${priceNote}):`,
        { reply_markup: styleKeyboard() }
      );
      return;
    }

    const text = (msg.text || '').trim();
    if (!text) return;
    const cmd = text.split(/\s+/)[0].split('@')[0].toLowerCase();

    if (cmd === '/start') {
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

    if (cmd === '/avatar') {
      try {
        const buf = await loadUserAvatarBuffer(user);
        if (!buf) {
          await api.sendMessage(chatId, '⚠️ Profilingizda avatar topilmadi. Oddiy rasm yuboring!');
          return;
        }
        userPhotos.set(user.id, { buffer: buf, updatedAt: Date.now() });
        await api.sendMessage(chatId, '🖼 Profil avataringiz olindi! Uslubni tanlang:', {
          reply_markup: styleKeyboard(),
        });
      } catch (err) {
        logger.warn(`/avatar failed: ${err.message}`);
        await api.sendMessage(chatId, '⚠️ Avatarni yuklab bo\'lmadi. Iltimos, rasm yuboring.');
      }
      return;
    }

    if (msg.chat.type === 'private') {
      await sendHome(chatId, user);
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

    if (action === 'admin') {
      if (!store.isAdmin(user)) {
        await safeAnswerCallback(query.id, { text: '⛔ Faqat admin uchun.', show_alert: true });
        return;
      }
      await safeAnswerCallback(query.id);
      if (chatId) await api.sendMessage(chatId, formatAdminStats(store));
      return;
    }

    if (action === 'avatar') {
      await safeAnswerCallback(query.id, { text: '🖼 Avatar yuklanmoqda...' });
      if (!chatId) return;
      try {
        const buf = await loadUserAvatarBuffer(user);
        if (!buf) {
          await api.sendMessage(chatId, '⚠️ Profilingizda avatar topilmadi. Oddiy rasm yuboring!');
          return;
        }
        userPhotos.set(user.id, { buffer: buf, updatedAt: Date.now() });
        await api.sendMessage(chatId, '🖼 Profil avataringiz tayyor! Uslubni tanlang:', {
          reply_markup: styleKeyboard(),
        });
      } catch (err) {
        logger.warn(`Avatar fetch failed: ${err.message}`);
        await api.sendMessage(chatId, '⚠️ Avatarni yuklab bo\'lmadi. Iltimos, rasm yuboring.');
      }
      return;
    }

    if (action === 'style') {
      const styleKey = parts[2];
      const style = STYLES[styleKey];
      if (!style || !chatId) {
        await safeAnswerCallback(query.id);
        return;
      }

      // Ensure user has a photo or avatar before charging
      let hasPhoto = Boolean(userPhotos.get(user.id));
      if (!hasPhoto) {
        try {
          const av = await loadUserAvatarBuffer(user);
          if (av) {
            userPhotos.set(user.id, { buffer: av, updatedAt: Date.now() });
            hasPhoto = true;
          }
        } catch {
          // ignore
        }
      }

      if (!hasPhoto) {
        await safeAnswerCallback(query.id, {
          text: '📸 Avval rasm yuboring!',
          show_alert: true,
        });
        return;
      }

      const isAdmin = store.isAdmin(user);
      const canFree = store.canUseFree(BOT_NAME, user.id, FREE_LIMIT);

      if (isAdmin || canFree) {
        await safeAnswerCallback(query.id, { text: `🎨 ${style.badge} tayyorlanmoqda...` });
        try {
          await processAndSendStyle(chatId, user, styleKey, { isPaid: false });
        } catch (err) {
          logger.error(`Style render error: ${err.message}`);
          await api.sendMessage(chatId, '❌ Rasmni bezashda xatolik yuz berdi.');
        }
        return;
      }

      // Paid flow (3 ⭐)
      await safeAnswerCallback(query.id);
      await api.sendInvoice({
        chat_id: chatId,
        title: `Pixelbot — ${style.badge}`,
        description: `Rasmingizni ${style.badge} ramkasi bilan bezash`,
        payload: `px:${styleKey}:${user.id}`,
        prices: [{ label: style.badge, amount: PRICE_STARS }],
      });
      return;
    }

    await safeAnswerCallback(query.id);
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
