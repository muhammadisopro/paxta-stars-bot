import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { PaxtaClient } from './paxta-client.js';
import { extractPromoCode } from './promo-extractor.js';

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

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const clients = [];
const seenMessageIds = new Set();
const claimedCodes = new Set();
let isDispatching = false;
let lastHeartbeat = new Date().toISOString();

function timestamp() {
  return new Date().toLocaleTimeString('uz-UZ', { hour12: false });
}

// 1. Lightweight HTTP Health Check Server for Render / UptimeRobot
function startHealthServer() {
  const port = process.env.PORT || 3000;
  const server = http.createServer((req, res) => {
    lastHeartbeat = new Date().toISOString();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'PaxtaGram Stars Promo Snatcher',
      active_accounts: clients.length,
      monitored_user: config.targetUser.username,
      claimed_codes_count: claimedCodes.size,
      last_heartbeat: lastHeartbeat
    }, null, 2));
  });

  server.listen(port, () => {
    console.log(`🌐 [Render/Web] Health server listening on port ${port} (URL: /health)`);
  });

  // Self-ping to prevent Render from idling/sleeping
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) {
    console.log(`🔄 Avtomatik self-ping yoqildi: ${renderUrl}/health (har 10 daqiqada)`);
    setInterval(async () => {
      try {
        await fetch(`${renderUrl}/health`);
        console.log(`[${timestamp()}] ⏰ Self-ping muvaffaqiyatli bajarildi (Render uyg'oq holda saqlanmoqda).`);
      } catch (err) {
        // ignore
      }
    }, 10 * 60 * 1000);
  }
}

async function initClients() {
  console.log(`\n======================================================`);
  console.log(`⚡ PaxtaGram Stars Promo Snatcher ishga tushmoqda...`);
  console.log(`======================================================`);
  console.log(`[${timestamp()}] ${accounts.length} ta akkaunt avtorizatsiyadan o'tkazilmoqda...`);

  const loginPromises = accounts.map(async (acc) => {
    const client = new PaxtaClient(acc, config);
    await client.login();
    await client.resolveStarsBotChat();
    await client.resolveShadeChat();
    return client;
  });

  const results = await Promise.allSettled(loginPromises);
  results.forEach((res, idx) => {
    const acc = accounts[idx];
    if (res.status === 'fulfilled') {
      const c = res.value;
      clients.push(c);
      console.log(`✅ [Akkaunt ${idx + 1}] @${c.username.padEnd(12)} -> StarsBot ID: ${c.starsBotChatId} | Shade Chat ID: ${c.shadeChatId || 'Self'}`);
    } else {
      console.error(`❌ [Akkaunt ${idx + 1}] @${acc.username.padEnd(12)} ulanmadi: ${res.reason.message}`);
    }
  });

  if (clients.length === 0) {
    console.error(`[${timestamp()}] Birorta ham akkaunt ulanmadi. Iltimos accounts.json ni tekshiring.`);
    process.exit(1);
  }

  console.log(`\n🚀 ${clients.length} ta akkaunt 100% tayyor holatda!`);
  console.log(`🎯 Kuzatilayotgan foydalanuvchi: @${config.targetUser.username} (ID: ${config.targetUser.id})`);
  console.log(`📢 Kuzatilayotgan guruhlar: ${config.monitoredChats.map(c => `${c.title} [${c.id}]`).join(', ')}`);
  console.log(`🤖 Maqsadli bot: @${config.starsBot.username}`);
  console.log(`⏱️ Monitoring tezligi: har ${config.pollIntervalMs} ms da\n`);
}

async function claimForAllAccounts(code, sourceMessage) {
  if (isDispatching) return;
  isDispatching = true;
  claimedCodes.add(code.toUpperCase());

  console.log(`\n🔥 [${timestamp()}] YANGI PROMO-KOD ANIQLANDI: "${code}" !`);
  if (sourceMessage) {
    console.log(`📩 Manba xabar: "${sourceMessage.text}" (Yuboruvchi: @${sourceMessage.sender?.username || 'umar'})`);
  }
  console.log(`⚡ ${clients.length} ta akkauntning barchasidan birdaniga yuborilmoqda (/promo ${code})...\n`);

  const startTime = Date.now();
  const promises = clients.map(client => client.sendToStarsBot(code));
  const results = await Promise.allSettled(promises);
  const totalDuration = Date.now() - startTime;

  console.log(`------------------------------------------------------`);
  console.log(`🏁 Yuborish yakunlandi (${totalDuration} ms ichida barchasiga yuborildi):`);
  console.log(`------------------------------------------------------`);

  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    const client = clients[i];
    if (res.status === 'fulfilled') {
      console.log(`✅ @${client.username.padEnd(12)} -> Xabar ID: ${res.value.messageId} | Tezlik: ${res.value.latencyMs} ms`);
    } else {
      console.log(`❌ @${client.username.padEnd(12)} -> Xato: ${res.reason?.message || res.reason}`);
    }
  }

  // Check StarsBot replies after 1.5 seconds and report to @shade from each account!
  setTimeout(async () => {
    console.log(`\n📊 [${timestamp()}] StarsBot javoblari olinmoqda va @shade ga hisobot yuborilmoqda:`);
    for (const client of clients) {
      try {
        const msgs = await client.getMessages(client.starsBotChatId);
        const lastMsg = msgs[msgs.length - 1];
        let replyText = '';
        if (lastMsg && (lastMsg.sender?.is_bot || lastMsg.sender?.id === config.starsBot.id)) {
          replyText = lastMsg.text;
          const firstLine = replyText.split('\n')[0];
          console.log(`🤖 @${client.username.padEnd(12)}: ${firstLine}`);
        }

        // Send report directly to @shade from this account's own name
        if (client.username.toLowerCase() !== 'shade') {
          await client.sendReportToShade(code, replyText);
          console.log(`📨 @${client.username.padEnd(12)} -> @shade ga hisobot jo'natdi.`);
        }
      } catch (err) {
        console.error(`@${client.username} hisobot jo'natishda xato:`, err.message);
      }
    }
    console.log(`------------------------------------------------------\n`);
    isDispatching = false;
  }, 1800);
}

async function monitorTargetChats() {
  if (clients.length === 0) return;
  const listenerClient = clients[0]; // Primary monitoring account

  for (const chatInfo of config.monitoredChats) {
    try {
      const messages = await listenerClient.getMessages(chatInfo.id);
      if (!Array.isArray(messages) || messages.length === 0) continue;

      // On initial start, populate seenMessageIds so historical messages aren't re-processed
      if (seenMessageIds.size === 0) {
        for (const m of messages) {
          seenMessageIds.add(m.id);
        }
        console.log(`[${timestamp()}] ${chatInfo.title} guruhidagi oldingi ${messages.length} ta xabar belgilandi. Yangilari kutilmoqda...`);
        continue;
      }

      for (const msg of messages) {
        if (seenMessageIds.has(msg.id)) continue;
        seenMessageIds.add(msg.id);

        const senderId = msg.sender?.id || msg.user?.id;
        const senderUsername = (msg.sender?.username || msg.user?.username || '').toLowerCase();

        // Check if message is from target user (@umar)
        const isFromUmar = senderId === config.targetUser.id || senderUsername === config.targetUser.username.toLowerCase();

        if (isFromUmar) {
          const msgText = msg.text || '';
          console.log(`\n👀 [${timestamp()}] @umar yangi xabar yozdi: "${msgText}"`);

          const promo = extractPromoCode(msgText);
          if (promo && !claimedCodes.has(promo.toUpperCase())) {
            await claimForAllAccounts(promo, msg);
          } else if (promo && claimedCodes.has(promo.toUpperCase())) {
            console.log(`ℹ️ "${promo}" kodi allaqachon faollashtirilgan.`);
          } else {
            console.log(`ℹ️ Xabarda promo-kod topilmadi.`);
          }
        }
      }
    } catch (err) {
      // In case of network blip, continue
    }
  }
}

async function main() {
  startHealthServer();
  await initClients();

  // Run the monitoring loop at high frequency
  setInterval(monitorTargetChats, config.pollIntervalMs);

  // Keep alive & prevent token expiration: re-login every 6 hours
  setInterval(async () => {
    console.log(`[${timestamp()}] Sessiyalar yangilanmoqda...`);
    for (const c of clients) {
      try {
        await c.login();
      } catch (e) {
        console.error(`@${c.username} sessiyani yangilashda xato:`, e.message);
      }
    }
  }, 6 * 60 * 60 * 1000);
}

if (process.argv[1] && process.argv[1].endsWith('bot.js')) {
  main().catch(err => console.error('Asosiy xato:', err));
}
