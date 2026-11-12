import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PaxtaClient } from './paxta-client.js';
import { TelegramNotifier } from './telegram-notifier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const configPath = path.join(rootDir, 'config.json');
const accountsPath = path.join(rootDir, 'accounts.json');

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
let accounts = [];
if (process.env.PAXTA_ACCOUNTS) {
  try { accounts = JSON.parse(process.env.PAXTA_ACCOUNTS); } catch {}
} else if (fs.existsSync(accountsPath)) {
  accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
}

const telegram = new TelegramNotifier();

// ========================================================
// 🎯 SNIPER MAQSADLI RAQAMLARI (TARGET NUMBERS)
// ========================================================
const TARGET_NUMBERS = [
  444, // 443 chiqishi bilan darhol upg qilinadi
  555, // 554 chiqishi bilan darhol upg qilinadi
  777, // 776 chiqishi bilan darhol upg qilinadi
  888, // 887 chiqishi bilan darhol upg qilinadi
  999  // 998 chiqishi bilan darhol upg qilinadi
];

const GIFT_SLUG = 'DeskCalendar';
const GIFT_ID = 16;

function ts() {
  return new Date().toLocaleTimeString('uz-UZ', { hour12: false });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class NumberSniper {
  constructor({ client, telegram }) {
    this.client = client;
    this.telegram = telegram;
    this.isRunning = false;
    this.latestNumber = 0;
    this.unupgradedGifts = [];
  }

  async init() {
    console.log('='.repeat(70));
    console.log(`🎯 [${ts()}] ULTRA-FAST NFT NUMBER SNIPER ISHGA TUSHDI`);
    console.log(`   🎯 Mo'ljal raqamlar: ${TARGET_NUMBERS.map(n => `#${n}`).join(', ')}`);
    console.log('='.repeat(70));

    if (!this.client.isLoggedIn) {
      await this.client.login();
    }

    console.log(`[${ts()}] 👤 Akkaunt: @${this.client.user?.username || this.client.username}`);
    await this.refreshUnupgradedGifts();
    await this.findCurrentHighestNumber();
  }

  /**
   * Kanallardagi va profildagi barcha upgrade qilinmagan giftlarni to'playdi
   */
  async refreshUnupgradedGifts() {
    this.unupgradedGifts = [];
    const sources = [
      { name: 'Kalendar (2000001271)', url: `/chats/2000001271/gifts` },
      { name: 'Gift uchun (2000001272)', url: `/chats/2000001272/gifts` },
      { name: 'Profil @moon', url: `/users/${this.client.user.id}/gifts` }
    ];

    for (const src of sources) {
      try {
        const res = await this.client.request(src.url);
        if (res.ok) {
          const d = await res.json();
          const unupg = (d.gifts || []).filter(g => g.gift?.id === GIFT_ID && !g.unique);
          this.unupgradedGifts.push(...unupg);
          console.log(`   📍 ${src.name}: ${unupg.length} ta upgradesiz Desk Calendar bor.`);
        }
      } catch {}
    }

    console.log(`[${ts()}] 📦 JAMI ZAXIRADA UPGRADEGA TAYYOR SOVG'ALAR: ${this.unupgradedGifts.length} ta`);
    if (this.unupgradedGifts.length === 0) {
      console.warn(`⚠️ DIQQAT: Zaxirangizda upgrade qilinmagan gift qolmadi!`);
    }
  }

  async checkIfNumberExists(num) {
    try {
      const res = await this.client.request(`/nft/${GIFT_SLUG}-${num}`, {
        headers: { 'Accept': 'application/json' }
      });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('json')) {
        const d = await res.json();
        return typeof d.gift?.number === 'number';
      }
    } catch {}
    return false;
  }

  async findCurrentHighestNumber() {
    console.log(`[${ts()}] 🔍 Hozirgi eng so'nggi chiqqan NFT raqami aniqlanmoqda...`);
    let best = 164; // biz bilgan baza

    // Probing from 200 upwards
    for (const probe of [200, 250, 300, 350, 400, 420, 430, 440, 444]) {
      const exists = await this.checkIfNumberExists(probe);
      if (exists) {
        best = probe;
      } else {
        break;
      }
      await sleep(100);
    }

    // Best atrofini aniqlashtirish
    for (let i = best; i <= best + 15; i++) {
      const exists = await this.checkIfNumberExists(i);
      if (exists) {
        best = i;
      } else {
        break;
      }
      await sleep(50);
    }

    this.latestNumber = best;
    console.log(`[${ts()}] 📍 Hozirgi eng oxirgi tasdiqlangan raqam: #${this.latestNumber}`);
    return best;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log(`\n⚡ [${ts()}] Sniper faollashtirildi! Har bir nishon monitoringda...\n`);

    while (this.isRunning) {
      try {
        if (this.unupgradedGifts.length === 0) {
          await this.refreshUnupgradedGifts();
          if (this.unupgradedGifts.length === 0) {
            console.log(`⚠️ Zaxirada gift yo'q, 5 soniyadan keyin qayta tekshiriladi...`);
            await sleep(5000);
            continue;
          }
        }

        const nextTarget = TARGET_NUMBERS.find(n => n > this.latestNumber);
        if (!nextTarget) {
          console.log(`🏁 Barcha mo'ljaldagi raqamlar tugadi.`);
          break;
        }

        const triggerNumber = nextTarget - 1;
        const distance = nextTarget - this.latestNumber;

        // 1. TURBO REJIM: Agar nishonga 2 ta yoki 1 ta qolgan bo'lsa
        if (distance <= 2) {
          process.stdout.write(`\r🚨🚨 [TURBO SNIPE] Nishon: #${nextTarget}! Trigger #${triggerNumber} kutilmoqda... (Hozir: #${this.latestNumber})   `);

          const trigExists = await this.checkIfNumberExists(triggerNumber);
          if (trigExists) {
            console.log(`\n\n🎯🎯🎯 [TRIGGER URILDI!] #${triggerNumber} chiqdi! DARHOL #${nextTarget} UCHUN UPGRADE! 🎯🎯🎯`);
            
            const candidate = this.unupgradedGifts.shift();
            const startTime = Date.now();
            const upRes = await this.client.request(`/user-gifts/${candidate.id}/upgrade`, {
              method: 'POST',
              body: {}
            });
            const latency = Date.now() - startTime;

            if (upRes.ok) {
              const upData = await upRes.json();
              const wonNum = upData.gift?.number;
              const model = upData.gift?.unique?.model?.name;
              console.log(`\n🎉🎉🎉 [SNIPE MUVAFFAQIYAT!] Sizga tushgan raqam: #${wonNum} ("${model}")! (Tezlik: ${latency}ms)`);

              if (this.telegram && this.telegram.sendMessage) {
                await this.telegram.sendMessage(
                  `🎯 <b>NFT NUMBER SNIPER NATIJASI!</b>\n\n` +
                  `🏆 Sizga tushgan raqam: <b>#${wonNum}</b>\n` +
                  `🎨 Model: <b>${model}</b>\n` +
                  `⚡ Tezlik: ${latency} ms\n` +
                  `🎯 Mo'ljal: #${nextTarget}`
                ).catch(() => {});
              }
            } else {
              const err = await upRes.text();
              console.error(`❌ Upgrade xatosi:`, err);
            }

            this.latestNumber = nextTarget;
            await this.refreshUnupgradedGifts();
            await sleep(1000);
            continue;
          }

          await sleep(100);
          continue;
        }

        // 2. Normal rejim: keyingi raqam chiqqanini kuzatish
        const checkNum = this.latestNumber + 1;
        const exists = await this.checkIfNumberExists(checkNum);
        if (exists) {
          this.latestNumber = checkNum;
          process.stdout.write(`\r[${ts()}] 📈 Yangi upgrade bo'ldi: #${this.latestNumber} | Keyingi nishon: #${nextTarget} (qoldi: ${nextTarget - this.latestNumber})   `);
        } else {
          await sleep(250);
        }

      } catch (err) {
        await sleep(500);
      }
    }
  }

  stop() {
    this.isRunning = false;
  }
}

// Standalone ishga tushirish
async function main() {
  const client = new PaxtaClient(accounts[0], config);
  const sniper = new NumberSniper({ client, telegram });
  await sniper.init();
  await sniper.start();
}

main().catch(console.error);
