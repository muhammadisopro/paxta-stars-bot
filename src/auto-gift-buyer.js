import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PaxtaClient } from './paxta-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// ==========================================
// ⚙️ SOZLAMALAR (CONFIGURATION)
// ==========================================
export const DEFAULT_GIFT_CONFIG = {
  // Maqsadli kanallar (navbatma-navbat 50/50 taqsimlanadi):
  channels: [
    { id: 2000001272, name: 'Gift uchun' },
    { id: 2000001271, name: 'Kalendar' }
  ],

  // Sovg'aning maksimal xarid narxi (500 Stars gacha):
  maxGiftPrice: 500,

  // Hisobda qolishi shart bo'lgan minimal yulduzlar miqdori (40,000 Stars):
  minBalanceReserve: 40000,

  // Upgrade ga ruxsat berish (Birinchi o'rindagi ustuvorlik):
  autoUpgradePriority: true,

  // Do'kon va inventarni tekshirish tezligi (har 500 ms):
  pollIntervalMs: 500
};

function ts() {
  return new Date().toLocaleTimeString('uz-UZ', { hour12: false });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class AutoGiftBuyer {
  constructor({ client, telegram = null, config = {} }) {
    this.client = client;
    this.telegram = telegram;
    this.config = { ...DEFAULT_GIFT_CONFIG, ...config };

    this.isRunning = false;
    this.balance = 0;
    this.knownGiftIds = new Set();
    this.alreadyUpgraded = new Set();
    this.notUpgradableYet = new Set();
    this.purchaseCount = {
      [this.config.channels[0].id]: 0,
      [this.config.channels[1].id]: 0
    };
    this.totalUpgraded = 0;
    this.lastAction = 'Tayyorlanmoqda';
    this.lastScanTime = null;
    this.scanCount = 0;
    this.nextChannelIndex = 0;
  }

  async init() {
    console.log('='.repeat(70));
    console.log(`🚀 [${ts()}] PaxtaGram Rasmiy Sovg'a Xaridi va 1-O'RIN UPGRADE Tizimi`);
    console.log('='.repeat(70));

    if (!this.client.isLoggedIn) {
      console.log(`[${ts()}] 🔐 Akkauntga kirish: @${this.client.username}...`);
      await this.client.login();
    }

    this.balance = await this.client.getStarsBalance();
    console.log(`[${ts()}] ✅ Muvaffaqiyatli ulandi!`);
    console.log(`     👤 Akkaunt: @${this.client.user?.username || this.client.username}`);
    console.log(`     ⭐ Hozirgi balans: ${this.balance.toLocaleString()} Stars`);
    console.log(`     🔒 Zaxira chegarasi: ${this.config.minBalanceReserve.toLocaleString()} Stars (40k doim saqlanadi)`);
    console.log(`     💰 Sarflash mumkin: ${Math.max(0, this.balance - this.config.minBalanceReserve).toLocaleString()} Stars`);
    console.log(`     🎯 Maqsadli kanallar: ${this.config.channels.map(c => `${c.name} (${c.id})`).join(' va ')}`);
    console.log(`     🏷 Sovg'a narxi: <= ${this.config.maxGiftPrice} Stars`);
    console.log(`     👑 1-O'rindagi vazifa: UPGRADE qilish imkoni chiqishi bilan birinchi bo'lib UPG qilish`);
    console.log('='.repeat(70));

    // Dastlabki do'kondagi sovg'alarni saqlash
    const initialGiftsRes = await this.client.request('/gifts');
    if (initialGiftsRes.ok) {
      const initialData = await initialGiftsRes.json();
      this.knownGiftIds = new Set((initialData.gifts || []).map(g => g.id));
      console.log(`[${ts()}] 📦 Hozirgi do'konda ${this.knownGiftIds.size} ta sovg'a ro'yxatga olindi.`);
    }

    // 1-O'rinda hozirgi mavjud sovg'alarni upgrade qilishni tekshirish
    await this.processPriorityUpgrades();
  }

  /**
   * 👑 1-O'RIN: Kanallardagi va profildagi sovg'alarni tekshirib,
   * agar upgrade ochilgan bo'lsa, zudlik bilan NFT ga upgrade qilish.
   */
  async processPriorityUpgrades() {
    const sources = [
      { type: 'channel', id: this.config.channels[0].id, name: this.config.channels[0].name, url: `/chats/${this.config.channels[0].id}/gifts` },
      { type: 'channel', id: this.config.channels[1].id, name: this.config.channels[1].name, url: `/chats/${this.config.channels[1].id}/gifts` },
      { type: 'user', id: this.client.user?.id, name: `@${this.client.user?.username || this.client.username}`, url: `/users/${this.client.user?.id}/gifts` }
    ];

    for (const src of sources) {
      if (!src.id) continue;
      try {
        const res = await this.client.request(src.url);
        if (!res.ok) continue;
        const data = await res.json();
        const gifts = data.gifts || [];

        for (const ug of gifts) {
          if (ug.unique || this.alreadyUpgraded.has(ug.id)) {
            this.alreadyUpgraded.add(ug.id);
            continue;
          }

          if (this.notUpgradableYet.has(ug.id)) continue;

          const isCandidate = ug.upgradable || ug.can_prepay_upgrade || (ug.gift?.supply && !ug.unique);
          if (!isCandidate) continue;

          const upCost = ug.upgrade?.price || ug.prepay_price || 0;

          if (this.balance - upCost < this.config.minBalanceReserve) {
            console.log(`[${ts()}] ⚠️ Upgrade to'xtatildi: 40,000 ⭐ zaxira saqlanishi shart (Balans: ${this.balance} ⭐).`);
            return;
          }

          console.log(`\n⚡ [${ts()}] [1-O'RIN - UPGRADE PRIORITY] Sovg'a upgrade qilinmoqda!`);
          console.log(`     🎁 Sovg'a: "${ug.gift?.title || ug.id}" (ID: ${ug.id}) | Joylashuvi: ${src.name}`);
          console.log(`     💎 Upgrade narxi: ${upCost} ⭐`);

          const upRes = await this.client.request(`/user-gifts/${ug.id}/upgrade`, {
            method: 'POST',
            body: {}
          });

          if (upRes.ok) {
            this.balance -= upCost;
            this.totalUpgraded++;
            this.alreadyUpgraded.add(ug.id);
            const upData = await upRes.json().catch(() => ({}));
            const modelName = upData.gift?.unique?.model?.name || 'Unikal Model';
            this.lastAction = `Upgrade qilindi: ${ug.gift?.title || ug.id} -> ${modelName}`;
            console.log(`👑 [${ts()}] MUVAFFAQIYAT! Sovg'a 1-O'RINDA NFT GA UPGRADE BO'LDI!`);
            console.log(`     🎉 Model: ${modelName}`);
            console.log(`     ⭐ Yangi balans: ${this.balance.toLocaleString()} Stars\n`);

            if (this.telegram && this.telegram.sendMessage) {
              await this.telegram.sendMessage(
                `👑 <b>1-O'RIN: NFT Upgrade Muvaffaqiyatli!</b>\n\n` +
                `🎁 Sovg'a: <b>${ug.gift?.title || ''}</b>\n` +
                `🎉 Model: <b>${modelName}</b>\n` +
                `📍 Joylashuv: ${src.name}\n` +
                `⭐ Yangi balans: <b>${this.balance.toLocaleString()} Stars</b>`
              ).catch(() => {});
            }
          } else {
            const errData = await upRes.json().catch(() => ({}));
            if (errData.code === 'gift_not_upgradable') {
              this.notUpgradableYet.add(ug.id);
            } else if (errData.code === 'already_upgraded') {
              this.alreadyUpgraded.add(ug.id);
            }
          }
        }
      } catch (err) {
        // ignore hiccup
      }
    }
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[${ts()}] 👀 Monitoring faol! Har ${this.config.pollIntervalMs} ms da do'kon va upgrade kuzatiladi...\n`);

    const loop = async () => {
      while (this.isRunning) {
        try {
          this.scanCount++;
          this.lastScanTime = new Date().toISOString();

          // 1-O'RIN: Upgrade tekshiruvi (har 5 marta va har 120 martada keshni tozalash)
          if (this.config.autoUpgradePriority && this.scanCount % 5 === 0) {
            if (this.scanCount % 120 === 0) {
              this.notUpgradableYet.clear();
            }
            await this.processPriorityUpgrades();
          }

          // 2-QADAM: Yangi rasmiy gift xaridi
          const res = await this.client.request('/gifts');
          if (!res.ok) {
            await sleep(this.config.pollIntervalMs);
            continue;
          }

          const data = await res.json();
          const gifts = data.gifts || [];

          if (typeof data.balance === 'number') {
            this.balance = data.balance;
          }

          const targetGift = gifts.find(g => {
            if (g.price > this.config.maxGiftPrice) return false;
            if (g.sold_out) return false;
            const isBrandNew = !this.knownGiftIds.has(g.id);
            const isLimitedActive = g.supply !== null && !g.sold_out;
            return isBrandNew || isLimitedActive;
          });

          if (targetGift) {
            console.log(`\n🚨🚨 [${ts()}] YANGI RASMIY GIFT ANIQLANDI! 🚨🚨`);
            console.log(`     🎁 Sovg'a: "${targetGift.title}" (ID: ${targetGift.id})`);
            console.log(`     💵 Narxi: ${targetGift.price} ⭐ | Tiraji: ${targetGift.supply ?? 'Cheksiz'}`);
            console.log(`     💳 Joriy balans: ${this.balance.toLocaleString()} ⭐`);

            while (this.isRunning) {
              const spendable = this.balance - this.config.minBalanceReserve;
              if (spendable < targetGift.price) {
                console.log(`\n🛑 [${ts()}] Xarid to'xtatildi: 40k stars zaxirangiz saqlandi (Balans: ${this.balance.toLocaleString()} ⭐).`);
                break;
              }

              const targetChannel = this.config.channels[this.nextChannelIndex % this.config.channels.length];
              console.log(`[${ts()}] 🛒 Xarid -> "${targetChannel.name}" (${targetChannel.id}) [${targetGift.price} ⭐]...`);

              const sendRes = await this.client.request('/gifts/send', {
                method: 'POST',
                body: {
                  gift_id: targetGift.id,
                  chat_id: targetChannel.id,
                  hide_name: false,
                  message: null,
                  expected_price: targetGift.price
                }
              });

              if (sendRes.ok) {
                const sendData = await sendRes.json().catch(() => ({}));
                this.balance -= targetGift.price;
                this.purchaseCount[targetChannel.id]++;
                this.nextChannelIndex++;
                this.lastAction = `Sotib olindi: ${targetGift.title} -> ${targetChannel.name}`;

                console.log(`🎉 [${ts()}] XARID MUVAFFAQIShATLI!`);
                console.log(`     📍 Yuborildi: ${targetChannel.name} (${targetChannel.id})`);
                console.log(`     📊 Statistika:`);
                console.log(`        - ${this.config.channels[0].name}: ${this.purchaseCount[this.config.channels[0].id]} ta`);
                console.log(`        - ${this.config.channels[1].name}: ${this.purchaseCount[this.config.channels[1].id]} ta`);
                console.log(`     ⭐ Qolgan balans: ${this.balance.toLocaleString()} Stars`);

                if (this.telegram && this.telegram.sendMessage) {
                  await this.telegram.sendMessage(
                    `🎁 <b>Yangi Rasmiy Sovg'a Xaridi!</b>\n\n` +
                    `📦 Sovg'a: <b>${targetGift.title}</b> (${targetGift.price} ⭐)\n` +
                    `📍 Kanal: <b>${targetChannel.name}</b> (${targetChannel.id})\n` +
                    `📊 Jami: ${this.purchaseCount[this.config.channels[0].id]} ta / ${this.purchaseCount[this.config.channels[1].id]} ta\n` +
                    `⭐ Qolgan balans: <b>${this.balance.toLocaleString()} Stars</b>`
                  ).catch(() => {});
                }

                // Darhol olingan zahoti yangi sovg'ani upgrade qilishga urinish:
                const createdGiftId = sendData.user_gift?.id || sendData.gift?.id;
                if (createdGiftId) {
                  console.log(`[${ts()}] 👑 Yangi sovg'a darhol upgrade qilinmoqda (ID: ${createdGiftId})...`);
                  const fastUpRes = await this.client.request(`/user-gifts/${createdGiftId}/upgrade`, {
                    method: 'POST',
                    body: {}
                  });
                  if (fastUpRes.ok) {
                    console.log(`🌟 [${ts()}] YANGI SOVG'A DARHOL 1-O'RINDA NFT GA UPGRADE BO'LDI!`);
                  }
                }
              } else {
                const errData = await sendRes.json().catch(() => ({}));
                console.error(`❌ [${ts()}] Xaridda xatolik:`, errData.message || sendRes.statusText);
                if (errData.code === 'sold_out' || sendRes.status === 400 || sendRes.status === 422) {
                  console.log(`⚠️ Sovg'a sotilib tugadi yoki limitga yetildi.`);
                  break;
                }
                await sleep(300);
              }

              await sleep(100);
            }

            this.knownGiftIds.add(targetGift.id);
            await this.processPriorityUpgrades();
            console.log(`\n✅ [${ts()}] Sikl yakunlandi. Monitoring qayta davom etmoqda...\n`);
          }

          if (this.scanCount % 30 === 0) {
            process.stdout.write(`\r[${ts()}] 🔍 Skaner faol (${this.scanCount}-tekshiruv) | Balans: ${this.balance.toLocaleString()} ⭐ | 👑 UPG Priority: Faol   `);
          }

          await sleep(this.config.pollIntervalMs);
        } catch (err) {
          console.error(`\n[${ts()}] Xatolik (qayta ulanadi):`, err.message);
          await sleep(2000);
        }
      }
    };

    loop().catch(err => {
      console.error('AutoGiftBuyer xatosi:', err);
      this.isRunning = false;
    });
  }

  stop() {
    this.isRunning = false;
  }
}

// Standalone ishga tushirish uchun:
if (process.argv[1] && process.argv[1].endsWith('auto-gift-buyer.js')) {
  async function standalone() {
    const configPath = path.join(rootDir, 'config.json');
    const accountsPath = path.join(rootDir, 'accounts.json');

    const baseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    let accounts = [];
    if (process.env.PAXTA_ACCOUNTS) {
      try { accounts = JSON.parse(process.env.PAXTA_ACCOUNTS); } catch {}
    } else if (fs.existsSync(accountsPath)) {
      accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
    }

    const client = new PaxtaClient(accounts[0], baseConfig);
    const buyer = new AutoGiftBuyer({ client, config: DEFAULT_GIFT_CONFIG });
    await buyer.init();
    await buyer.start();
  }

  standalone().catch(err => console.error('Fatal error in standalone:', err));
}
