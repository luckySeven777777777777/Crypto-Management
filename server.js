/**
 * server.js — 完整统一版
 *
 * 特性：
 * - 可选 Firebase RTDB 支持（由 FIREBASE_SERVICE_ACCOUNT & FIREBASE_DATABASE_URL 控制）
 * - 回退到内存存储以便本地调试
 * - 全面 CORS（可在 production 限定 origin）
 * - JSON body 解析
 * - 支持前端需要的所有 API：
 *   - POST /api/user/sync          （前端页眉/页脚调用，创建/同步用户）
 *   - POST /api/balance           （获取或设置余额；用于右上角显示 & 管理后台调整）
 *   - GET  /api/balance/:userId   （查询余额）
 *   - POST /api/order/recharge
 *   - POST /api/order/withdraw
 *   - POST /api/order/buysell
 *   - GET  /proxy/transactions    （dashboard 调用）
 *   - GET  /api/admin/users
 *   - GET  /api/orders
 *   - POST /api/order/update-status
 *   - GET  /api/settings
 *   - POST /api/settings
 *
 * - Telegram 通知（可由环境变量或 settings 提供）
 *
 * 环境变量：
 * - FIREBASE_SERVICE_ACCOUNT (可选) : 整个 service account JSON 字符串
 * - FIREBASE_DATABASE_URL (可选)   : RTDB URL, 如 https://xxxxx.firebaseio.com
 * - TELEGRAM_BOT_TOKEN (可选)
 * - TELEGRAM_CHAT_IDS (可选)       : 逗号分隔 chat id，例如 "6062973135,-1003262870745"
 * - PORT (可选)
 *
 * 注意：生产请务必添加鉴权（API KEY / JWT / session 等）以防滥用。
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');

let useFirebase = false;
let admin = null;
let db = null;

const FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT || '';
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL || '';

/* ---------- 初始化 Firebase（如果配置了） ---------- */
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
    console.log('[server] Firebase RTDB 已初始化：', FIREBASE_DATABASE_URL);
  } catch (e) {
    console.warn('[server] Firebase 初始化失败，回退到内存存储：', e.message);
    useFirebase = false;
  }
} else {
  console.log('[server] 未配置 Firebase，使用内存存储（仅调试）');
}

/* ---------- 内存回退数据结构 ---------- */
const memory = {
  users: {},    // users[userId] = { balance, createdAt, meta... }
  orders: [],   // orders array
  settings: { telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '', telegramChatIds: (process.env.TELEGRAM_CHAT_IDS || '').split(',').filter(Boolean) }
};

/* ---------- 简单 DB 抽象（支持 set/push/get/update） ---------- */
async function dbSet(path, value) {
  if (useFirebase) {
    await db.ref(path).set(value);
    return true;
  } else {
    if (path === '/settings') memory.settings = value;
    return true;
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
async function dbGet(path) {
  if (useFirebase) {
    const snap = await db.ref(path).once('value');
    return snap.val();
  } else {
    if (path === '/orders') return memory.orders;
    if (path === '/users') return memory.users;
    if (path === '/settings') return memory.settings;
    return null;
  }
}
async function dbUpdate(path, patch) {
  if (useFirebase) {
    await db.ref(path).update(patch);
    return true;
  } else {
    // only basic support for users
    if (path.startsWith('/users/')) {
      const id = path.split('/')[2];
      memory.users[id] = Object.assign({}, memory.users[id] || {}, patch);
      return true;
    }
    return false;
  }
}

/* ---------- Telegram 工具，异步发送 ---------- */
async function sendTelegramMessage(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN || (memory.settings && memory.settings.telegramBotToken) || '';
  const chatIdsStr = process.env.TELEGRAM_CHAT_IDS || (memory.settings && (memory.settings.telegramChatIds || []).join(','));
  if (!botToken || !chatIdsStr) return false;
  const chatIds = chatIdsStr.split(',').map(s => s.trim()).filter(Boolean);
  const urlBase = `https://api.telegram.org/bot${botToken}/sendMessage`;
  for (const chatId of chatIds) {
    try {
      await fetch(urlBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
      });
    } catch (e) {
      console.warn('[telegram] send fail to', chatId, e.message);
    }
  }
  return true;
}

/* ---------- ensureUser：创建或确保用户存在 ---------- */
async function ensureUser(userId) {
  if (!userId) return;
  if (useFirebase) {
    const ref = db.ref(`/users/${userId}`);
    const snap = await ref.once('value');
    if (!snap.exists()) {
      await ref.set({ balance: 0, createdAt: Date.now() });
    }
  } else {
    if (!memory.users[userId]) memory.users[userId] = { balance: 0, createdAt: Date.now() };
  }
}

/* ---------- Express app ---------- */
const app = express();
app.use(helmet());
app.use(bodyParser.json({ limit: '8mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// CORS：当前默认允许所有 origin。生产请改成指定 Strikingly 域名（例如：https://your-site.strikingly.com）
app.use(cors({
  origin: function(origin, callback){
    callback(null, true);
  },
  credentials: true
}));

/* ---------- Routes ---------- */

/** Health */
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now(), firebase: useFirebase }));

/**
 * 前端在页眉/页脚调用：同步（创建）用户
 * POST /api/user/sync
 * body: { userId }
 * header: X-User-Id 可选
 */
app.post('/api/user/sync', async (req, res) => {
  try {
    const uid = req.body && (req.body.userId || req.body.userid) || req.headers['x-user-id'] || req.headers['x-user-id'.toLowerCase()];
    if (!uid) return res.status(400).json({ ok: false, error: 'missing userId' });
    await ensureUser(uid);
    return res.json({ ok: true, userId: uid });
  } catch (e) {
    console.error('/api/user/sync error', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/balance
 *  用途（兼容你的前端）：
 *  - 前端右上角会 POST /api/balance { userid } 并带 X-User-Id header
 *  - 管理后台也会用 POST /api/balance 来调整余额（传 { userId, newBalance }）
 *
 * 如果 body 里只有 userid：返回余额（兼容你的右上角）
 * 如果 body 里有 userId 和 newBalance：设置余额（管理后台修改；注意：生产需鉴权）
 */
app.post('/api/balance', async (req, res) => {
  try {
    const body = req.body || {};
    const headerUid = req.headers['x-user-id'] || req.headers['x-user-id'.toLowerCase()];
    const userId = body.userid || body.userId || headerUid;
    if (!userId) return res.status(400).json({ success: false, error: 'missing userid' });

    // 如果传 newBalance，视为设置请求（管理后台）
    if (typeof body.newBalance !== 'undefined') {
      const newBal = Number(body.newBalance);
      if (isNaN(newBal)) return res.status(400).json({ success: false, error: 'invalid newBalance' });
      await ensureUser(userId);
      if (useFirebase) {
        await db.ref(`/users/${userId}`).update({ balance: newBal, updatedAt: Date.now() });
      } else {
        memory.users[userId].balance = newBal;
        memory.users[userId].updatedAt = Date.now();
      }
      return res.json({ success: true, userId, balance: newBal });
    }

    // 否则为查询余额
    await ensureUser(userId);
    if (useFirebase) {
      const snap = await db.ref(`/users/${userId}`).once('value');
      const u = snap.val() || { balance: 0 };
      return res.json({ success: true, userId, balance: u.balance || 0 });
    } else {
      const u = memory.users[userId] || { balance: 0 };
      return res.json({ success: true, userId, balance: u.balance || 0 });
    }
  } catch (e) {
    console.error('/api/balance error', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

/** GET /api/balance/:userId - 额外的 GET 查询接口（有时更方便） */
app.get('/api/balance/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    if (!userId) return res.status(400).json({ success: false, error: 'missing userId' });
    await ensureUser(userId);
    if (useFirebase) {
      const snap = await db.ref(`/users/${userId}`).once('value');
      const u = snap.val() || { balance: 0 };
      return res.json({ success: true, userId, balance: u.balance || 0 });
    } else {
      const u = memory.users[userId] || { balance: 0 };
      return res.json({ success: true, userId, balance: u.balance || 0 });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/order/recharge
 * body: { userid, coin, amount, wallet, ... }
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

    // Notify Telegram (async)
    const text = `💳 New Recharge\nOrder: ${orderId}\nUser: ${uid}\nCoin: ${rec.coin}\nAmount: ${rec.amount}`;
    sendTelegramMessage(text).catch(()=>{});

    return res.json({ success: true, orderId });
  } catch (e) {
    console.error('/api/order/recharge error', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/order/withdraw
 * body: { userid, coin, amount, wallet, hash?, ... }
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
    console.error('/api/order/withdraw error', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/order/buysell
 * body: { userid, side, pair or coin, qty or amount, price? ... }
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

    // 简单记账：buy 扣 USD，sell 加 USD（仅示例，生产请按实际账务逻辑）
    if (useFirebase) {
      try {
        const uRef = db.ref(`/users/${uid}`);
        const snap = await uRef.once('value');
        const u = snap.val() || { balance: 0 };
        u.balance = (u.balance || 0) + (side === 'buy' ? -total : total);
        await uRef.update({ balance: u.balance });
      } catch (e) { /* ignore */ }
    } else {
      memory.users[uid] = memory.users[uid] || { balance: 0 };
      memory.users[uid].balance += (side === 'buy' ? -total : total);
    }

    const text = `🪙 New Trade\nOrder: ${orderId}\nUser: ${uid}\nSide: ${side}\nPair: ${rec.pair}\nQty: ${rec.qty}\nPrice: ${rec.price}`;
    sendTelegramMessage(text).catch(()=>{});

    return res.json({ success: true, orderId });
  } catch (e) {
    console.error('/api/order/buysell error', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /proxy/transactions
 * Dashboard 使用：返回 orders 列表，支持简单筛选（start,end,wallet,q,type,status,currency）
 */
app.get('/proxy/transactions', async (req, res) => {
  try {
    const list = await dbGet('/orders') || [];
    let arr = [];
    if (useFirebase) {
      // firebase 返回 object keyed -> convert
      if (typeof list === 'object' && !Array.isArray(list)) {
        arr = Object.keys(list).map(k => list[k]);
      } else arr = list;
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
    if (wallet) filtered = filtered.filter(it => (((it.wallet||'') + '') + ((it.userId||'') + '') + ((it.orderId||'') + '')).indexOf(wallet) !== -1);
    if (q) filtered = filtered.filter(it => JSON.stringify(it).toLowerCase().indexOf(q.toLowerCase()) !== -1);
    if (type) filtered = filtered.filter(it => (it.type||'').toLowerCase() === type.toLowerCase());
    if (status) filtered = filtered.filter(it => (it.status||'').toLowerCase() === status.toLowerCase());
    if (currency) filtered = filtered.filter(it => ((it.coin||it.currency||it.pair||'') + '').toLowerCase() === currency.toLowerCase());

    return res.json(filtered);
  } catch (e) {
    console.error('/proxy/transactions error', e);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/admin/users
 * 返回用户列表（userId + 数据）
 */
app.get('/api/admin/users', async (req, res) => {
  try {
    if (useFirebase) {
      const snap = await db.ref('/users').once('value');
      const uobj = snap.val() || {};
      const arr = Object.keys(uobj).map(k => ({ userId: k, ...uobj[k] }));
      return res.json(arr);
    } else {
      const arr = Object.keys(memory.users).map(k => ({ userId: k, ...memory.users[k] }));
      return res.json(arr);
    }
  } catch (e) {
    console.error('/api/admin/users error', e);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/orders - 返回所有订单（少量数据用）
 */
app.get('/api/orders', async (req, res) => {
  try {
    const list = await dbGet('/orders') || [];
    let arr = [];
    if (useFirebase) {
      if (typeof list === 'object' && !Array.isArray(list)) arr = Object.keys(list).map(k => list[k]);
      else arr = list;
    } else arr = list;
    return res.json({ success: true, orders: arr });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/order/update-status
 * body: { orderId, status } - 管理后台用于更新订单状态
 */
app.post('/api/order/update-status', async (req, res) => {
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
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /api/settings
 * POST /api/settings
 * 用于保存/读取系统设置（例如 Telegram token / chat ids），生产请控制权限
 */
app.get('/api/settings', async (req, res) => {
  try {
    const s = await dbGet('/settings');
    return res.json(s || (useFirebase ? {} : memory.settings));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});
app.post('/api/settings', async (req, res) => {
  try {
    const payload = req.body || {};
    await dbSet('/settings', payload);
    // update in-memory also
    if (!useFirebase) memory.settings = payload;
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/* Fallback route */
app.get('/', (req, res) => res.send('Crypto Management API: OK'));

/* ---------- Start server ---------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT} (Firebase=${useFirebase})`);
});
