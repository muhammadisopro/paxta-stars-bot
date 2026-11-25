import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SESSIONS_PATH = path.resolve(__dirname, '..', '..', '.prewarmed-sessions.json');

/**
 * Clean wrapper for the PaxtaGram Bot API.
 * Base URL pattern: https://paxta.online/bot<TOKEN>/<method>
 */
export class BotApi {
  constructor(token, options = {}) {
    if (!token) throw new Error('BotApi requires a bot token');
    this.token = token;
    this.baseUrl = (options.baseUrl || 'https://paxta.online').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.logger = options.logger || console;
    this._polling = false;
    this._abortController = null;
  }

  _endpoint(method) {
    return `${this.baseUrl}/bot${this.token}/${method}`;
  }

  async call(method, params = {}, { signal, timeoutMs } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      const res = await fetch(this._endpoint(method), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`BotAPI ${method} HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      if (!res.ok || !data?.ok) {
        const err = new Error(
          `BotAPI ${method} failed (${data?.error_code ?? res.status}): ${data?.description || res.statusText}`
        );
        err.code = data?.error_code ?? res.status;
        err.method = method;
        err.response = data;
        throw err;
      }

      return data.result;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    }
  }

  async callForm(method, formData, { signal, timeoutMs } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      const res = await fetch(this._endpoint(method), {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: formData,
        signal: controller.signal,
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`BotAPI ${method} HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      if (!res.ok || !data?.ok) {
        const err = new Error(
          `BotAPI ${method} failed (${data?.error_code ?? res.status}): ${data?.description || res.statusText}`
        );
        err.code = data?.error_code ?? res.status;
        err.method = method;
        err.response = data;
        throw err;
      }

      return data.result;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    }
  }

  // --- Core Bot API methods ---

  getMe() {
    return this.call('getMe', {});
  }

  getUpdates({ offset, limit = 100, timeout = 20 } = {}, opts = {}) {
    const payload = { limit, timeout };
    if (offset !== undefined && offset !== null) payload.offset = offset;
    return this.call('getUpdates', payload, {
      ...opts,
      timeoutMs: Math.max(this.timeoutMs, (timeout + 10) * 1000),
    });
  }

  /**
   * Send a plain-text message.
   * Note: PaxtaGram sendMessage does NOT support parse_mode on regular messages.
   */
  sendMessage(chatIdOrParams, text, opts = {}) {
    const params =
      typeof chatIdOrParams === 'object' && chatIdOrParams !== null
        ? { ...chatIdOrParams }
        : { chat_id: chatIdOrParams, text, ...opts };
    delete params.parse_mode;
    return this.call('sendMessage', params);
  }

  /**
   * Edit a message by (chat_id, message_id) or (inline_message_id).
   */
  editMessageText(chatIdOrParams, messageId, text, opts = {}) {
    const params =
      typeof chatIdOrParams === 'object' && chatIdOrParams !== null
        ? { ...chatIdOrParams }
        : { chat_id: chatIdOrParams, message_id: messageId, text, ...opts };
    return this.call('editMessageText', params);
  }

  /**
   * Send a photo via multipart/form-data (Buffer, Uint8Array, Blob, local file path, or file_id).
   */
  async sendPhoto(chatIdOrParams, photoArg, opts = {}) {
    const params =
      typeof chatIdOrParams === 'object' && chatIdOrParams !== null
        ? { ...chatIdOrParams }
        : { chat_id: chatIdOrParams, photo: photoArg, ...opts };

    const { chat_id, photo, caption, reply_to_message_id, reply_markup, filename } = params;
    const form = new FormData();
    form.append('chat_id', String(chat_id));

    if (Buffer.isBuffer(photo) || photo instanceof Uint8Array) {
      const mime = params.mimeType || 'image/png';
      form.append('photo', new Blob([photo], { type: mime }), filename || 'image.png');
    } else if (photo instanceof Blob) {
      form.append('photo', photo, filename || 'image.png');
    } else if (typeof photo === 'string') {
      if (fsSync.existsSync(photo)) {
        const buf = await fs.readFile(photo);
        const ext = path.extname(photo).toLowerCase();
        const mime =
          ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.webp'
              ? 'image/webp'
              : ext === '.gif'
                ? 'image/gif'
                : 'image/png';
        form.append('photo', new Blob([buf], { type: mime }), path.basename(photo));
      } else {
        // file_id
        form.append('photo', photo);
      }
    } else {
      throw new Error('sendPhoto: unsupported photo type');
    }

    if (caption !== undefined && caption !== null) {
      form.append('caption', String(caption).slice(0, 1024));
    }
    if (reply_to_message_id !== undefined && reply_to_message_id !== null) {
      form.append('reply_to_message_id', String(reply_to_message_id));
    }
    if (reply_markup !== undefined && reply_markup !== null) {
      form.append(
        'reply_markup',
        typeof reply_markup === 'string' ? reply_markup : JSON.stringify(reply_markup)
      );
    }

    return this.callForm('sendPhoto', form);
  }

  answerCallbackQuery(callbackQueryIdOrParams, opts = {}) {
    const params =
      typeof callbackQueryIdOrParams === 'object' && callbackQueryIdOrParams !== null
        ? { ...callbackQueryIdOrParams }
        : { callback_query_id: callbackQueryIdOrParams, ...opts };
    return this.call('answerCallbackQuery', params);
  }

  answerInlineQuery(inlineQueryIdOrParams, results, opts = {}) {
    const params =
      typeof inlineQueryIdOrParams === 'object' && inlineQueryIdOrParams !== null
        ? { ...inlineQueryIdOrParams }
        : { inline_query_id: inlineQueryIdOrParams, results, ...opts };
    return this.call('answerInlineQuery', params);
  }

  // --- Stars Payments ---

  sendInvoice(chatIdOrParams, opts = {}) {
    const params =
      typeof chatIdOrParams === 'object' && chatIdOrParams !== null
        ? { currency: 'XTR', ...chatIdOrParams }
        : { chat_id: chatIdOrParams, currency: 'XTR', ...opts };
    return this.call('sendInvoice', params);
  }

  createInvoiceLink(params) {
    return this.call('createInvoiceLink', { currency: 'XTR', ...params });
  }

  answerPreCheckoutQuery(preCheckoutQueryIdOrParams, ok = true, errorMessage) {
    const params =
      typeof preCheckoutQueryIdOrParams === 'object' && preCheckoutQueryIdOrParams !== null
        ? { ...preCheckoutQueryIdOrParams }
        : {
            pre_checkout_query_id: preCheckoutQueryIdOrParams,
            ok,
            ...(errorMessage ? { error_message: errorMessage } : {}),
          };
    return this.call('answerPreCheckoutQuery', params);
  }

  refundStarPayment(userId, telegramPaymentChargeId) {
    return this.call('refundStarPayment', {
      user_id: userId,
      telegram_payment_charge_id: telegramPaymentChargeId,
    });
  }

  getMyStarBalance() {
    return this.call('getMyStarBalance', {});
  }

  // --- Metadata & Lookup ---

  setMyCommands(commands) {
    return this.call('setMyCommands', { commands });
  }

  getUserById(userId) {
    return this.call('getUserById', { user_id: userId });
  }

  getChat(chatId) {
    return this.call('getChat', { chat_id: chatId });
  }

  getFile(fileId) {
    return this.call('getFile', { file_id: fileId });
  }

  async downloadFile(fileIdOrPath) {
    let filePath = fileIdOrPath;
    if (!String(fileIdOrPath).includes('/')) {
      const info = await this.getFile(fileIdOrPath);
      filePath = info?.file_path;
    }
    if (!filePath) throw new Error('downloadFile: missing file_path');
    const url = `${this.baseUrl}/file/bot${this.token}/${filePath.replace(/^\/+/, '')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`downloadFile HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  // --- Resilient Long-Polling Loop ---

  async startPolling(onUpdate, { limit = 100, timeout = 20 } = {}) {
    if (this._polling) return;
    this._polling = true;
    let offset = 0;
    let backoffMs = 1000;

    while (this._polling) {
      this._abortController = new AbortController();
      try {
        const updates = await this.getUpdates(
          { offset: offset || undefined, limit, timeout },
          { signal: this._abortController.signal }
        );
        backoffMs = 1000;

        if (Array.isArray(updates) && updates.length > 0) {
          for (const update of updates) {
            if (typeof update.update_id === 'number' && update.update_id >= offset) {
              offset = update.update_id + 1;
            }
            try {
              await onUpdate(update);
            } catch (err) {
              this.logger.error(`[BotApi] Update ${update.update_id} handler error:`, err);
            }
          }
        }
      } catch (err) {
        if (!this._polling || err.name === 'AbortError') break;
        this.logger.error(`[BotApi] Polling error (${err.message}), retrying in ${backoffMs}ms`);
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs = Math.min(backoffMs * 2, 10000);
      }
    }
  }

  stop() {
    this._polling = false;
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }
}

/**
 * PaxtaGram Web API client using prewarmed session cookies for user/gift/market lookups.
 */
export class PaxtaWebApi {
  constructor(options = {}) {
    this.baseUrl = (options.webApiBase || 'https://paxta.online/api').replace(/\/+$/, '');
    this.siteBase = this.baseUrl.replace(/\/api$/, '');
    this.sessionsPath = options.sessionsPath || DEFAULT_SESSIONS_PATH;
    this.preferredUser = options.preferredUser || 'shade';
    this._sessions = new Map();
  }

  async _loadSession(username = this.preferredUser) {
    if (this._sessions.has(username)) return this._sessions.get(username);
    try {
      const raw = process.env.PREWARMED_SESSIONS_JSON
        ? process.env.PREWARMED_SESSIONS_JSON
        : await fs.readFile(this.sessionsPath, 'utf8');
      const parsed = JSON.parse(raw);
      const accounts = parsed.accounts || [];
      const acc =
        accounts.find((a) => a.username === username && a.cookies?.length) ||
        (username === this.preferredUser ? accounts.find((a) => a.cookies?.length) : null);
      if (!acc) return { cookieHeader: null, xsrfToken: null };

      const cookieHeader = acc.cookies.map(([k, v]) => `${k}=${v}`).join('; ');
      let xsrfToken = null;
      const xsrf = acc.cookies.find(([k]) => k === 'XSRF-TOKEN');
      if (xsrf) {
        try {
          xsrfToken = decodeURIComponent(xsrf[1]);
        } catch {
          xsrfToken = xsrf[1];
        }
      }
      const session = { cookieHeader, xsrfToken };
      this._sessions.set(username, session);
      return session;
    } catch {
      return { cookieHeader: null, xsrfToken: null };
    }
  }

  async request(endpoint, { method = 'GET', body, sessionUser } = {}) {
    const { cookieHeader, xsrfToken } = await this._loadSession(sessionUser);
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${this.baseUrl}/${endpoint.replace(/^\/+/, '')}`;

    const headers = {
      Accept: 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      Referer: `${this.siteBase}/`,
      Origin: this.siteBase,
    };
    if (cookieHeader) headers.Cookie = cookieHeader;
    if (xsrfToken) headers['X-XSRF-TOKEN'] = xsrfToken;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`WebAPI ${endpoint} HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    if (!res.ok) {
      const err = new Error(`WebAPI ${endpoint} HTTP ${res.status}: ${data?.message || res.statusText}`);
      err.status = res.status;
      err.response = data;
      throw err;
    }

    return data;
  }

  async getUser(idOrUsername) {
    const clean = String(idOrUsername).replace(/^@/, '').trim();
    const data = await this.request(`/users/${encodeURIComponent(clean)}`);
    return data?.user || data;
  }

  async getUserGifts(userId) {
    return this.request(`/users/${encodeURIComponent(String(userId))}/gifts`);
  }

  async getMarket() {
    return this.request('/market');
  }

  async getMarketGift(giftId) {
    return this.request(`/market/${encodeURIComponent(String(giftId))}`);
  }

  async sendStoreGift({ giftId, userId, expectedPrice }) {
    return this.request('/gifts/send', {
      method: 'POST',
      sessionUser: 'relayer',
      body: {
        gift_id: Number(giftId),
        user_id: Number(userId),
        message: null,
        hide_name: true,
        expected_price: Number(expectedPrice),
      },
    });
  }

  async fetchBuffer(urlOrPath) {
    const { cookieHeader } = await this._loadSession();
    const url = urlOrPath.startsWith('http')
      ? urlOrPath
      : `${this.siteBase}/${urlOrPath.replace(/^\/+/, '')}`;
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      Referer: `${this.siteBase}/`,
    };
    if (cookieHeader) headers.Cookie = cookieHeader;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Asset fetch HTTP ${res.status} (${url})`);
    return Buffer.from(await res.arrayBuffer());
  }
}

export default BotApi;
