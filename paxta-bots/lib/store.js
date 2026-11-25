import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORE_PATH = path.resolve(__dirname, '..', 'data', 'store.json');

export const ADMIN_USER_IDS = new Set([100]);

const EMPTY_DATA = () => ({
  version: 1,
  users: {},
  bots: {},
  checks: {},
  payments: [],
  transactions: [],
});

/**
 * Persistent JSON store shared across all 4 bots in the runner process.
 * Uses in-memory state + serialized atomic disk writes (.tmp -> rename).
 */
export class Store {
  constructor(filePath = DEFAULT_STORE_PATH) {
    this.filePath = filePath;
    this.data = EMPTY_DATA();
    this._loaded = false;
    this._dirty = false;
    this._saveTimer = null;
    this._writeChain = Promise.resolve();
  }

  /**
   * Load store from disk (creates directory/file if missing).
   */
  async init() {
    if (this._loaded) return this;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = {
        ...EMPTY_DATA(),
        ...parsed,
        users: parsed.users || {},
        bots: parsed.bots || {},
        checks: parsed.checks || {},
        payments: Array.isArray(parsed.payments) ? parsed.payments : [],
        transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[store] Failed to read store.json, starting fresh:', err.message);
      }
      this.data = EMPTY_DATA();
      await this.flush();
    }
    this._loaded = true;
    return this;
  }

  _scheduleSave() {
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      void this.flush();
    }, 150);
  }

  /**
   * Immediately persist pending changes atomically.
   */
  async flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._dirty = false;
    const payload = JSON.stringify(this.data, null, 2);
    this._writeChain = this._writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmpPath = `${this.filePath}.${process.pid}.tmp`;
      await fs.writeFile(tmpPath, payload, 'utf8');
      await fs.rename(tmpPath, this.filePath);
    }).catch((err) => {
      console.error('[store] Failed to flush store:', err);
    });
    return this._writeChain;
  }

  /**
   * Synchronous flush for process exit handlers.
   */
  flushSync() {
    if (!this._dirty && !this._saveTimer) return;
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._dirty = false;
    try {
      fsSync.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmpPath = `${this.filePath}.${process.pid}.tmp`;
      fsSync.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf8');
      fsSync.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error('[store] flushSync error:', err.message);
    }
  }

  /**
   * Check whether a user ID or user object has admin privileges (@hold, user_id: 100).
   */
  isAdmin(userOrId) {
    if (userOrId == null) return false;
    if (typeof userOrId === 'object') {
      const id = Number(userOrId.id ?? userOrId.user_id);
      if (Number.isFinite(id) && ADMIN_USER_IDS.has(id)) return true;
      if (userOrId.id == null && userOrId.user_id == null && typeof userOrId.username === 'string') {
        const uname = userOrId.username.replace(/^@/, '').toLowerCase();
        return uname === 'hold' || uname === 'escobar';
      }
      return false;
    }
    const id = Number(userOrId);
    return Number.isFinite(id) && ADMIN_USER_IDS.has(id);
  }

  _ensureBot(botName) {
    if (!this.data.bots[botName]) {
      this.data.bots[botName] = {
        totalRequests: 0,
        freeUses: 0,
        paidUses: 0,
        revenueStars: 0,
        realStarsReceived: 0,
        giftWithdrawalsCount: 0,
        giftWithdrawalsCost: 0,
        giftWithdrawalsBotBilled: 0,
        lastActive: null,
      };
    }
    return this.data.bots[botName];
  }

  _ensureUser(userOrId) {
    const isObj = typeof userOrId === 'object' && userOrId !== null;
    const id = String(isObj ? (userOrId.id ?? userOrId.user_id) : userOrId);
    const now = new Date().toISOString();
    if (!this.data.users[id]) {
      this.data.users[id] = {
        id: Number(id),
        username: isObj && userOrId.username ? userOrId.username.replace(/^@/, '') : null,
        first_name: isObj ? (userOrId.first_name || null) : null,
        last_name: isObj ? (userOrId.last_name || null) : null,
        balance: 0,
        freeUses: {},
        paidUses: {},
        starsSpent: {},
        totalStarsSpent: 0,
        firstSeen: now,
        lastSeen: now,
      };
    } else if (isObj) {
      const u = this.data.users[id];
      if (userOrId.username !== undefined) {
        u.username = userOrId.username ? userOrId.username.replace(/^@/, '') : u.username;
      }
      if (userOrId.first_name !== undefined) u.first_name = userOrId.first_name || u.first_name;
      if (userOrId.last_name !== undefined) u.last_name = userOrId.last_name || u.last_name;
      u.lastSeen = now;
    } else {
      this.data.users[id].lastSeen = now;
    }
    return this.data.users[id];
  }

  touchUser(botName, user) {
    if (!user) return null;
    const u = this._ensureUser(user);
    if (botName) {
      const b = this._ensureBot(botName);
      b.lastActive = new Date().toISOString();
    }
    this._scheduleSave();
    return u;
  }

  getUser(userId) {
    return this.data.users[String(userId)] || null;
  }

  getBalance(userId) {
    const u = this.data.users[String(userId)];
    return u ? Number(u.balance || 0) : 0;
  }

  addBalance(userOrId, amount, meta = {}) {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return { ok: false, reason: 'invalid_amount', balance: this.getBalance(typeof userOrId === 'object' ? userOrId.id : userOrId) };
    }
    const u = this._ensureUser(userOrId);
    u.balance = Number((u.balance + amt).toFixed(4));
    this._pushTx({
      userId: u.id,
      type: meta.type || 'deposit',
      amount: amt,
      botName: meta.botName || null,
      ref: meta.ref || null,
    });
    this._scheduleSave();
    return { ok: true, balance: u.balance };
  }

  deductBalance(userOrId, amount, meta = {}) {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) {
      return { ok: false, reason: 'invalid_amount', balance: this.getBalance(typeof userOrId === 'object' ? userOrId.id : userOrId) };
    }
    const u = this._ensureUser(userOrId);
    if (amt === 0) return { ok: true, balance: u.balance };
    if (u.balance < amt) {
      return { ok: false, reason: 'insufficient_balance', balance: u.balance };
    }
    u.balance = Number((u.balance - amt).toFixed(4));
    this._pushTx({
      userId: u.id,
      type: meta.type || 'spend',
      amount: -amt,
      botName: meta.botName || null,
      ref: meta.ref || null,
    });
    this._scheduleSave();
    return { ok: true, balance: u.balance };
  }

  getFreeUsesUsed(botName, userId) {
    const u = this.data.users[String(userId)];
    return u ? Number(u.freeUses?.[botName] || 0) : 0;
  }

  getFreeUsesRemaining(botName, userId, limit = 1) {
    if (this.isAdmin(userId)) return Infinity;
    const used = this.getFreeUsesUsed(botName, userId);
    return Math.max(0, limit - used);
  }

  canUseFree(botName, userId, limit = 1) {
    return this.getFreeUsesRemaining(botName, userId, limit) > 0;
  }

  consumeFreeUse(botName, userOrId, limit = 1) {
    const u = this._ensureUser(userOrId);
    const b = this._ensureBot(botName);
    const admin = this.isAdmin(u);
    if (!admin && this.getFreeUsesRemaining(botName, u.id, limit) <= 0) {
      return false;
    }
    u.freeUses[botName] = (u.freeUses[botName] || 0) + 1;
    b.totalRequests += 1;
    b.freeUses += 1;
    b.lastActive = new Date().toISOString();
    this._scheduleSave();
    return true;
  }

  recordPaidUse(botName, userOrId, stars, meta = {}) {
    const amt = Number(stars) || 0;
    const realStars = meta.realStars !== undefined ? Number(meta.realStars) : Math.floor(amt * 0.85);
    const u = this._ensureUser(userOrId);
    const b = this._ensureBot(botName);
    u.paidUses[botName] = (u.paidUses[botName] || 0) + 1;
    u.starsSpent[botName] = (u.starsSpent[botName] || 0) + amt;
    u.totalStarsSpent += amt;
    b.totalRequests += 1;
    b.paidUses += 1;
    b.revenueStars += amt;
    b.realStarsReceived = (b.realStarsReceived || 0) + realStars;
    b.lastActive = new Date().toISOString();
    if (amt > 0) {
      this._pushPayment({
        userId: u.id,
        botName,
        stars: amt,
        realStars,
        payload: meta.payload || null,
        chargeId: meta.chargeId || null,
        status: 'paid',
      });
    }
    this._scheduleSave();
    return { user: u, bot: b, realStars };
  }

  recordGiftWithdrawal(userOrId, botCostStars, realGiftCostStars, giftTitle) {
    const u = this._ensureUser(userOrId);
    const b = this._ensureBot('checkbot');
    const botCost = Number(botCostStars) || 0;
    const realCost = Number(realGiftCostStars) || 0;
    b.giftWithdrawalsCount = (b.giftWithdrawalsCount || 0) + 1;
    b.giftWithdrawalsCost = (b.giftWithdrawalsCost || 0) + realCost;
    b.giftWithdrawalsBotBilled = (b.giftWithdrawalsBotBilled || 0) + botCost;
    b.totalRequests += 1;
    b.lastActive = new Date().toISOString();
    this._pushTx({
      userId: u.id,
      type: 'gift_withdraw',
      amount: -botCost,
      realCost,
      botName: 'checkbot',
      ref: giftTitle || null,
    });
    this._scheduleSave();
    return { user: u, bot: b };
  }

  recordRequest(botName, userOrId) {
    const u = this._ensureUser(userOrId);
    const b = this._ensureBot(botName);
    b.totalRequests += 1;
    b.lastActive = new Date().toISOString();
    this._scheduleSave();
    return { user: u, bot: b };
  }

  // --- Checkbot (Stars checks) ---

  createCheck({
    creator,
    creatorId,
    creatorName,
    amountPerClaim,
    totalClaims = 1,
    feeStars = 0,
    comment = '',
    chargeCreator = true,
  }) {
    const cId = Number(creator?.id ?? creatorId);
    const amt = Number(amountPerClaim);
    const claims = Math.max(1, Math.floor(Number(totalClaims)));
    const fee = Math.max(0, Number(feeStars) || 0);

    if (!Number.isFinite(cId) || !Number.isFinite(amt) || amt <= 0) {
      return { ok: false, reason: 'invalid_params' };
    }

    const u = this._ensureUser(creator || cId);
    const totalCost = amt * claims + (this.isAdmin(cId) ? 0 : fee);

    if (chargeCreator && !this.isAdmin(cId)) {
      if (u.balance < totalCost) {
        return { ok: false, reason: 'insufficient_balance', required: totalCost, balance: u.balance };
      }
      u.balance = Number((u.balance - totalCost).toFixed(4));
      this._pushTx({
        userId: u.id,
        type: 'check_create',
        amount: -totalCost,
        botName: 'checkbot',
        ref: null,
      });
    }

    const code = crypto.randomBytes(6).toString('base64url');
    const check = {
      id: code,
      code,
      creatorId: u.id,
      creatorName: creatorName || u.username || u.first_name || `User ${u.id}`,
      amountPerClaim: amt,
      totalClaims: claims,
      feeStars: this.isAdmin(cId) ? 0 : fee,
      comment: String(comment || '').slice(0, 120),
      claimedBy: [],
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    this.data.checks[code] = check;
    const b = this._ensureBot('checkbot');
    b.totalRequests += 1;
    if (!this.isAdmin(cId) && fee > 0) {
      b.revenueStars += fee;
      b.paidUses += 1;
    }
    b.lastActive = new Date().toISOString();
    this._scheduleSave();

    return { ok: true, check, balance: u.balance };
  }

  getCheck(code) {
    if (!code) return null;
    return this.data.checks[String(code).trim()] || null;
  }

  getUserChecks(creatorId) {
    const cid = Number(creatorId);
    return Object.values(this.data.checks)
      .filter((c) => c.creatorId === cid)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  claimCheck(code, claimer) {
    const check = this.getCheck(code);
    if (!check) return { ok: false, reason: 'not_found' };
    if (check.status !== 'active') return { ok: false, reason: check.status, check };

    const u = this._ensureUser(claimer);
    if (check.claimedBy.some((c) => c.userId === u.id)) {
      return { ok: false, reason: 'already_claimed', check };
    }
    if (check.claimedBy.length >= check.totalClaims) {
      check.status = 'completed';
      this._scheduleSave();
      return { ok: false, reason: 'completed', check };
    }

    check.claimedBy.push({
      userId: u.id,
      username: u.username || u.first_name || `User ${u.id}`,
      amount: check.amountPerClaim,
      claimedAt: new Date().toISOString(),
    });

    u.balance = Number((u.balance + check.amountPerClaim).toFixed(4));
    this._pushTx({
      userId: u.id,
      type: 'check_claim',
      amount: check.amountPerClaim,
      botName: 'checkbot',
      ref: check.code,
    });

    if (check.claimedBy.length >= check.totalClaims) {
      check.status = 'completed';
    }

    this._scheduleSave();
    return {
      ok: true,
      amount: check.amountPerClaim,
      remaining: check.totalClaims - check.claimedBy.length,
      balance: u.balance,
      check,
    };
  }

  cancelCheck(code, userId) {
    const check = this.getCheck(code);
    if (!check) return { ok: false, reason: 'not_found' };
    if (check.creatorId !== Number(userId) && !this.isAdmin(userId)) {
      return { ok: false, reason: 'forbidden' };
    }
    if (check.status !== 'active') {
      return { ok: false, reason: check.status, check };
    }
    const remainingClaims = Math.max(0, check.totalClaims - check.claimedBy.length);
    const refund = remainingClaims * check.amountPerClaim;
    check.status = 'cancelled';
    if (refund > 0 && !this.isAdmin(check.creatorId)) {
      const creator = this._ensureUser(check.creatorId);
      creator.balance = Number((creator.balance + refund).toFixed(4));
      this._pushTx({
        userId: creator.id,
        type: 'check_refund',
        amount: refund,
        botName: 'checkbot',
        ref: check.code,
      });
    }
    this._scheduleSave();
    return { ok: true, refund, check };
  }

  _pushPayment(payment) {
    this.data.payments.push({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...payment,
    });
    if (this.data.payments.length > 500) {
      this.data.payments = this.data.payments.slice(-500);
    }
  }

  _pushTx(tx) {
    this.data.transactions.push({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...tx,
    });
    if (this.data.transactions.length > 1000) {
      this.data.transactions = this.data.transactions.slice(-1000);
    }
  }

  getAdminStats(botName = null) {
    const users = Object.values(this.data.users);
    const checks = Object.values(this.data.checks);
    const bots = this.data.bots;

    let totalRevenueStars = 0;
    let totalRealStarsReceived = 0;
    let totalGiftWithdrawalsCount = 0;
    let totalGiftWithdrawalsCost = 0;
    let totalGiftWithdrawalsBotBilled = 0;
    let totalRequests = 0;
    let totalFreeUses = 0;
    let totalPaidUses = 0;

    for (const [name, stats] of Object.entries(bots)) {
      if (botName && name !== botName) continue;
      totalRevenueStars += stats.revenueStars || 0;
      totalRealStarsReceived += stats.realStarsReceived ?? Math.floor((stats.revenueStars || 0) * 0.85);
      totalGiftWithdrawalsCount += stats.giftWithdrawalsCount || 0;
      totalGiftWithdrawalsCost += stats.giftWithdrawalsCost || 0;
      totalGiftWithdrawalsBotBilled += stats.giftWithdrawalsBotBilled || 0;
      totalRequests += stats.totalRequests || 0;
      totalFreeUses += stats.freeUses || 0;
      totalPaidUses += stats.paidUses || 0;
    }

    const activeChecks = checks.filter((c) => c.status === 'active');
    const totalChecksVolume = checks.reduce((sum, c) => sum + c.amountPerClaim * c.totalClaims, 0);

    const topUsers = [...users]
      .sort((a, b) => (b.totalStarsSpent || 0) - (a.totalStarsSpent || 0))
      .slice(0, 5)
      .map((u) => ({
        id: u.id,
        username: u.username,
        first_name: u.first_name,
        totalStarsSpent: u.totalStarsSpent || 0,
        balance: u.balance || 0,
      }));

    return {
      totalUsers: users.length,
      totalRevenueStars,
      totalRealStarsReceived,
      totalGiftWithdrawalsCount,
      totalGiftWithdrawalsCost,
      totalGiftWithdrawalsBotBilled,
      netProfitStars: totalRealStarsReceived - totalGiftWithdrawalsCost,
      totalRequests,
      totalFreeUses,
      totalPaidUses,
      bots,
      activeChecksCount: activeChecks.length,
      totalChecksCount: checks.length,
      totalChecksVolume,
      topUsers,
      recentPayments: this.data.payments.slice(-10).reverse(),
    };
  }
}

export const store = new Store();
export default store;
