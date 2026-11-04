import { CookieJar } from './cookie-jar.js';

function generateRandomId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'ru-RU,ru;q=0.9,uz;q=0.8,en;q=0.7',
  'Sec-CH-UA': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
  'Sec-CH-UA-Mobile': '?0',
  'Sec-CH-UA-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'Referer': 'https://paxta.online/'
};

export class PaxtaClient {
  constructor(account, config) {
    this.username = account.username.replace(/^@/, '');
    this.password = account.password;
    this.config = config;
    this.jar = new CookieJar();
    this.user = null;
    this.starsBotChatId = null;
    this.initialStars = 0;
    this.isLoggedIn = false;
  }

  async request(path, options = {}) {
    const url = path.startsWith('http') ? path : `${this.config.apiBase}${path}`;
    const headers = {
      ...BROWSER_HEADERS,
      'Cookie': this.jar.getCookieHeader(),
      'X-XSRF-TOKEN': this.jar.getXSRFToken(),
      ...(options.headers || {})
    };

    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    const res = await fetch(url, {
      ...options,
      headers
    });

    this.jar.setFromHeaders(res.headers);
    return res;
  }

  async login() {
    // 1. Get CSRF cookie
    const csrfRes = await fetch(this.config.sanctumUrl, { headers: BROWSER_HEADERS });
    this.jar.setFromHeaders(csrfRes.headers);

    // 2. Perform authentication
    const loginRes = await this.request('/auth/login', {
      method: 'POST',
      body: {
        username: this.username,
        password: this.password
      }
    });

    if (!loginRes.ok) {
      const errText = await loginRes.text();
      throw new Error(`Login failed for @${this.username} (status ${loginRes.status}): ${errText}`);
    }

    const data = await loginRes.json();
    this.user = data.user;
    this.initialStars = data.user?.stars_balance ?? 0;
    this.isLoggedIn = true;
    return this.user;
  }

  async resolveStarsBotChat() {
    if (this.starsBotChatId) return this.starsBotChatId;

    const res = await this.request('/chats/private', {
      method: 'POST',
      body: {
        user_id: this.config.starsBot.id
      }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to resolve StarsBot chat for @${this.username}: ${err}`);
    }

    const data = await res.json();
    this.starsBotChatId = data.chat?.id;
    return this.starsBotChatId;
  }

  async sendMessage(chatId, text) {
    const random_id = generateRandomId();
    const res = await this.request(`/chats/${chatId}/messages`, {
      method: 'POST',
      body: {
        text,
        random_id
      }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to send message to ${chatId}: ${err}`);
    }

    return await res.json();
  }

  async sendToStarsBot(promoCode) {
    if (!this.starsBotChatId) {
      await this.resolveStarsBotChat();
    }
    const text = `/promo ${promoCode}`;
    const startTime = Date.now();
    const result = await this.sendMessage(this.starsBotChatId, text);
    const latency = Date.now() - startTime;
    return {
      username: this.username,
      promoCode,
      messageId: result.message?.id,
      latencyMs: latency
    };
  }

  async getStarsBalance() {
    const res = await this.request('/gifts');
    if (res.ok) {
      const data = await res.json();
      if (typeof data.balance === 'number') return data.balance;
    }
    // Fallback: fetch me
    const meRes = await this.request(`/users/${this.user?.id}`);
    if (meRes.ok) {
      const data = await meRes.json();
      return data.user?.stars_balance ?? this.initialStars;
    }
    return this.initialStars;
  }

  /**
   * Attempts to buy a resale NFT gift on Paxta Market whose price <= maxPrice
   */
  async buyMarketNftGift(maxPrice) {
    try {
      const marketRes = await this.request('/market');
      if (!marketRes.ok) return null;
      const marketData = await marketRes.json();
      const collections = (marketData.collections || [])
        .filter(c => c.floor && c.floor <= maxPrice)
        .sort((a, b) => a.floor - b.floor);

      for (const col of collections) {
        const colRes = await this.request(`/market/${col.gift.id}`);
        if (!colRes.ok) continue;
        const colData = await colRes.json();
        const availableItems = (colData.items || [])
          .filter(item => item.price && item.price <= maxPrice)
          .sort((a, b) => a.price - b.price);

        if (availableItems.length > 0) {
          const itemToBuy = availableItems[0];
          console.log(`🛒 @${this.username} Marketdan NFT sotib olmoqda: "${col.gift.title} #${itemToBuy.number}" (${itemToBuy.price} ⭐)...`);
          const buyRes = await this.request(`/user-gifts/${itemToBuy.id}/buy`, {
            method: 'POST',
            body: { expected_price: itemToBuy.price }
          });
          if (buyRes.ok) {
            console.log(`🎉 @${this.username} muvaffaqiyatli NFT sotib oldi: "${col.gift.title} #${itemToBuy.number}"!`);
            return { type: 'nft', title: col.gift.title, number: itemToBuy.number, price: itemToBuy.price };
          }
        }
      }
    } catch (err) {
      console.error(`@${this.username} NFT sotib olishda xato:`, err.message);
    }
    return null;
  }

  /**
   * Attempts to buy an official store gift (Cake, Money Tree, Maple Leaf, Honey Puff) <= maxPrice
   */
  async buyStoreGift(maxPrice) {
    try {
      const giftsRes = await this.request('/gifts');
      if (!giftsRes.ok) return null;
      const data = await giftsRes.json();
      const available = (data.gifts || [])
        .filter(g => !g.sold_out && g.price <= maxPrice)
        .sort((a, b) => b.price - a.price); // buy highest possible

      if (available.length > 0) {
        const gift = available[0];
        console.log(`🎁 @${this.username} Do'kondan sovg'a sotib olmoqda: "${gift.title}" (${gift.price} ⭐)...`);
        const sendRes = await this.request('/gifts/send', {
          method: 'POST',
          body: {
            gift_id: gift.id,
            user_id: this.user.id, // buy for oneself!
            message: null,
            hide_name: false,
            expected_price: gift.price
          }
        });
        if (sendRes.ok) {
          console.log(`🎉 @${this.username} o'ziga sovg'a oldi: "${gift.title}" (${gift.price} ⭐)!`);
          return { type: 'store', title: gift.title, price: gift.price };
        }
      }
    } catch (err) {
      console.error(`@${this.username} sovg'a sotib olishda xato:`, err.message);
    }
    return null;
  }

  /**
   * Auto-spend promo gains:
   * Leaves initialStars completely untouched!
   * Converts all promo earnings into NFT / Gifts for this account.
   */
  async autoSpendPromoGains() {
    try {
      const currentBalance = await this.getStarsBalance();
      let availableToSpend = currentBalance - this.initialStars;

      if (availableToSpend <= 0) {
        console.log(`ℹ️ @${this.username}: Yangi sarflanadigan promo stars yo'q (Balans: ${currentBalance}, Boshlang'ich: ${this.initialStars}).`);
        return [];
      }

      console.log(`\n💎 @${this.username}: Promokoddan tushgan ${availableToSpend} ⭐ buyumga aylantirilmoqda (Eski hisob: ${this.initialStars} ⭐ saqlanadi)...`);
      const purchased = [];

      // Loop while we have enough to buy at least the cheapest gift (25 ⭐)
      let attempts = 0;
      while (availableToSpend >= 25 && attempts < 10) {
        attempts++;
        let bought = null;

        // 1. If we have >= 420 ⭐, first try to buy an NFT gift on the secondary market
        if (availableToSpend >= 420) {
          bought = await this.buyMarketNftGift(availableToSpend);
        }

        // 2. If no NFT gift bought or available < 420, buy official store gifts
        if (!bought && availableToSpend >= 25) {
          bought = await this.buyStoreGift(availableToSpend);
        }

        if (bought) {
          purchased.push(bought);
          availableToSpend -= bought.price;
        } else {
          // Cannot buy anything further
          break;
        }
      }

      return purchased;
    } catch (err) {
      console.error(`@${this.username} avto-sarflashda xato:`, err.message);
      return [];
    }
  }

  async getMessages(chatId) {
    const res = await this.request(`/chats/${chatId}/messages`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : data.messages || [];
  }
}
