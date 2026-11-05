import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { PaxtaClient } from './paxta-client.js';
import { extractPromoCode } from './promo-extractor.js';
import { TelegramNotifier } from './telegram-notifier.js';
import { MarketSniper } from './sniper.js';

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
let sniper = null;

const telegram = new TelegramNotifier();

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
      mode: 'AUTO_BUY_NFT_OPTION_1_WITH_TELEGRAM_REPORTS',
      active_accounts: clients.length,
      telegram_connected: !!telegram.chatId,
      monitored_user: config.targetUser.username,
      total_claimed_promos: claimedCodes.size,
      recent_claims: claimHistory.slice(-5),
      accounts_overview: clients.map(c => ({
        username: c.username,
        protected_base_stars: c.initialStars
      })),
      sniper: sniper ? {
        status: sniper.isRunning ? 'active' : 'idle',
        target_account: `@${sniper.client.username}`,
        max_nft_stars: sniper.maxNftPrice,
        max_auction_stars: sniper.maxAuctionPrice,
        scan_count: sniper.scanCount,
        sniped_count: sniper.snipedCount,
        last_scan: sniper.lastScanTime
      } : null,
      last_heartbeat: lastHeartbeat
    }, null, 2));
  });

  server.listen(port, () => {
    console.log(`🌐 [Render/Web] Auto-Buy NFT + Telegram dashboard active on port ${port} (URL: /health)`);
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
  console.log(`🥷 PaxtaGram Stars + NFT Auto-Buy + Telegram Reports...`);
  console.log(`======================================================`);
  console.log(`[${timestamp()}] ${accounts.length} ta akkaunt tizimga ulanmoqda...`);

  for (let idx = 0; idx < accounts.length; idx++) {
    const acc = accounts[idx];
    try {
      const client = new PaxtaClient(acc, config);
      await client.login();
      await client.resolveStarsBotChat();
      clients.push(client);
      console.log(`✅ [Akkaunt ${idx + 1}] @${client.username.padEnd(12)} -> Himoyalangan eski hisob: ${client.initialStars} ⭐`);
      await sleep(250 + Math.floor(Math.random() * 200));
    } catch (err) {
      console.error(`❌ [Akkaunt ${idx + 1}] @${acc.username.padEnd(12)} ulanmadi: ${err.message}`);
    }
  }

  if (clients.length === 0) {
    console.error(`[${timestamp()}] Birorta ham akkaunt ulanmadi.`);
    process.exit(1);
  }

  console.log(`\n🚀 ${clients.length} ta akkaunt tayyor!`);
  console.log(`📱 Telegram hisoboti yoqilgan: @ArklonBot orqali to'liq yuboriladi.\n`);
}

/**
 * SMART CLAIM + AUTO BUY NFT + TELEGRAM FULL REPORT
 */
async function claimForAllAccounts(code, sourceMessage) {
  if (isDispatching) return;
  isDispatching = true;
  claimedCodes.add(code.toUpperCase());

  console.log(`\n🔍 [${timestamp()}] TEKSHIRUV BOSHLANDI: "${code}"`);
  if (sourceMessage) {
    console.log(`📩 Manba xabar: "${sourceMessage.text}" (@${sourceMessage.sender?.username || 'umar'})`);
  }
  console.log(`🧪 1-akkaunt (@${clients[0].username}) orqali kod tekshirilmoqda...`);

  const canaryClient = clients[0];
  try {
    await canaryClient.sendToStarsBot(code);
  } catch (err) {
    console.error(`Canary akkauntda xato:`, err.message);
    isDispatching = false;
    return;
  }

  // StarsBot javobini kutish (~450ms)
  await sleep(450);

  let replyText = '';
  try {
    const msgs = await canaryClient.getMessages(canaryClient.starsBotChatId);
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg && (lastMsg.sender?.is_bot || lastMsg.sender?.id === config.starsBot.id)) {
      replyText = lastMsg.text || '';
    }
  } catch (err) {
    // ignore
  }

  const replyLower = replyText.toLowerCase();
  const isInvalid = replyLower.includes('такого промокода нет') || 
                    replyLower.includes('напишите код после команды');

  if (isInvalid) {
    console.log(`❌ "${code}" — bu oddiy so'z ekan, promokod emas (StarsBot: "${replyText.trim()}").`);
    console.log(`🛡️ Qolgan ${clients.length - 1} ta akkauntga yuborilmadi (Spam xavfi yo'q).\n`);
    isDispatching = false;
    return;
  }

  console.log(`🎉 PROMO-KOD HAQIQIY! StarsBot: "${replyText.split('\n')[0] || 'Faol'}"`);
  console.log(`⚡ Qolgan ${clients.length - 1} ta akkauntga yuborilmoqda va barchasida avtomatik NFT xarid qilinadi...\n`);

  const detailedAccountResults = [];

  // Canary account
  const canaryResultObj = {
    username: canaryClient.username,
    statusText: replyText.split('\n')[0] || 'Faol',
    initialStars: canaryClient.initialStars,
    bought: []
  };
  detailedAccountResults.push(canaryResultObj);

  // Canary xaridni 1.2s keyin bajaradi
  setTimeout(async () => {
    canaryResultObj.bought = await canaryClient.autoSpendPromoGains();
  }, 1200);

  const remainingClients = clients.slice(1);
  const remainingPromises = remainingClients.map(async (client, index) => {
    const delay = (index * 280) + Math.floor(Math.random() * 200);
    await sleep(delay);

    const accountObj = {
      username: client.username,
      statusText: 'Yuborildi',
      initialStars: client.initialStars,
      bought: []
    };
    detailedAccountResults.push(accountObj);

    try {
      const res = await client.sendToStarsBot(code);
      console.log(`✅ [${index + 2}/${clients.length}] @${client.username.padEnd(12)} -> +${delay}ms da kiritildi (Xabar ID: ${res.messageId})`);

      setTimeout(async () => {
        try {
          const bMsgs = await client.getMessages(client.starsBotChatId);
          const bLast = bMsgs[bMsgs.length - 1];
          if (bLast?.sender?.id === config.starsBot.id) {
            accountObj.statusText = bLast.text.split('\n')[0];
          }
        } catch {}

        accountObj.bought = await client.autoSpendPromoGains();
      }, 1600);

    } catch (err) {
      console.log(`❌ [${index + 2}/${clients.length}] @${client.username.padEnd(12)} -> Xato: ${err.message}`);
      accountObj.statusText = `Xato: ${err.message}`;
    }
  });

  await Promise.allSettled(remainingPromises);

  // 3.8 soniyadan keyin barcha xaridlar yakunlanadi va to'liq Telegram hisoboti yuboriladi
  setTimeout(async () => {
    console.log(`\n📨 Telegramga to'liq hisobot yuborilmoqda...`);
    const reportData = {
      code,
      time: timestamp(),
      source: {
        sender: sourceMessage?.sender?.username || 'umar',
        chat: 'Group (@group / @chat)',
        text: sourceMessage?.text || code
      },
      accounts: detailedAccountResults
    };

    claimHistory.push(reportData);
    await telegram.sendFullReport(reportData);
    console.log(`✅ Telegramga to'liq hisobot yuborildi!\n`);
    isDispatching = false;
  }, 3800);
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

  // Initialize Market & Auction Sniper on @relayer
  const relayerClient = clients.find(c => c.username.toLowerCase() === 'relayer');
  if (relayerClient) {
    sniper = new MarketSniper({
      paxtaClient: relayerClient,
      telegram,
      config: {
        maxNftPrice: 100,       // Max 100 stars for NFT gifts
        maxAuctionPrice: 1000   // Max 1000 stars for usernames & numbers
      }
    });
    try {
      await sniper.init();
      sniper.start();
      console.log(`🎯 Market & Auction Sniper muvaffaqiyatli ishga tushdi (@${relayerClient.username})!\n`);
    } catch (err) {
      console.error(`❌ Sniper ishga tushishida xatolik:`, err.message);
    }
  } else {
    console.warn(`⚠️ @relayer akkaunti topilmadi, Sniper ishga tushirilmadi.`);
  }

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
    if (sniper && sniper.auctionClient) {
      try {
        await sniper.auctionClient.authenticate();
      } catch (e) {}
    }
  }, 6 * 60 * 60 * 1000);
}

if (process.argv[1] && process.argv[1].endsWith('bot.js')) {
  main().catch(err => console.error('Asosiy xato:', err));
}
