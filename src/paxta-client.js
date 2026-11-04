import { CookieJar } from './cookie-jar.js';

function generateRandomId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// Realistic Windows Chrome headers
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

  async getMessages(chatId) {
    const res = await this.request(`/chats/${chatId}/messages`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : data.messages || [];
  }

  async getUpdates(cursor = null) {
    const query = cursor !== null ? `?after=${cursor}` : '';
    const res = await this.request(`/updates${query}`);
    if (!res.ok) return null;
    return await res.json();
  }
}
