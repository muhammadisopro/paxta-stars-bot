import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';
import { PaxtaClient } from './src/paxta-client.js';

try { dns.setDefaultResultOrder('ipv4first'); } catch {}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let config;
if (process.env.CONFIG_JSON) {
  config = JSON.parse(process.env.CONFIG_JSON);
} else {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
}

let accounts;
if (process.env.ACCOUNTS_JSON) {
  accounts = JSON.parse(process.env.ACCOUNTS_JSON);
} else {
  accounts = JSON.parse(fs.readFileSync(path.join(__dirname, 'accounts.json'), 'utf8'));
}

const CHAT_ID = 3000000001; // @group
const UMAR_ID = 2;          // @umar
const UMAR_USERNAME = 'umar';
const CRYSTAL_CHAT_ID = 2000001342; // Crystal channel

function ts() {
  return new Date().toLocaleTimeString('uz-UZ', { hour12: false });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// -------------------------------------------------------------
// Initialize Clients
// -------------------------------------------------------------
const clients = accounts.map(acc => new PaxtaClient(acc, config));
let listenerClient = null;
let relayerClient = null;

// -------------------------------------------------------------
// State
// -------------------------------------------------------------
let umarLetters = [];
let umarLetterTimer = null;
let umarBufferExpireTimer = null;
const claimedCodes = new Set();
let isClaiming = false;
let isUpgrading = false;
let upgradeOpened = false;
const upgradedGiftIds = new Set();

const ignoredTokens = new Set([
  'STARSBOT', 'STARS_BOT', 'PAXTA', 'PAXTAGRAM', 'BOT', 'ADMIN',
  'SALOM', 'HAMMAGA', 'DIQQAT', 'GURUH', 'KOD', 'PROMO', 'PROMOCODE',
  'VIP', 'NEW', 'KANAL', 'GROUP', 'CHAT', 'ONLINE', 'HTTP', 'HTTPS',
  'WWW', 'TELEGRAM', 'LINK', 'UCHUN', 'HAMMA', 'KOMANDU', 'HA', 'YOQ',
  'RAHMAT', 'QALAYSIZ', 'BOLALAR', 'XAYRLI', 'KUN', 'TUN', 'OK', 'YAXSHI',
  'XA', 'GAP', 'YOQ', 'RAXMAT', 'QALE', 'BOLADI', 'BOR', 'TEZ', 'ORADA', 'BUGUN', 'EMAS', 'DEDIMKU', 'KORISHAMIZ', 'BERAMAN'
]);

// -------------------------------------------------------------
// 1. PROMO CLAIM ENGINE (Ultra-Fast Parallel Across All Accounts)
// -------------------------------------------------------------
async function executePromoClaim(promoCode, sourceInfo = '') {
  const code = promoCode.trim().toUpperCase();
  if (!code || claimedCodes.has(code) || isClaiming) return;

  isClaiming = true;
  claimedCodes.add(code);

  console.log('\n' + '='.repeat(70));
  console.log(`🚨🚨🚨 [${ts()}] PROMO-KOD ANIQLANDI: "${code}"! 🚨🚨🚨`);
  console.log(`   📌 Manba: ${sourceInfo}`);
  console.log(`   ⚡ Barcha ${clients.length} ta akkauntga BIR VAQTDA yuborilmoqda...`);
  console.log('='.repeat(70) + '\n');

  const promises = clients.map(async (client, idx) => {
    const t0 = Date.now();
    try {
      if (!client.starsBotChatId) {
        await client.resolveStarsBotChat();
      }
      const res = await client.sendMessage(client.starsBotChatId, `/promo ${code}`);
      const latency = Date.now() - t0;
      console.log(`  ✅ [${idx + 1}/${clients.length}] @${client.username.padEnd(10)} -> Yuborildi (${latency}ms)`);
      return { username: client.username, ok: true, latency };
    } catch (err) {
      console.error(`  ❌ [${idx + 1}/${clients.length}] @${client.username.padEnd(10)} -> Xato: ${err.message}`);
      return { username: client.username, ok: false, error: err.message };
    }
  });

  await Promise.allSettled(promises);

  // Check replies after 700ms
  setTimeout(async () => {
    console.log(`\n📋 [${ts()}] StarsBot javoblari ("${code}"):`);
    for (const c of clients) {
      try {
        const msgs = await c.getMessages(c.starsBotChatId);
        const botMsg = msgs.slice().reverse().find(m => m.sender?.is_bot || m.sender?.id === 54);
        console.log(`  @${c.username.padEnd(10)}: ${botMsg?.text?.split('\n')[0] || 'Javob yo\'q'}`);
      } catch {}
    }
    console.log('\n');
    isClaiming = false;
  }, 700);
}

// -------------------------------------------------------------
// 2. PROMO PARSER FOR @UMAR
// -------------------------------------------------------------
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

  // 3. Spaced letters (C - A - P, C.A.P, C A P, I N P U T K E Y)
  if (/^[A-Za-z0-9](?:\s*[-.,_ ]\s*[A-Za-z0-9]){1,14}$/.test(raw)) {
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

  // 5. Single letter
  const singleChar = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (singleChar.length === 1) {
    return { letter: singleChar, type: 'bitta harf' };
  }

  return null;
}

// -------------------------------------------------------------
// 3. INPUT KEY UPGRADE ENGINE (1-O'RIN / PRIORITY #1)
// -------------------------------------------------------------
async function checkAndExecuteInputKeyUpgrade() {
  if (isUpgrading || !relayerClient) return;

  try {
    const checkRes = await relayerClient.request('/chats/' + CRYSTAL_CHAT_ID + '/gifts');
    if (!checkRes.ok) return;

    const data = await checkRes.json();
    const gifts = data.gifts || [];
    const inputKeys = gifts.filter(g => (g.gift?.title || g.title) === 'Input Key' && !g.unique && !upgradedGiftIds.has(g.id));

    if (inputKeys.length === 0) return;

    const canary = inputKeys[0];
    let probePassed = Boolean(canary.upgradable || canary.can_prepay_upgrade || canary.upgrade);

    // Direct test probe if not explicitly marked yet
    if (!probePassed && !upgradeOpened) {
      const probeRes = await relayerClient.request(`/user-gifts/${canary.id}/upgrade`, {
        method: 'POST',
        body: {}
      });
      if (probeRes.ok) {
        probePassed = true;
        upgradedGiftIds.add(canary.id);
        const upData = await probeRes.json().catch(() => ({}));
        console.log(`\n👑👑👑 [${ts()}] [1-O'RIN] ILK INPUT KEY NFT GA AYLANTIRILDI!`);
        console.log(`   Model: ${upData.gift?.unique?.model?.name || 'NFT'} | #${upData.gift?.number || canary.id}\n`);
      } else {
        const errJson = await probeRes.json().catch(() => ({}));
        if (errJson.code !== 'gift_not_upgradable' && probeRes.status !== 422) {
          probePassed = true;
        }
      }
    }

    if (probePassed || upgradeOpened) {
      upgradeOpened = true;
      isUpgrading = true;

      console.log('\n' + '='.repeat(70));
      console.log(`🚨🔥 [${ts()}] DIQQAT: INPUT KEY UPGRADE OCHILDI! 🔥🚨`);
      console.log(`👑 BARCHA INPUT KEY SOVG'ALARI TEZKOR NFT GA UPGRADE QILINMOQDA...`);
      console.log('='.repeat(70) + '\n');

      let relayerBal = await relayerClient.getStarsBalance();

      // Collect crystal gifts + relayer's personal inventory
      const ownRes = await relayerClient.request('/users/' + relayerClient.user.id + '/gifts');
      const ownGifts = (ownRes.ok ? (await ownRes.json()).gifts : []) || [];
      const ownKeys = ownGifts.filter(g => (g.gift?.title || g.title) === 'Input Key' && !g.unique && !upgradedGiftIds.has(g.id));

      const allTargets = [...inputKeys, ...ownKeys];
      console.log(`📦 Jami upgrade qilinadigan Input Key soni: ${allTargets.length} ta | Balans: ${relayerBal} ⭐`);

      // Parallel batching: 4 items at a time for ultra low serial numbers (#1, #2, #3...)
      const BATCH_SIZE = 4;
      let totalUpgraded = 0;

      for (let i = 0; i < allTargets.length; i += BATCH_SIZE) {
        if (relayerBal < 50) {
          console.log(`⚠️ Stars balansi tugadi (${relayerBal} ⭐). Upgrade to'xtatildi.`);
          break;
        }

        const batch = allTargets.slice(i, i + BATCH_SIZE).filter(k => !upgradedGiftIds.has(k.id));
        if (batch.length === 0) continue;

        const batchPromises = batch.map(async key => {
          try {
            const upRes = await relayerClient.request(`/user-gifts/${key.id}/upgrade`, {
              method: 'POST',
              body: {}
            });

            if (upRes.ok) {
              upgradedGiftIds.add(key.id);
              totalUpgraded++;
              const upData = await upRes.json().catch(() => ({}));
              const modelName = upData.gift?.unique?.model?.name || 'NFT';
              const number = upData.gift?.number || key.number || totalUpgraded;
              console.log(`  🎉 [${totalUpgraded}] Input Key #${number} -> ${modelName} (OK)`);
              return true;
            } else {
              const err = await upRes.text();
              console.error(`  ⚠️ ID: ${key.id} xato:`, err);
              return false;
            }
          } catch (err) {
            console.error(`  Tarmoq xatosi (ID: ${key.id}):`, err.message);
            return false;
          }
        });

        await Promise.allSettled(batchPromises);
        relayerBal = await relayerClient.getStarsBalance().catch(() => relayerBal);
        await sleep(50);
      }

      console.log(`\n🏁 [${ts()}] Input Key larni NFT ga aylantirish yakunlandi! Jami: ${totalUpgraded} ta.`);
      isUpgrading = false;
    }
  } catch (err) {
    // ignore polling hiccups
  }
}

// -------------------------------------------------------------
// 4. MAIN MONITORING LOOP
// -------------------------------------------------------------
async function main() {
  console.log('='.repeat(70));
  console.log(`🚀 [${ts()}] PAXTAGRAM ULTRA SNIPER & INPUT KEY UPGRADE TIZIMI`);
  console.log('='.repeat(70));

  // Initialize listener (@shade / @moon)
  listenerClient = clients[0];

  let prewarmed = null;
  const prewarmedPath = path.join(__dirname, '.prewarmed-sessions.json');
  if (process.env.PREWARMED_SESSIONS_JSON) {
    try { prewarmed = JSON.parse(process.env.PREWARMED_SESSIONS_JSON); } catch {}
  } else if (fs.existsSync(prewarmedPath)) {
    try { prewarmed = JSON.parse(fs.readFileSync(prewarmedPath, 'utf8')); } catch {}
  }

  // Pre-load cookies for all clients
  for (const c of clients) {
    const cached = prewarmed?.accounts?.find(a => a.username === c.username);
    if (cached) {
      cached.cookies.forEach(([k, v]) => c.jar.cookies.set(k, v));
      c.isLoggedIn = true;
    }
  }

  if (!listenerClient.isLoggedIn) {
    await listenerClient.login();
  }
  console.log(`✅ Guruh kuzatuvchisi ulandi: @${listenerClient.username}`);

  // Initialize @relayer
  relayerClient = clients.find(c => c.username === 'relayer') || clients[3];
  if (!relayerClient.isLoggedIn) {
    await relayerClient.login();
  }
  const relayerBal = await relayerClient.getStarsBalance();
  console.log(`✅ Upgrade ijrochisi ulandi: @${relayerClient.username} | Balans: ${relayerBal.toLocaleString()} ⭐`);

  // Pre-resolve StarsBot for all accounts
  console.log(`\n🔄 Akkauntlar sessiyalari tekshirilmoqda...`);
  for (const c of clients) {
    try {
      if (!c.isLoggedIn) await c.login();
      await c.resolveStarsBotChat();
    } catch {}
  }
  console.log(`✅ Barcha ${clients.length} ta akkaunt StarsBot ga shay holatga keltirildi!`);

  console.log(`\n👀 [${ts()}] MONITORING ISHGA TUSHDI:`);
  console.log(`   1. @group da FAQAT @umar (ID: 2) promokodlari poylanadi (Harfma-harf debounced)`);
  console.log(`   2. 👑 1-O'RIN: Input Key upgrade chiqishi bilan Crystal va inventardagilar zudlik bilan NFT ga aylantiriladi`);
  console.log('='.repeat(70) + '\n');

  const seenIds = new Set();
  try {
    const initRes = await listenerClient.request(`/chats/${CHAT_ID}/messages?limit=50`);
    if (initRes.ok) {
      const data = await initRes.json();
      const list = Array.isArray(data) ? data : data.messages || [];
      for (const m of list) seenIds.add(m.id);
      console.log(`📋 Guruhdagi mavjud ${seenIds.size} ta eski xabar o'qildi. Yangilari poylanmoqda...\n`);
    }
  } catch {}

  let pollCount = 0;
  let lastHeartbeat = Date.now();
  let lastUpgradeCheck = 0;
  let lastCanaryPostProbe = 0;

  while (true) {
    pollCount++;

    // A. PROMO CHECK (~350ms)
    try {
      const res = await listenerClient.request(`/chats/${CHAT_ID}/messages?limit=25`);
      if (res.ok) {
        const data = await res.json();
        const messages = Array.isArray(data) ? data : data.messages || [];

        for (const msg of messages) {
          if (seenIds.has(msg.id)) continue;
          seenIds.add(msg.id);

          const senderId = msg.sender?.id ?? msg.user?.id ?? msg.from?.id;
          const senderUsername = (msg.sender?.username ?? msg.user?.username ?? msg.from?.username ?? '').toLowerCase().replace(/^@/, '');

          // STRICT FILTER: FAQAT @umar (ID: 2)
          if (senderId !== UMAR_ID && senderUsername !== UMAR_USERNAME) {
            continue;
          }

          const text = msg.text || '';
          console.log(`\n👑👑👑 [${ts()}] @umar (ID: ${senderId}) YANGI XABAR YOZDI: "${text}" (Msg ID: ${msg.id})`);

          const parsed = extractUmarPromo(text);

          if (parsed?.code) {
            console.log(`🎯 [${ts()}] Promokod topildi: "${parsed.code}" (${parsed.type})`);
            if (umarLetterTimer) clearTimeout(umarLetterTimer);
            if (umarBufferExpireTimer) clearTimeout(umarBufferExpireTimer);
            umarLetters = [];
            await executePromoClaim(parsed.code, `@umar: "${text}"`);
          } else if (parsed?.letter) {
            umarLetters.push(parsed.letter);
            const currentCombined = umarLetters.join('');
            console.log(`🔤 [${ts()}] @umar harf tashladi: "${parsed.letter}" | Yig'ilgan so'z: "${currentCombined}"`);

            if (umarLetterTimer) clearTimeout(umarLetterTimer);
            if (umarBufferExpireTimer) clearTimeout(umarBufferExpireTimer);

            // Debounce 1500ms: agar 1.5s ichida yangi harf kelmasa, joriy yig'ilgan so'zni promokod deb yuboramiz
            umarLetterTimer = setTimeout(async () => {
              if (umarLetters.length >= 2) {
                const combinedCode = umarLetters.join('');
                console.log(`⏱️ [${ts()}] @umar harf yozishni to'xtatdi. Yig'ilgan kod: "${combinedCode}"`);
                await executePromoClaim(combinedCode, `Harflar yig'indisi: "${combinedCode}"`);
              }
            }, 1500);

            // Buffer cleanup: 8 soniya yangi harf kelmasa buferni tozalaymiz
            umarBufferExpireTimer = setTimeout(() => {
              if (umarLetters.length > 0) {
                console.log(`🧹 [${ts()}] Harflar buferi tozalandi (${umarLetters.join('')})`);
                umarLetters = [];
              }
            }, 8000);

          } else if (umarLetters.length >= 2) {
            // Agar Umar harflardan keyin boshqa gap yoki stiker yuborsa, harflar yakunlanganini bildirib darhol faollashtiramiz
            if (umarLetterTimer) clearTimeout(umarLetterTimer);
            if (umarBufferExpireTimer) clearTimeout(umarBufferExpireTimer);
            const combinedCode = umarLetters.join('');
            umarLetters = [];
            console.log(`💡 [${ts()}] @umar oddiy xabarga o'tdi. Yig'ilgan kod faollashtiriladi: "${combinedCode}"`);
            await executePromoClaim(combinedCode, `Harflar ketma-ketligi: "${combinedCode}"`);
          }
        }
      }
    } catch (err) {}

    // B. INPUT KEY UPGRADE PROBE (Har 1.5 soniyada)
    if (Date.now() - lastUpgradeCheck > 1500) {
      lastUpgradeCheck = Date.now();
      await checkAndExecuteInputKeyUpgrade();
    }

    // Heartbeat log every 30s
    if (Date.now() - lastHeartbeat > 30000) {
      lastHeartbeat = Date.now();
      const lettersStr = umarLetters.length > 0 ? ` [Umar harflari: "${umarLetters.join('')}"]` : '';
      console.log(`💓 [${ts()}] Poylovchi faol | Skanerlar: ${pollCount} | 👑 1-O'RIN Input Key UPG: Tayyor (Balans: ${relayerBal.toLocaleString()} ⭐)${lettersStr}`);
    }

    await sleep(350);
  }
}

main().catch(console.error);
