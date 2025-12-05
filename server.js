/**
 * server.js — NEXBIT 完整统一版（最终）
 *
 * 功能：
 *  - 支持 Firebase RTDB（可选）或使用内存回退（便于本地测试）
 *  - 静态文件托管：public 目录（dashboard-brand.html 等放这里）
 *  - 完整 API（兼容你的前端/管理后台）：
 *      POST /api/user/sync             - 同步/创建用户
 *      POST /api/balance               - 查询或设置余额（设置需管理员 key）
 *      GET  /api/balance/:userId       - 查询余额（只读）
 *      POST /api/order/recharge        - 创建充值订单
 *      POST /api/order/withdraw       - 创建提现订单
 *      POST /api/order/buysell        - 创建买卖订单
 *      GET  /proxy/transactions       - 查询订单（dashboard 使用）
 *      GET  /api/admin/users          - 列出用户（管理员）
 *      GET  /api/orders               - 获取所有订单（管理）
 *      POST /api/order/update-status  - 更新订单状态（管理员）
 *      GET  /api/settings, POST /api/settings - 系统设置（管理员）
 *
 *  - Telegram 通知支持
 *  - 管理鉴权：通过环境变量 ADMIN_API_KEY（HTTP Header: X-Admin-Key）
 *
 * 环境变量（在 Railway/Heroku/Prod 设置）：
 *  - FIREBASE_SERVICE_ACCOUNT  (可选) : 整个 JSON 字符串
 *  - FIREBASE_DATABASE_URL    (可选) : https://your-project-default-rtdb.firebaseio.com
 *  - ADMIN_API_KEY             (可选) : 简易管理员鉴权
 *  - TELEGRAM_BOT_TOKEN       (可选)
 *  - TELEGRAM_CHAT_IDS        (可选) : 逗号分隔
 *  - PORT
 *
 * 安全提醒：
 *  - 生产请替换 ADMIN_API_KEY、使用 HTTPS、限制 CORS Origin
 *  - 不要把 service account 公共暴露
 */

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');

const app = express();
app.use(helmet());
app.use(bodyParser.json({ limit: '8mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

/* ---------------------------
   CORS 配置（默认允许所有）
   生产建议将 origin 限定为你的 Strikingly 域名
   --------------------------- */
app.use(cors({
  origin: (origin, cb) => { cb(null, true); },
  credentials: true
}));

/* ---------------------------
   静态文件：public 目录
   放置 dashboard-brand.html, recharge.html, withdraw.html, buysell.html
   --------------------------- */
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------------------
   Firebase 初始化（可选）
   --------------------------- */
let useFirebase = false;
let admin = null;
let db = null;

const FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT || '';
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL || '';

if (FIREBASE_SERVICE_ACCOUNT && FIREBASE_DATABASE_URL) {
  try {
    admin = require('firebase-admin');
    const svc = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(svc),
      databaseURL: FIREBASE_DATABASE_URL
    });
    db = admin.database();
    useFirebase = true;
    console.log('[server] Firebase inited:', FIREBASE_DATABASE_URL);
  } catch (e) {
    console.warn('[server] Firebase init failed, falling back to memory store:', e.message);
    useFirebase = false;
  }
} else {
  console.log('[server] Firebase not configured - using in-memory store');
}

/* ---------------------------
   内存回退存储（开发/测试）
   --------------------------- */
const memory = {
  users: {},      // { [userId]: { balance, createdAt, meta... } }
  orders: [],     // array of order objects
  settings: { telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '', telegramChatIds: (process.env.TELEGRAM_CHAT_IDS || '').split(',').filter(Boolean) }
};

/* ---------------------------
   简单 DB 抽象函数：get/set/push/update
   目的：对 firebase 与 memory 做统一接口
   --------------------------- */
async function dbGet(path) {
  if (useFirebase) {
    const snap = await db.ref(path).once('value');
    return snap.val();
  } else {
    if (path === '/users') return memory.users;
    if (path === '/orders') return memory.orders;
    if (path === '/settings') return memory.settings;
    return null;
  }
}
async function dbSet(path, value) {
  if (useFirebase) {
    await db.ref(path).set(value);
    return true;
  } else {
    if (path === '/settings') { memory.settings = value; return true; }
    return false;
  }
}
async function dbPush(path, value) {
  if (useFirebase) {
    const ref = db.ref(path).push();
    await ref.set(value);
    return ref.key;
  } else {
    if (path === '/orders') {
      memory.orders.push(value);
      return memory.orders.length - 1;
    }
    return null;
  }
}
async function dbUpdate(path, patch) {
  if (useFirebase) {
    await db.ref(path).update(patch);
    return true;
  } else {
    if (path.startsWith('/users/')) {
      const id = path.split('/')[2];
      memory.users[id] = Object.assign({}, memory.users[id] || {}, patch);
      return true;
    }
    return false;
  }
}

/* ---------------------------
   Helper: ensure user exists
   --------------------------- */
async function ensureUser(userId) {
  if (!userId) return;
  if (useFirebase) {
    const ref = db.ref(`/users/${userId}`);
    const snap = await ref.once('value');
    if (!snap.exists()) {
      await ref.set({ balance: 0, createdAt: Date.now(), meta: {} });
    }
  } else {
    if (!memory.users[userId]) memory.users[userId] = { balance: 0, createdAt: Date.now(), meta: {} };
  }
}

/* ---------------------------
   Helper: get user balance
   --------------------------- */
async function getUserBalance(userId) {
  if (!userId) return 0;
  if (useFirebase) {
    const snap = await db.ref(`/users/${userId}`).once('value');
    const u = snap.val() || { balance: 0 };
    return Number(u.balance || 0);
  } else {
    return Number((memory.users[userId] && memory.users[userId].balance) || 0);
  }
}

/* ---------------------------
   Helper: adjust user balance (set or delta)
   - mode: 'set' or 'delta' (delta can be negative)
   - adminOnly: perform checks outside if you want
   --------------------------- */
async function adjustUserBalance({ userId, amount, mode = 'delta' }) {
  await ensureUser(userId);
  if (useFirebase) {
    const ref = db.ref(`/users/${userId}`);
    const snap = await ref.once('value');
    const u = snap.val() || { balance: 0 };
    const cur = Number(u.balance || 0);
    const newBal = (mode === 'set') ? Number(amount) : cur + Number(amount);
    await ref.update({ balance: newBal, updatedAt: Date.now() });
    return newBal;
  } else {
    const cur = Number((memory.users[userId] && memory.users[userId].balance) || 0);
    const newBal = (mode === 'set') ? Number(amount) : cur + Number(amount);
    memory.users[userId].balance = newBal;
    memory.users[userId].updatedAt = Date.now();
    return newBal;
  }
}

/* ---------------------------
   Telegram helper
   --------------------------- */
async function sendTelegramMessage(text) {
  // prefer env vars, then settings in memory / firebase
  let botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  let chatIds = (process.env.TELEGRAM_CHAT_IDS || '').split(',').filter(Boolean);
  if ((!botToken || chatIds.length === 0)) {
    // try system settings stored in DB/memory
    const s = await dbGet('/settings');
    if (s && s.telegramBotToken) botToken = s.telegramBotToken;
    if (s && s.telegramChatIds) chatIds = (s.telegramChatIds || []).slice();
    // fallback to memory.settings
    if ((!botToken || chatIds.length === 0) && memory.settings) {
      if (!botToken && memory.settings.telegramBotToken) botToken = memory.settings.telegramBotToken;
      if ((chatIds.length === 0) && memory.settings.telegramChatIds) chatIds = (memory.settings.telegramChatIds || []).slice();
    }
  }

  if (!botToken || !chatIds || chatIds.length === 0) return false;
  const urlBase = `https://api.telegram.org/bot${botToken}/sendMessage`;

  for (const chatId of chatIds) {
    try {
      await fetch(urlBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
      });
    } catch (e) {
      console.warn('[telegram] send fail', e.message);
    }
  }
  return true;
}

/* ---------------------------
   Admin auth middleware（简单）
   - ADMIN_API_KEY 环境变量
   - 请求需带 header: X-Admin-Key
   --------------------------- */
function requireAdmin(req, res, next) {
  const adminKey = process.env.ADMIN_API_KEY || '';
  if (!adminKey) return res.status(403).json({ ok: false, error: 'admin key not configured' });
  const header = (req.headers['x-admin-key'] || req.headers['x-admin-key'.toLowerCase()] || '').toString();
  if (!header || header !== adminKey) return res.status(401).json({ ok: false, error: 'invalid admin key' });
  next();
}

/* ---------------------------
   Logging middleware (simple)
   --------------------------- */
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

/* -----------------------------------
   ROUTES
   ----------------------------------- */

/**
 * Health
 */
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now(), firebase: useFirebase });
});

/**
 * API: /api/user/sync
 * POST { userId }
 * header X-User-Id optional
 * => create user record if not exists
 */
app.post('/api/user/sync', async (req, res) => {
  try {
    const uid = (req.body && (req.body.userId || req.body.userid)) || req.headers['x-user-id'] || req.headers['x-user-id'.toLowerCase()];
    if (!uid) return res.status(400).json({ success: false, error: 'missing userId' });
    await ensureUser(uid);
    return res.json({ success: true, userId: uid });
  } catch (e) {
    console.error('/api/user/sync err', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * API: POST /api/balance
 * 用途：
 *  - 查询余额：POST { userid } （或 header X-User-Id）
 *  - 管理设置余额：POST { userId, newBalance } （需要 Admin）
 */
app.post('/api/balance', async (req, res) => {
  try {
    const body = req.body || {};
    const headerUid = req.headers['x-user-id'] || req.headers['x-user-id'.toLowerCase()];
    const userId = body.userid || body.userId || headerUid;
    if (!userId) return res.status(400).json({ success: false, error: 'missing userid' });

    // 设置余额（必须是管理员）
    if (typeof body.newBalance !== 'undefined') {
      // check admin
      const adminKey = process.env.ADMIN_API_KEY || '';
      const header = (req.headers['x-admin-key'] || req.headers['x-admin-key'.toLowerCase()] || '').toString();
      if (!adminKey || header !== adminKey) return res.status(403).json({ success: false, error: 'admin required' });

      const nb = Number(body.newBalance);
      if (isNaN(nb)) return res.status(400).json({ success: false, error: 'invalid newBalance' });
      const after = await adjustUserBalance({ userId, amount: nb, mode: 'set' });
      return res.json({ success: true, userId, balance: after });
    }

    // 查询余额
    await ensureUser(userId);
    const bal = await getUserBalance(userId);
    return res.json({ success: true, userId, balance: bal });
  } catch (e) {
    console.error('/api/balance err', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/balance/:userId - 只读查询
 */
app.get('/api/balance/:userId', async (req, res) => {
  try {
    const uid = req.params.userId;
    if (!uid) return res.status(400).json({ success: false, error: 'missing userId' });
    await ensureUser(uid);
    const bal = await getUserBalance(uid);
    return res.json({ success: true, userId: uid, balance: bal });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/order/recharge
 * body: { userid, coin, amount, wallet, meta... }
 * Creates a recharge order (status: pending)
 */
app.post('/api/order/recharge', async (req, res) => {
  try {
    const { userid, userId, coin, amount, wallet, ...rest } = req.body || {};
    const uid = userid || userId || req.headers['x-user-id'] || req.headers['x-user-id'.toLowerCase()];
    if (!uid || typeof amount === 'undefined') return res.status(400).json({ success: false, error: 'missing userid or amount' });

    await ensureUser(uid);
    const orderId = 'R-' + uuidv4();
    const rec = {
      type: 'recharge',
      orderId,
      userId: uid,
      coin: coin || 'USDT',
      amount: Number(amount),
      wallet: wallet || '',
      status: 'pending',
      time: Date.now(),
      meta: rest
    };

    await dbPush('/orders', rec);

    // Notify (async)
    const text = `💳 New Recharge\nOrder: ${orderId}\nUser: ${uid}\nCoin: ${rec.coin}\nAmount: ${rec.amount}`;
    sendTelegramMessage(text).catch(()=>{});

    return res.json({ success: true, orderId });
  } catch (e) {
    console.error('/api/order/recharge err', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/order/withdraw
 * body: { userid, coin, amount, wallet, hash?, ... }
 * Creates withdraw order (status: processing)
 */
app.post('/api/order/withdraw', async (req, res) => {
  try {
    const { userid, userId, coin, amount, wallet, hash, ...rest } = req.body || {};
    const uid = userid || userId || req.headers['x-user-id'] || req.headers['x-user-id'.toLowerCase()];
    if (!uid || typeof amount === 'undefined' || !wallet) return res.status(400).json({ success: false, error: 'missing params' });

    await ensureUser(uid);
    const orderId = 'W-' + uuidv4();
    const rec = {
      type: 'withdraw',
      orderId,
      userId: uid,
      coin: coin || 'USDT',
      amount: Number(amount),
      wallet,
      txHash: hash || '',
      status: 'processing',
      time: Date.now(),
      meta: rest
    };

    await dbPush('/orders', rec);

    const text = `💸 New Withdraw\nOrder: ${orderId}\nUser: ${uid}\nCoin: ${rec.coin}\nAmount: ${rec.amount}\nWallet: ${wallet}`;
    sendTelegramMessage(text).catch(()=>{});

    return res.json({ success: true, orderId });
  } catch (e) {
    console.error('/api/order/withdraw err', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/order/buysell
 * body: { userid, side, pair or coin, qty or amount, price?(optional) ... }
 * Creates a trade order (status: filled in this simplified example)
 */
app.post('/api/order/buysell', async (req, res) => {
  try {
    const { userid, userId, side, pair, coin, qty, price, amount, ...rest } = req.body || {};
    const uid = userid || userId || req.headers['x-user-id'] || req.headers['x-user-id'.toLowerCase()];
    if (!uid || !side || (!(pair || coin) || (!qty && !amount))) return res.status(400).json({ success: false, error: 'missing params' });

    await ensureUser(uid);
    const execPrice = price ? Number(price) : (rest.execPrice || 100);
    const total = qty ? Number(qty) * execPrice : Number(amount || 0);

    const orderId = (side === 'sell' ? 'S-' : 'B-') + uuidv4();
    const rec = {
      type: 'trade',
      orderId,
      userId: uid,
      side,
      pair: pair || coin,
      qty: Number(qty || 0),
      price: Number(execPrice),
      total: Number(total),
      status: 'filled',
      time: Date.now(),
      meta: rest
    };

    await dbPush('/orders', rec);

    // 简单记账：buy 扣 USD，sell 加 USD（示例）
    await adjustUserBalance({ userId: uid, amount: (side === 'buy' ? -total : total), mode: 'delta' });

    const text = `🪙 New Trade\nOrder: ${orderId}\nUser: ${uid}\nSide: ${side}\nPair: ${rec.pair}\nQty: ${rec.qty}\nPrice: ${rec.price}`;
    sendTelegramMessage(text).catch(()=>{});

    return res.json({ success: true, orderId });
  } catch (e) {
    console.error('/api/order/buysell err', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /proxy/transactions
 * Dashboard uses this to list orders.
 * Supports query filters: start,end,wallet,q,type,status,currency
 */
app.get('/proxy/transactions', async (req, res) => {
  try {
    const list = await dbGet('/orders') || [];
    let arr = [];
    if (useFirebase) {
      if (typeof list === 'object' && !Array.isArray(list)) arr = Object.keys(list).map(k => list[k]);
      else arr = list;
    } else arr = list;

    const { start, end, wallet, q, type, status, currency } = req.query;
    let filtered = arr;

    if (start) {
      const sTs = Date.parse(start);
      if (!isNaN(sTs)) filtered = filtered.filter(it => (it.time || it.timestamp || 0) >= sTs);
    }
    if (end) {
      const eTs = Date.parse(end);
      if (!isNaN(eTs)) filtered = filtered.filter(it => (it.time || it.timestamp || 0) <= eTs + 24*3600*1000);
    }
    if (wallet) filtered = filtered.filter(it => (((it.wallet || '') + '') + ((it.userId || '') + '') + ((it.orderId || '') + '')).indexOf(wallet) !== -1);
    if (q) filtered = filtered.filter(it => JSON.stringify(it).toLowerCase().indexOf(q.toLowerCase()) !== -1);
    if (type) filtered = filtered.filter(it => (it.type || '').toLowerCase() === type.toLowerCase());
    if (status) filtered = filtered.filter(it => (it.status || '').toLowerCase() === status.toLowerCase());
    if (currency) filtered = filtered.filter(it => ((it.coin || it.currency || it.pair || '') + '').toLowerCase() === currency.toLowerCase());

    return res.json(filtered);
  } catch (e) {
    console.error('/proxy/transactions err', e);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/admin/users - 列出所有用户（管理员）
 */
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    if (useFirebase) {
      const snap = await db.ref('/users').once('value');
      const obj = snap.val() || {};
      const arr = Object.keys(obj).map(k => ({ userId: k, ...obj[k] }));
      return res.json(arr);
    } else {
      const arr = Object.keys(memory.users).map(k => ({ userId: k, ...memory.users[k] }));
      return res.json(arr);
    }
  } catch (e) {
    console.error('/api/admin/users err', e);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/orders - 返回所有订单（管理员）
 */
app.get('/api/orders', requireAdmin, async (req, res) => {
  try {
    const list = await dbGet('/orders') || [];
    let arr = [];
    if (useFirebase) {
      if (typeof list === 'object' && !Array.isArray(list)) arr = Object.keys(list).map(k => list[k]);
      else arr = list;
    } else arr = list;
    return res.json({ success: true, orders: arr });
  } catch (e) {
    console.error('/api/orders err', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/order/update-status
 * body: { orderId, status } - 更新订单状态（管理员）
 */
app.post('/api/order/update-status', requireAdmin, async (req, res) => {
  try {
    const { orderId, status } = req.body || {};
    if (!orderId || !status) return res.status(400).json({ ok: false, error: 'missing params' });

    if (useFirebase) {
      const snap = await db.ref('/orders').once('value');
      const obj = snap.val() || {};
      const key = Object.keys(obj).find(k => (obj[k].orderId || '') === orderId);
      if (!key) return res.status(404).json({ ok: false, error: 'order not found' });
      await db.ref(`/orders/${key}`).update({ status, updatedAt: Date.now() });
      return res.json({ ok: true });
    } else {
      const idx = memory.orders.findIndex(o => o.orderId === orderId);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'order not found' });
      memory.orders[idx].status = status;
      memory.orders[idx].updatedAt = Date.now();
      return res.json({ ok: true });
    }
  } catch (e) {
    console.error('/api/order/update-status err', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/settings
 * POST /api/settings  (管理员)
 */
app.get('/api/settings', requireAdmin, async (req, res) => {
  try {
    const s = await dbGet('/settings');
    return res.json(s || (useFirebase ? {} : memory.settings));
  } catch (e) {
    console.error('/api/settings GET err', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});
app.post('/api/settings', requireAdmin, async (req, res) => {
  try {
    const payload = req.body || {};
    await dbSet('/settings', payload);
    if (!useFirebase) memory.settings = payload;
    return res.json({ ok: true });
  } catch (e) {
    console.error('/api/settings POST err', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/* Fallback: serve frontend dashboard if requested root */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard-brand.html'));
});

/* 404 handler for unknown routes */
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'not found' });
});

/* Start server */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] listening on ${PORT} (Firebase=${useFirebase})`);
});
