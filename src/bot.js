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
const claimHistory = [];
let isDispatching = false;
let lastHeartbeat = new Date().toISOString();

function timestamp() {
  return new Date().toLocaleTimeString('uz-UZ', { hour12: false });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 1. Lightweight Web Dashboard for Render / Mobile Monitoring
function startHealthServer() {
  const port = process.env.PORT || 3000;
  const server = http.createServer((req, res) => {
    lastHeartbeat = new Date().toISOString();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: 'active',
      mode: 'STEALTH_ANTI_DETECTION',
      active_accounts: clients.length,
      monitored_user: config.targetUser.username,
      total_claimed_promos: claimedCodes.size,
      recent_claims: claimHistory.slice(-5),
      last_heartbeat: lastHeartbeat
    }, null, 2));
  });

  server.listen(port, () => {
    console.log(`🌐 [Render/Web] Stealth dashboard active on port ${port} (URL: /health)`);
  });

  // Self-ping to keep Render awake 24/7
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) {
    console.log(`🔄 Avtomatik self-ping yoqildi: ${renderUrl}/health (har 10 daqiqada)`);
    setInterval(async () => {
      try {
        await fetch(`${renderUrl}/health`);
      } catch (err) {
        // ignore
      }
    }, 10 * 60 * 1000);
  }
}

async function initClients() {
  console.log(`\n======================================================`);
  console.log(`🥷 PaxtaGram Stars Stealth Snatcher (Anti-Ban Rejimi)...`);
  console.log(`======================================================`);
  console.log(`[${timestamp()}] ${accounts.length} ta akkaunt tizimga ulanmoqda...`);

  // Random stagger on login as well to avoid burst logins
  for (let idx = 0; idx < accounts.length; idx++) {
    const acc = accounts[idx];
    try {
      const client = new PaxtaClient(acc, config);
      await client.login();
      await client.resolveStarsBotChat();
      clients.push(client);
      console.log(`✅ [Akkaunt ${idx + 1}] @${client.username.padEnd(12)} ulandi (StarsBot Chat ID: ${client.starsBotChatId})`);
      await sleep(300 + Math.floor(Math.random() * 200));
    } catch (err) {
      console.error(`❌ [Akkaunt ${idx + 1}] @${acc.username.padEnd(12)} ulanmadi: ${err.message}`);
    }
  }

  if (clients.length === 0) {
    console.error(`[${timestamp()}] Birorta ham akkaunt ulanmadi.`);
    process.exit(1);
  }

  console.log(`\n🚀 ${clients.length} ta akkaunt STEALTH rejimida tayyor!`);
  console.log(`🎯 Kuzatilayotgan foydalanuvchi: @${config.targetUser.username} (ID: ${config.targetUser.id})`);
  console.log(`📢 Kuzatilayotgan guruhlar: ${config.monitoredChats.map(c => `${c.title} [${c.id}]`).join(', ')}`);
  console.log(`🛡️ Xavfsizlik: Insoniy kechikish (Random Jitter) + Brauzer niqobi yoqilgan.\n`);
}

// Claim with humanized, realistic intervals between accounts so it looks 100% natural
async function claimForAllAccounts(code, sourceMessage) {
  if (isDispatching) return;
  isDispatching = true;
  claimedCodes.add(code.toUpperCase());

  console.log(`\n🔥 [${timestamp()}] YANGI PROMO-KOD ANIQLANDI: "${code}" !`);
  if (sourceMessage) {
    console.log(`📩 Manba xabar: "${sourceMessage.text}" (Yuboruvchi: @${sourceMessage.sender?.username || 'umar'})`);
  }
  console.log(`🥷 Akkauntlar insoniy kechikish bilan ketma-ket yuborishni boshlamoqda...\n`);

  const claimItem = {
    code,
    discovered_at: new Date().toISOString(),
    results: []
  };

  const dispatchPromises = clients.map(async (client, index) => {
    // Humanized jitter: Account 1 is fast, next accounts have natural intervals
    const delay = index === 0 
      ? 150 + Math.floor(Math.random() * 150) 
      : (index * 420) + Math.floor(Math.random() * 300);

    await sleep(delay);

    try {
      const res = await client.sendToStarsBot(code);
      console.log(`✅ [${index + 1}/${clients.length}] @${client.username.padEnd(12)} -> +${delay}ms da yuborildi (Xabar ID: ${res.messageId})`);
      claimItem.results.push({ username: client.username, ok: true, delayMs: delay });
    } catch (err) {
      console.log(`❌ [${index + 1}/${clients.length}] @${client.username.padEnd(12)} -> Xato: ${err.message}`);
      claimItem.results.push({ username: client.username, ok: false, error: err.message });
    }
  });

  await Promise.allSettled(dispatchPromises);
  claimHistory.push(claimItem);

  console.log(`\n🏁 Barcha akkauntlardan yuborish yakunlandi.`);
  isDispatching = false;
}

async function monitorTargetChats() {
  if (clients.length === 0 || isDispatching) return;
  const listenerClient = clients[0];

  for (const chatInfo of config.monitoredChats) {
    try {
      const messages = await listenerClient.getMessages(chatInfo.id);
      if (!Array.isArray(messages) || messages.length === 0) continue;

      if (seenMessageIds.size === 0) {
        for (const m of messages) seenMessageIds.add(m.id);
        console.log(`[${timestamp()}] ${chatInfo.title} guruhidagi ${messages.length} ta xabar o'qildi. Yangilari kutilmoqda...`);
        continue;
      }

      for (const msg of messages) {
        if (seenMessageIds.has(msg.id)) continue;
        seenMessageIds.add(msg.id);

        const senderId = msg.sender?.id || msg.user?.id;
        const senderUsername = (msg.sender?.username || msg.user?.username || '').toLowerCase();

        const isFromUmar = senderId === config.targetUser.id || senderUsername === config.targetUser.username.toLowerCase();

        if (isFromUmar) {
          const msgText = msg.text || '';
          console.log(`\n👀 [${timestamp()}] @umar yangi xabar yozdi: "${msgText}"`);

          const promo = extractPromoCode(msgText);
          if (promo && !claimedCodes.has(promo.toUpperCase())) {
            await claimForAllAccounts(promo, msg);
          }
        }
      }
    } catch (err) {
      // ignore temporary network drops
    }
  }
}

async function main() {
  startHealthServer();
  await initClients();

  // Natural poll interval: ~800-1100ms with jitter
  function scheduleNextPoll() {
    const interval = 850 + Math.floor(Math.random() * 250);
    setTimeout(async () => {
      await monitorTargetChats();
      scheduleNextPoll();
    }, interval);
  }
  scheduleNextPoll();

  // Session keep-alive every 6 hours
  setInterval(async () => {
    console.log(`[${timestamp()}] Sessiyalar yangilanmoqda...`);
    for (const c of clients) {
      try {
        await c.login();
      } catch (e) {
        // ignore
      }
    }
  }, 6 * 60 * 60 * 1000);
}

if (process.argv[1] && process.argv[1].endsWith('bot.js')) {
  main().catch(err => console.error('Asosiy xato:', err));
}
