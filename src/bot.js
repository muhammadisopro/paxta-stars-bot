import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';
import { PaxtaClient } from './paxta-client.js';
import { TelegramNotifier } from './telegram-notifier.js';

try { dns.setDefaultResultOrder('ipv4first'); } catch {}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const accountsPath = path.join(rootDir, 'accounts.json');
const configPath = path.join(rootDir, 'config.json');

// Support both environment variable (Render/Production) and accounts.json (Local)
let accounts = [];
if (process.env.PAXTA_ACCOUNTS) {
  try {
    accounts = JSON.parse(process.env.PAXTA_ACCOUNTS);
  } catch (e) {
    console.error('Failed to parse PAXTA_ACCOUNTS environment variable:', e.message);
  }
} else if (fs.existsSync(accountsPath)) {
  accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
}

// Ensure Milliybek is included
if (!accounts.find(a => a.username.toLowerCase() === 'milliybek')) {
  accounts.push({ username: "Milliybek", password: "YHT2NCsKPXgLE2d" });
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const CHAT_ID = 3000000001; // @group (https://paxta.online/chats/group)
const UMAR_ID = 2;          // https://paxta.online/u/umar (ID: 2)
const UMAR_USERNAME = 'umar';
const MOON_CHANNEL_ID = 2000001272; // Gift uchun (59 ta 333 ⭐ Victory Medallar)

const ignoredTokens = new Set([
  'STARSBOT', 'STARS_BOT', 'PAXTA', 'PAXTAGRAM', 'BOT', 'ADMIN',
  'SALOM', 'HAMMAGA', 'DIQQAT', 'GURUH', 'KOD', 'PROMO', 'PROMOCODE',
  'VIP', 'NEW', 'KANAL', 'GROUP', 'CHAT', 'ONLINE', 'HTTP', 'HTTPS',
  'WWW', 'TELEGRAM', 'LINK', 'UCHUN', 'HAMMA', 'KOMANDU', 'HA', 'YOQ',
  'RAHMAT', 'QALAYSIZ', 'BOLALAR', 'XAYRLI', 'KUN', 'TUN', 'OK', 'YAXSHI',
  'XA', 'GAP', 'YOQ', 'RAXMAT', 'QALE'
]);

const clients = [];
const seenMessageIds = new Set();
const claimedCodes = new Set();
const claimHistory = [];

let isDispatching = false;
let lastHeartbeat = new Date().toISOString();
let lastUmarMessage = null;
let umarLetters = [];
let umarLetterTimer = null;
let cachedChannelMedals = [];

const telegram = new TelegramNotifier();

function timestamp() {
  return new Date().toLocaleTimeString('uz-UZ', { hour12: false });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 1. Lightweight Web Dashboard for Render (Keep-Alive + Mobile Status)
function startHealthServer() {
  const port = process.env.PORT || 3000;
  const server = http.createServer((req, res) => {
    lastHeartbeat = new Date().toISOString();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: 'active',
      service: 'PaxtaGram @group Promo Snatcher (STRICT @umar ID: 2)',
      active_accounts: clients.length,
      telegram_connected: !!telegram.chatId,
      monitored_user: '@umar (ID: 2)',
      monitored_chat: '@group (3000000001)',
      poll_interval_ms: 350,
      total_claimed_promos: claimedCodes.size,
      recent_claims: claimHistory.slice(-5),
      current_letter_buffer: umarLetters.join(''),
      last_umar_message: lastUmarMessage,
      channel_medals_ready: cachedChannelMedals.length,
      accounts_overview: clients.map(c => ({
        username: c.username,
        protected_base_stars: c.initialStars
      })),
      last_heartbeat: lastHeartbeat
    }, null, 2));
  });

  server.listen(port, () => {
    console.log(`🌐 [Render/Web] Health dashboard faol port ${port} da (URL: /health)`);
  });

  // Self-ping every 9 minutes to keep Render free tier awake 24/7
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) {
    console.log(`🔄 Avtomatik self-ping yoqildi: ${renderUrl}/health (har 9 daqiqada)`);
    setInterval(async () => {
      try {
        await fetch(`${renderUrl}/health`);
      } catch (err) {
        // ignore
      }
    }, 9 * 60 * 1000);
  }
}

// 2. Initialize and warm all account sessions
async function initClients() {
  console.log(`\n======================================================`);
  console.log(`🥷 [${timestamp()}] ${accounts.length} ta akkaunt tizimga ulanmoqda...`);
  console.log(`======================================================`);

  for (let idx = 0; idx < accounts.length; idx++) {
    const acc = accounts[idx];
    try {
      const client = new PaxtaClient(acc, config);
      await client.login();
      await client.resolveStarsBotChat();
      clients.push(client);
      console.log(`✅ [${idx + 1}/${accounts.length}] @${client.username.padEnd(12)} -> Boshlang'ich: ${client.initialStars} ⭐`);
      await sleep(150);
    } catch (err) {
      console.error(`❌ [${idx + 1}/${accounts.length}] @${acc.username.padEnd(12)} ulanmadi: ${err.message}`);
    }
  }

  if (clients.length === 0) {
    console.error(`[${timestamp()}] Birorta ham akkaunt ulanmadi.`);
    process.exit(1);
  }

  // Pre-load active resale medals from channel 2000001272 (@moon's channel)
  const moonClient = clients.find(c => c.username.toLowerCase() === 'shade' || c.username.toLowerCase() === 'moon') || clients[0];
  try {
    const chRes = await moonClient.request(`/chats/${MOON_CHANNEL_ID}/gifts`);
    if (chRes.ok) {
      const chData = await chRes.json();
      const medals = (chData.gifts || []).filter(g => g.resale && (g.gift?.title || g.unique?.title || '').toLowerCase().includes('victory medal'));
      cachedChannelMedals = medals.map(m => ({
        id: m.id,
        number: m.unique?.number || m.number,
        price: m.resale.price
      }));
      console.log(`💎 Kanaldagi (${MOON_CHANNEL_ID}) 333 ⭐ lik Victory Medallar tayyorlandi: ${cachedChannelMedals.length} ta`);
    }
  } catch (err) {
    console.error(`Kanal medallarini yuklashda xato:`, err.message);
  }

  console.log(`\n🚀 ${clients.length} ta akkaunt va ${cachedChannelMedals.length} ta medal xaridga shay holatda!`);
  console.log(`📱 Telegram hisoboti yoqilgan: @ArklonBot orqali yuboriladi.\n`);
}

// 3. Ultra-Fast Parallel Promo Claim & Buy Channel Medals
async function executeUltraFastPromoClaim(promoCode, sourceMessage) {
  if (isDispatching) return;
  isDispatching = true;
  claimedCodes.add(promoCode.toUpperCase());

  const tStart = Date.now();
  console.log(`\n=============================================================`);
  console.log(`🚨 [${timestamp()}] PROMO-KOD ANIQLANDI: "${promoCode}"! (Manba: @umar)`);
  console.log(`⚡ Barcha ${clients.length} ta akkauntda bir millisekundda faollashtirish boshlandi...`);
  console.log(`=============================================================\n`);

  // Shared atomic queue for buying moon's 333 Stars medals
  const moonQueue = [...cachedChannelMedals];
  let moonQueueIdx = 0;

  // 1. Fire promo to ALL accounts in pure parallel
  const promoFiresPromise = Promise.all(clients.map(async client => {
    const t0 = Date.now();
    try {
      const sendRes = await client.sendMessage(client.starsBotChatId, `/promo ${promoCode}`);
      const lat = Date.now() - t0;
      return { client, username: client.username, ok: true, latency: lat, msgId: sendRes.message?.id };
    } catch (err) {
      return { client, username: client.username, ok: false, error: err.message, latency: Date.now() - t0 };
    }
  }));

  // 2. Fetch camouflage stranger items in parallel while promo is processing
  let strangerQueue = [];
  const camouflagePromise = (async () => {
    try {
      const sampleClient = clients.find(c => c.username.toLowerCase() !== 'relayer' && c.username.toLowerCase() !== 'shade') || clients[0];
      const mRes = await sampleClient.request('/market/17');
      if (mRes.ok) {
        const mData = await mRes.json();
        const moonIdSet = new Set(cachedChannelMedals.map(m => m.id));
        strangerQueue = (mData.items || [])
          .filter(item => !moonIdSet.has(item.id))
          .sort((a, b) => a.price - b.price)
          .slice(0, 3)
          .map(item => ({ id: item.id, number: item.number, price: item.price, isStranger: true }));
        console.log(`🎭 Kamuflyaj uchun bozordan ${strangerQueue.length} ta begona odamning arzon NFTsi tayyorlandi:`, strangerQueue.map(s => `#${s.number} (${s.price} ⭐)`));
      }
    } catch (err) {
      console.log(`⚠️ Stranger market yuklashda xato, to'g'ridan-to'g'ri moon giftlari ishlatiladi`);
    }
  })();

  function getNextItem(spendable) {
    if (strangerQueue.length > 0 && spendable >= strangerQueue[0].price) {
      return strangerQueue.shift();
    }
    if (moonQueueIdx < moonQueue.length) {
      return { ...moonQueue[moonQueueIdx++], isStranger: false };
    }
    return null;
  }

  const promoFires = await promoFiresPromise;
  await camouflagePromise;

  console.log(`🎯 [${timestamp()}] Barcha promolar yuborildi (O'rtacha kechikish: ${Math.round(promoFires.reduce((a, b) => a + b.latency, 0) / promoFires.length)}ms)!`);

  // Wait 450ms for StarsBot to credit Stars
  await sleep(450);

  let totalBought = 0;
  let totalStarsTransferred = 0;
  const detailedAccountResults = [];

  const buyPromises = promoFires.map(async entry => {
    const isRelayer = entry.username.toLowerCase() === 'relayer';
    const isMoon = entry.username.toLowerCase() === 'shade';

    if (!entry.ok) {
      console.log(`❌ @${entry.username.padEnd(10)}: yuborishda xato (${entry.error})`);
      detailedAccountResults.push({ username: entry.username, statusText: `Xato: ${entry.error}`, bought: [] });
      return;
    }

    // RELAYER IS 100% PROTECTED: STRICTLY NO SPENDING!
    if (isRelayer) {
      let balAfter = entry.client.initialStars;
      try {
        balAfter = await entry.client.getStarsBalance();
        const diff = balAfter - entry.client.initialStars;
        console.log(`🛡️ @relayer: ${diff > 0 ? '+' + diff : diff} ⭐ tushdi | Balans: ${balAfter} ⭐ (RELAYER STARS 100% TEGILMADI)`);
      } catch {}
      detailedAccountResults.push({ username: entry.username, statusText: 'Yuborildi (Relayer xavfsiz)', bought: [] });
      return;
    }

    // MOON IS RECIPIENT: STRICTLY NO BUYING!
    if (isMoon) {
      let balAfter = entry.client.initialStars;
      try {
        balAfter = await entry.client.getStarsBalance();
        const diff = balAfter - entry.client.initialStars;
        console.log(`👑 @moon   : ${diff > 0 ? '+' + diff : diff} ⭐ tushdi | Yangi balans: ${balAfter} ⭐`);
      } catch {}
      detailedAccountResults.push({ username: entry.username, statusText: 'Yuborildi (Qabul qiluvchi)', bought: [] });
      return;
    }

    // BUYER ACCOUNTS: Trump, Scaredcat, Zarqo, Brooo, Mmmmm, Aaaab, Milliybek
    let balAfter = entry.client.initialStars;
    try {
      balAfter = await entry.client.getStarsBalance();
    } catch {}

    const profit = balAfter - entry.client.initialStars;
    console.log(`🔹 @${entry.username.padEnd(10)}: ${profit > 0 ? '🎉 +' + profit + ' ⭐' : 'ℹ️ ' + profit + ' ⭐'} | Balans: ${balAfter} ⭐`);

    let spendable = profit > 0 ? profit : 0;
    if (spendable < 333 && balAfter >= 333 && profit > 0) {
      spendable = balAfter;
    }

    const accountBought = [];

    while (spendable >= 250) {
      const item = getNextItem(spendable);
      if (!item) break;

      try {
        const buyRes = await entry.client.request(`/user-gifts/${item.id}/buy`, {
          method: 'POST',
          body: { expected_price: item.price }
        });

        if (buyRes.ok) {
          totalBought++;
          spendable -= item.price;
          balAfter -= item.price;
          accountBought.push({ number: item.number, price: item.price, isStranger: !!item.isStranger });
          if (item.isStranger) {
            console.log(`   🎭 [KAMUFLYAJ] @${entry.username} BEGONA ODAMDAN NFT SOTIB OLDI! #${item.number} (${item.price} ⭐)`);
          } else {
            totalStarsTransferred += item.price;
            console.log(`   ⚡ @${entry.username} SOTIB OLDI! #${item.number} (${item.price} ⭐) -> @moon ga tushdi`);
          }
        } else {
          const txt = await buyRes.text();
          console.error(`   ⚠️ @${entry.username} xarid qila olmadi (#${item.number}): ${txt}`);
          break;
        }
      } catch (err) {
        console.error(`   ⚠️ Tarmoq xatosi: ${err.message}`);
        break;
      }
      await sleep(100);
    }

    detailedAccountResults.push({
      username: entry.username,
      statusText: `Foyda: +${profit} ⭐, Xarid: ${accountBought.length} ta`,
      bought: accountBought
    });
  });

  await Promise.all(buyPromises);

  const durationSec = ((Date.now() - tStart) / 1000).toFixed(2);
  console.log(`\n=============================================================`);
  console.log(`🏁 TEZKOR JARAYON YAKUNLANDI (${durationSec} soniyada):`);
  console.log(`   - Sotib olingan Victory Medallar: ${totalBought} ta`);
  console.log(`   - @moon ga o'tgan Stars: +${totalStarsTransferred} ⭐`);
  console.log(`   - @relayer Stars balansi: 100% tegilmadi va xavfsiz`);
  console.log(`=============================================================\n`);

  // Send full Telegram report
  try {
    const reportData = {
      code: promoCode,
      time: timestamp(),
      source: {
        sender: 'umar (ID: 2)',
        chat: '@group',
        text: sourceMessage?.text || promoCode
      },
      accounts: detailedAccountResults
    };
    claimHistory.push(reportData);
    await telegram.sendFullReport(reportData);
    console.log(`✅ Telegramga to'liq hisobot yuborildi!\n`);
  } catch (err) {
    console.error(`Telegram hisobotida xatolik:`, err.message);
  } finally {
    isDispatching = false;
  }
}

// 4. Promo extraction strictly tailored for @umar
function extractUmarPromo(text) {
  if (!text || typeof text !== 'string') return null;
  const raw = text.trim();

  // 1. /promo <CODE> or /promo<CODE>
  const pMatch = raw.match(/\/promo\s*([A-Za-z0-9_-]+)/i);
  if (pMatch) {
    return { code: pMatch[1], type: '/promo komandasi' };
  }

  // 2. kod:, promokod:, code: <CODE>
  const kMatch = raw.match(/(?:promo(?:kod)?|kod|code)[:\s=]+([A-Za-z0-9_-]+)/i);
  if (kMatch) {
    return { code: kMatch[1], type: 'kod prefiksi' };
  }

  // 3. Spaced letters (C - A - P, C.A.P, C A P, F - C - K - I - C - E)
  if (/^[A-Za-z0-9](?:\s*[-.,_ ]\s*[A-Za-z0-9]){1,12}$/.test(raw)) {
    const assembled = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (assembled.length >= 2 && !ignoredTokens.has(assembled)) {
      return { code: assembled, type: 'ajratilgan harflar' };
    }
  }

  // 4. Standalone uppercase token
  const words = raw.split(/\s+/);
  for (const w of words) {
    const cleanWord = w.replace(/[^A-Za-z0-9_-]/g, '');
    const up = cleanWord.toUpperCase();
    if (up.length >= 2 && up.length <= 25 && !ignoredTokens.has(up) && /[A-Z]/.test(up) && cleanWord === up) {
      return { code: up, type: 'Umar katta harflari' };
    }
  }

  // 5. Single letter (bitta-bitta harf)
  const singleChar = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (singleChar.length === 1) {
    return { letter: singleChar, type: 'bitta harf' };
  }

  return null;
}

// 5. Monitoring loop with strict filter for @umar
async function monitorTargetChats() {
  if (clients.length === 0 || isDispatching) return;
  const listenerClient = clients[0]; // @moon

  try {
    const res = await listenerClient.request(`/chats/${CHAT_ID}/messages?limit=25`);
    if (!res.ok) return;

    const data = await res.json();
    const messages = Array.isArray(data) ? data : data.messages || [];

    if (seenMessageIds.size === 0) {
      for (const m of messages) seenMessageIds.add(m.id);
      console.log(`📋 Guruhdagi mavjud ${messages.length} ta xabar o'qildi. Yangilari kutilmoqda...`);
      return;
    }

    for (const msg of messages) {
      if (seenMessageIds.has(msg.id)) continue;
      seenMessageIds.add(msg.id);

      const senderId = msg.sender?.id ?? msg.user?.id ?? msg.from?.id;
      const senderUsername = (msg.sender?.username ?? msg.user?.username ?? msg.from?.username ?? '').toLowerCase().replace(/^@/, '');

      // STRICT FILTER: FAQAT VA FAQAT @umar (ID: 2 yoki username: 'umar')
      const isUmar = senderId === UMAR_ID || senderUsername === UMAR_USERNAME;
      if (!isUmar) {
        continue; // Boshqa barcha odamlarning xabari butunlay e'tiborsiz qoldiriladi
      }

      const text = msg.text || '';
      lastUmarMessage = { id: msg.id, text, at: timestamp() };
      console.log(`\n👑👑👑 [${timestamp()}] @umar (ID: ${senderId}) YANGI XABAR YOZDI: "${text}" (Msg ID: ${msg.id})`);

      const parsed = extractUmarPromo(text);

      if (parsed?.code) {
        console.log(`🎯 [${timestamp()}] @umar xabaridan promokod topildi: "${parsed.code}" (${parsed.type})`);
        if (umarLetterTimer) clearTimeout(umarLetterTimer);
        umarLetters = [];
        await executeUltraFastPromoClaim(parsed.code, msg);
      } else if (parsed?.letter) {
        umarLetters.push(parsed.letter);
        const currentCombined = umarLetters.join('');
        console.log(`🔤 [${timestamp()}] @umar harf tashladi: "${parsed.letter}" | Yig'ilgan so'z: "${currentCombined}"`);

        if (umarLetterTimer) clearTimeout(umarLetterTimer);

        // Debounce: 1200ms ichida yangi harf kelmasa va 2+ ta harf bo'lsa, kod deb qabul qilamiz
        umarLetterTimer = setTimeout(async () => {
          if (umarLetters.length >= 2) {
            const combinedCode = umarLetters.join('');
            umarLetters = [];
            console.log(`⏱️ [${timestamp()}] @umar harf yuborishni tugatdi. Yig'ilgan so'z promokod: "${combinedCode}"`);
            await executeUltraFastPromoClaim(combinedCode, { text: combinedCode, sender: { id: UMAR_ID, username: UMAR_USERNAME } });
          }
        }, 1200);
      } else if (umarLetters.length >= 2) {
        // Agar Umar harflardan keyin oddiy gap yozsa, avvalgi yig'ilgan harflarni faollashtiramiz
        if (umarLetterTimer) clearTimeout(umarLetterTimer);
        const combinedCode = umarLetters.join('');
        umarLetters = [];
        console.log(`💡 [${timestamp()}] @umar oddiy xabarga o'tdi. Yig'ilgan harflar faollashtiriladi: "${combinedCode}"`);
        await executeUltraFastPromoClaim(combinedCode, { text: combinedCode, sender: { id: UMAR_ID, username: UMAR_USERNAME } });
      }
    }
  } catch (err) {
    // Vaqtinchalik tarmoq uzilishlarini e'tiborsiz qoldiramiz
  }
}

async function main() {
  startHealthServer();
  await initClients();

  // Natural high-speed poll loop: ~350ms
  function scheduleNextPoll() {
    setTimeout(async () => {
      await monitorTargetChats();
      scheduleNextPoll();
    }, 350);
  }
  scheduleNextPoll();

  // Re-login session keep-alive every 6 hours
  setInterval(async () => {
    console.log(`[${timestamp()}] Sessiyalar yangilanmoqda...`);
    for (const c of clients) {
      try {
        await c.login();
      } catch (e) {}
    }
  }, 6 * 60 * 60 * 1000);
}

if (process.argv[1] && process.argv[1].endsWith('bot.js')) {
  main().catch(err => console.error('Asosiy xato:', err));
}
