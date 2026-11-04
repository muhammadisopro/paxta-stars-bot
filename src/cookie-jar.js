export class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  setFromHeaders(headers) {
    const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const c of raw) {
      const firstPart = c.split(';')[0].trim();
      const eqIdx = firstPart.indexOf('=');
      if (eqIdx !== -1) {
        const key = firstPart.slice(0, eqIdx).trim();
        const val = firstPart.slice(eqIdx + 1).trim();
        this.cookies.set(key, val);
      }
    }
  }

  getCookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  getXSRFToken() {
    const val = this.cookies.get('XSRF-TOKEN');
    return val ? decodeURIComponent(val) : '';
  }
}
