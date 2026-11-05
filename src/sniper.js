import { AuctionClient } from './auction-client.js';

function timestamp() {
  return new Date().toLocaleTimeString('uz-UZ', { hour12: false });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class MarketSniper {
  constructor({ paxtaClient, telegram, config = {} }) {
    this.client = paxtaClient;
    this.telegram = telegram;
    this.auctionClient = new AuctionClient(paxtaClient);

    // Limit configuration (NFT gifts <= 100 stars, usernames & numbers <= 1000 stars)
    this.maxNftPrice = config.maxNftPrice ?? 100;
    this.maxAuctionPrice = config.maxAuctionPrice ?? 1000;

    this.boughtLotIds = new Set();
    this.boughtItemIds = new Set();
    this.isRunning = false;
    this.scanCount = 0;
    this.snipedCount = 0;
    this.lastScanTime = null;
  }

  async init() {
    console.log(`[${timestamp()}] 🎯 Sniper @${this.client.username} uchun tayyorlanmoqda...`);
    await this.auctionClient.authenticate();
    console.log(`[${timestamp()}] ✅ Sniper @${this.client.username} ulandi!`);
    console.log(`     • NFT Giftlar maksimal narxi: <= ${this.maxNftPrice} ⭐`);
    console.log(`     • Usernames va Raqamlar maksimal narxi: <= ${this.maxAuctionPrice} ⭐`);
    console.log(`     • Balans: ${this.auctionClient.user?.stars_balance ?? this.client.initialStars} ⭐`);
  }

  /**
   * Scan Paxta Market for NFT gifts <= maxNftPrice (e.g. <= 100 stars)
   */
  async scanMarketGifts() {
    try {
      const marketRes = await this.client.request('/market');
      if (!marketRes.ok) return;
      const marketData = await marketRes.json();
      const cheapCollections = (marketData.collections || []).filter(
        c => c.floor && c.floor <= this.maxNftPrice
      );

      for (const col of cheapCollections) {
        const colRes = await this.client.request(`/market/${col.gift.id}`);
        if (!colRes.ok) continue;
        const colData = await colRes.json();
        const targets = (colData.items || []).filter(
          item => item.price && item.price <= this.maxNftPrice && !this.boughtItemIds.has(item.id)
        );

        for (const item of targets) {
          this.boughtItemIds.add(item.id);
          console.log(`\n🚨 [SNIPER HIT] Arzon NFT gift topildi! "${col.gift.title} #${item.number}" -> ${item.price} ⭐ (Limit: <= ${this.maxNftPrice} ⭐)`);

          const buyRes = await this.client.request(`/user-gifts/${item.id}/buy`, {
            method: 'POST',
            body: { expected_price: item.price }
          });

          if (buyRes.ok) {
            this.snipedCount++;
            console.log(`🎉 [SNIPER SUCCESS] @${this.client.username} NFT sovg'ani sotib oldi: "${col.gift.title} #${item.number}" (${item.price} ⭐)!`);
            await this.telegram.sendSniperAlert({
              type: 'NFT Sovg\'a',
              item: `${col.gift.title} #${item.number}`,
              price: item.price,
              account: this.client.username,
              market: 'Paxta Market'
            });
          } else {
            const errText = await buyRes.text();
            console.error(`❌ [SNIPER BUY ERROR] NFT xaridida xato:`, errText);
          }
        }
      }
    } catch (err) {
      // ignore network hiccup
    }
  }

  /**
   * Scan Paxta Auctions for usernames and numbers <= maxAuctionPrice (e.g. <= 1000 stars)
   */
  async scanAuctions() {
    try {
      // 1. Direct sales for usernames
      await this._checkAuctionCatalog('username', 'sale');
      // 2. Direct sales for numbers
      await this._checkAuctionCatalog('number', 'sale');
      // 3. All lots for usernames (to capture buy_now)
      await this._checkAuctionCatalog('username', 'all');
      // 4. All lots for numbers (to capture buy_now)
      await this._checkAuctionCatalog('number', 'all');
    } catch (err) {
      if (err.message && (err.message.includes('401') || err.message.includes('Unauthenticated'))) {
        try {
          await this.auctionClient.authenticate();
        } catch {}
      }
    }
  }

  async _checkAuctionCatalog(kind, filter) {
    const data = await this.auctionClient.getCatalog(kind, filter, 'price_asc');
    const items = data.items || [];

    for (const item of items) {
      if (this.boughtLotIds.has(item.id)) continue;

      let isTarget = false;
      let buyPrice = 0;

      if (item.type === 'sale' && item.price && item.price <= this.maxAuctionPrice) {
        isTarget = true;
        buyPrice = item.price;
      } else if (item.buy_now && item.buy_now <= this.maxAuctionPrice) {
        isTarget = true;
        buyPrice = item.buy_now;
      }

      if (isTarget) {
        this.boughtLotIds.add(item.id);
        const itemLabel = kind === 'username' ? `@${item.value}` : item.value;
        console.log(`\n🚨 [SNIPER HIT] Arzon lot topildi! ${kind.toUpperCase()}: ${itemLabel} -> ${buyPrice} ⭐ (Limit: <= ${this.maxAuctionPrice} ⭐)`);

        const buyRes = await this.auctionClient.buyLot(item.id);
        if (buyRes.ok) {
          this.snipedCount++;
          console.log(`🎉 [SNIPER SUCCESS] @${this.client.username} lotni sotib oldi: ${itemLabel} (${buyPrice} ⭐)!`);
          await this.telegram.sendSniperAlert({
            type: kind === 'username' ? 'Username' : 'Raqam (+777)',
            item: itemLabel,
            price: buyPrice,
            account: this.client.username,
            market: 'Paxta Auctions'
          });
        } else {
          const errText = await buyRes.text();
          console.error(`❌ [SNIPER BUY ERROR] Lot xaridida xato:`, errText);
        }
      }
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    const loop = async () => {
      while (this.isRunning) {
        this.scanCount++;
        this.lastScanTime = new Date().toISOString();
        await this.scanMarketGifts();
        await this.scanAuctions();

        // 1.5s - 2.5s jittered delay to avoid bot detection
        const delay = 1500 + Math.floor(Math.random() * 1000);
        await sleep(delay);
      }
    };

    loop().catch(err => {
      console.error('Sniper loop xatosi:', err.message);
      this.isRunning = false;
    });
  }

  stop() {
    this.isRunning = false;
  }
}
