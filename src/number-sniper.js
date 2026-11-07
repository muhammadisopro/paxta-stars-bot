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
// Foydalanuvchi so'ragan raqamlar + 333 (hozirgi raqam 300+ bo'lgani uchun)
const TARGET_NUMBERS = [
  333, // 332 chiqqan zahoti darhol upg qilinadi
  444, // 443 chiqqan zahoti darhol upg qilinadi
  555, // 554 chiqqan zahoti darhol upg qilinadi
  777, // 776 chiqqan zahoti darhol upg qilinadi
  888, // 887 chiqqan zahoti darhol upg qilinadi
  999  // 998 chiqqan zahoti darhol upg qilinadi
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

  async refreshUnupgradedGifts() {
    const res = await this.client.request(`/users/${this.client.user.id}/gifts`);
    if (res.ok) {
      const d = await res.json();
      this.unupgradedGifts = (d.gifts || []).filter(g => g.gift?.id === GIFT_ID && !g.unique);
      console.log(`[${ts()}] 📦 Zaxirada UPGRADE qilinmagan Desk Calendar'lar: ${this.unupgradedGifts.length} ta`);
      if (this.unupgradedGifts.length === 0) {
        console.warn(`⚠️ DIQQAT: Zaxirangizda upgrade qilinmagan gift qolmadi!`);
      }
    }
  }

  async findCurrentHighestNumber() {
    console.log(`[${ts()}] 🔍 Hozirgi eng so'nggi chiqqan NFT raqami aniqlanmoqda...`);
    let low = 300;
    let high = 1000;
    let best = 300;

    // Tezkor tekshirish
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const res = await this.client.request(`/nft/${GIFT_SLUG}-${mid}`);
      if (res.ok) {
        best = mid;
        low = mid + 1; // Yuqoriroqni qidiramiz
      } else {
        high = mid - 1;
      }
      await sleep(40);
    }

    // Best atrofini aniqlashtirish
    for (let i = best; i <= best + 5; i++) {
      const res = await this.client.request(`/nft/${GIFT_SLUG}-${i}`);
      if (res.ok) {
        best = i;
      } else {
        break;
      }
      await sleep(30);
    }

    this.latestNumber = best;
    console.log(`[${ts()}] 📍 Hozirgi eng oxirgi chiqqan raqam: #${this.latestNumber}`);
    return best;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log(`\n⚡ [${ts()}] Sniper faollashtirildi! Tezlik: har 100-250 ms da skan...`);

    while (this.isRunning) {
      try {
        // Zaxirada hali gift bormi tekshiramiz
        if (this.unupgradedGifts.length === 0) {
          await this.refreshUnupgradedGifts();
          if (this.unupgradedGifts.length === 0) {
            console.log(`⚠️ Zaxirada gift yo'q, 5 soniyadan keyin qayta tekshiriladi...`);
            await sleep(5000);
            continue;
          }
        }

        // Qaysi nishon yaqinligini topamiz
        const nextTarget = TARGET_NUMBERS.find(n => n > this.latestNumber);
        if (!nextTarget) {
          console.log(`🏁 Barcha mo'ljaldagi raqamlar tugadi.`);
          break;
        }

        const triggerNumber = nextTarget - 1;
        const distance = nextTarget - this.latestNumber;

        // 1. Agar nishonga 2 ta yoki 1 ta qolgan bo'lsa (TURBO REJIM)
        if (distance <= 2) {
          process.stdout.write(`\r🚨🚨 [TURBO SNIPE] Nishon: #${nextTarget}! Trigger #${triggerNumber} kutilmoqda... (Hozir: #${this.latestNumber})   `);

          // Trigger raqamini tekshiramiz
          const trigRes = await this.client.request(`/nft/${GIFT_SLUG}-${triggerNumber}`);
          if (trigRes.ok) {
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
                  `🎯 Nishon: #${nextTarget}`
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
        }

        // 2. Normal rejim: keyingi raqam chiqqanini kuzatish (this.latestNumber + 1)
        const checkNum = this.latestNumber + 1;
        const res = await this.client.request(`/nft/${GIFT_SLUG}-${checkNum}`);
        if (res.ok) {
          this.latestNumber = checkNum;
          process.stdout.write(`\r[${ts()}] 📈 Yangi upgrade bo'ldi: #${this.latestNumber} | Keyingi nishon: #${nextTarget} (qoldi: ${nextTarget - this.latestNumber})   `);
        } else {
          // Kichik kutish
          await sleep(150);
        }

      } catch (err) {
        // xatolik bo'lsa biroz kutish
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
