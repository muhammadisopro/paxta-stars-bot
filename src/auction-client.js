import { CookieJar } from './cookie-jar.js';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'ru-RU,ru;q=0.9,uz;q=0.8,en;q=0.7',
  'Sec-CH-UA': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
  'Sec-CH-UA-Mobile': '?0',
  'Sec-CH-UA-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
  'Referer': 'https://auctions.paxta.online/'
};

export class AuctionClient {
  constructor(paxtaClient) {
    this.paxtaClient = paxtaClient;
    this.jar = new CookieJar();
    this.user = null;
    this.isLoggedIn = false;
  }

  async authenticate() {
    try {
      // 1. GET https://auctions.paxta.online/login
      const step1 = await fetch('https://auctions.paxta.online/login', {
        redirect: 'manual',
        headers: BROWSER_HEADERS
      });
      this.jar.setFromHeaders(step1.headers);

      const location1 = step1.headers.get('location');
      if (!location1) {
        throw new Error('No redirect location from auctions.paxta.online/login');
      }

      const stateMatch = location1.match(/state=([^&]+)/);
      if (!stateMatch) {
        throw new Error('No state parameter found in auctions redirect URL');
      }
      const state = decodeURIComponent(stateMatch[1]);

      // 2. Grant bridge access from PaxtaGram main session
      const step2Res = await this.paxtaClient.request('/auctions/bridge/grant', {
        method: 'POST',
        body: { state }
      });

      if (!step2Res.ok) {
        const errText = await step2Res.text();
        throw new Error(`Bridge grant failed (${step2Res.status}): ${errText}`);
      }

      const step2 = await step2Res.json();
      if (!step2.redirect) {
        throw new Error('Bridge grant returned no redirect URL');
      }

      // 3. Callback on auctions domain
      const step3 = await fetch(step2.redirect, {
        redirect: 'manual',
        headers: {
          ...BROWSER_HEADERS,
          'Cookie': this.jar.getCookieHeader()
        }
      });
      this.jar.setFromHeaders(step3.headers);

      // 4. Verify auth
      const meRes = await this.request('/auctions/me');
      if (!meRes.ok) {
        throw new Error(`Failed to verify auction session (${meRes.status})`);
      }

      const meData = await meRes.json();
      this.user = meData.user;
      this.isLoggedIn = true;
      return this.user;
    } catch (err) {
      this.isLoggedIn = false;
      throw new Error(`Auction authentication failed for @${this.paxtaClient.username}: ${err.message}`);
    }
  }

  async request(path, options = {}) {
    const url = path.startsWith('http') ? path : `https://auctions.paxta.online/api${path}`;
    const headers = {
      ...BROWSER_HEADERS,
      'Cookie': this.jar.getCookieHeader(),
      'X-XSRF-TOKEN': this.jar.getXSRFToken(),
      'X-Requested-With': 'XMLHttpRequest',
      ...(options.headers || {})
    };

    let body = options.body;
    if (body && typeof body === 'object') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }

    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body
    });

    this.jar.setFromHeaders(res.headers);
    return res;
  }

  /**
   * Fetch catalog of usernames or numbers
   * @param {'username'|'number'} kind 
   * @param {'sale'|'auction'|'all'} filter 
   * @param {'price_asc'|'price_desc'|'ending'} sort 
   * @param {number} page 
   */
  async getCatalog(kind = 'username', filter = 'sale', sort = 'price_asc', page = 1) {
    const params = new URLSearchParams({ kind, filter, sort, page: String(page) });
    const res = await this.request(`/auctions/catalog?${params.toString()}`);
    if (!res.ok) return { items: [], has_more: false };
    return await res.json();
  }

  /**
   * Buy a lot instantly
   * @param {number} lotId 
   */
  async buyLot(lotId) {
    const res = await this.request(`/auctions/lots/${lotId}/buy`, {
      method: 'POST',
      body: {}
    });
    return res;
  }
}
