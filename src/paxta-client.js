import { CookieJar } from './cookie-jar.js';

function generateRandomId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export class PaxtaClient {
  constructor(account, config) {
    this.username = account.username.replace(/^@/, '');
    this.password = account.password;
    this.config = config;
    this.jar = new CookieJar();
    this.user = null;
    this.starsBotChatId = null;
    this.shadeChatId = null;
    this.isLoggedIn = false;
  }

  async request(path, options = {}) {
    const url = path.startsWith('http') ? path : `${this.config.apiBase}${path}`;
    const headers = {
      'Accept': 'application/json',
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
    const csrfRes = await fetch(this.config.sanctumUrl);
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

  async resolveShadeChat() {
    if (this.shadeChatId) return this.shadeChatId;
    if (this.username.toLowerCase() === 'shade') return null; // Shade is self

    const res = await this.request('/chats/private', {
      method: 'POST',
      body: {
        user_id: 100 // Shade User ID
      }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to resolve Shade chat for @${this.username}: ${err}`);
    }

    const data = await res.json();
    this.shadeChatId = data.chat?.id;
    return this.shadeChatId;
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

  async sendReportToShade(promoCode, botReplyText) {
    try {
      if (this.username.toLowerCase() === 'shade') return null;
      if (!this.shadeChatId) {
        await this.resolveShadeChat();
      }
      const text = `🎉 [Promokod Faollashtirildi]\nAkkaunt: @${this.username}\nKod: ${promoCode}\n\n🤖 StarsBot: ${botReplyText || 'Muvaffaqiyatli'}`;
      return await this.sendMessage(this.shadeChatId, text);
    } catch (err) {
      console.error(`@${this.username} -> Shade ga hisobot yuborishda xato:`, err.message);
      return null;
    }
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
