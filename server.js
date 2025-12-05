// server.js - NEXBIT FINAL (Firebase 支持 全接口版 + list-users + transaction status update)
// 放置于项目根目录：project-root/server.js
// 必须环境变量：FIREBASE_SERVICE_ACCOUNT (JSON string), FIREBASE_DATABASE_URL

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(bodyParser.json());
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// Firebase init
let db = null;
try {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT || !process.env.FIREBASE_DATABASE_URL) {
    console.warn('[SERVER] WARNING: Firebase env not configured, falling back to memory store.');
  } else {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    db = admin.database();
    console.log('[SERVER] Firebase 初始化成功');
  }
} catch (err) {
  console.error('[SERVER] Firebase 初始化异常：', err);
}

// memory fallback store
const memoryStore = { transactions: {}, balances: {}, users: {}, settings: {} };

async function dbRead(path) {
  if (db) {
    const snap = await db.ref(path).once('value');
    return snap.val();
  } else {
    const parts = path.split('/').filter(Boolean);
    let cur = memoryStore;
    for (const p of parts) {
      if (!cur[p]) return null;
      cur = cur[p];
    }
    return cur;
  }
}

async function dbSave(path, value) {
  if (db) {
    await db.ref(path).set(value);
    return true;
  } else {
    const parts = path.split('/').filter(Boolean);
    let cur = memoryStore;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      cur[p] = cur[p] || {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = value;
    return true;
  }
}

// dbPush: push 并返回 key （同时在 push 后写回 id 字段，保证每条记录包含 id）
async function dbPush(path, value) {
  if (db) {
    const ref = await db.ref(path).push(value);
    const key = ref.key;
    // 写回 id 字段（firebase）
    try {
      await db.ref(`${path}/${key}`).update({ id: key });
    } catch(e){ console.warn('write id back failed', e); }
    return key;
  } else {
    const key = 'k' + Date.now() + Math.floor(Math.random() * 1000);
    const parts = path.split('/').filter(Boolean);
    let cur = memoryStore;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      cur[p] = cur[p] || {};
      if (i === parts.length - 1) {
        // 写入并附带 id 字段
        cur[p][key] = Object.assign({}, value, { id: key });
      } else {
        cur = cur[p];
      }
    }
    return key;
  }
}

function ok(data) { return Object.assign({ ok: true }, data || {}); }
function fail(message) { return { ok: false, message: message || 'error' }; }

// ---------- APIs ----------

// health
app.get('/api/ping', (req, res) => res.json(ok({ time: Date.now() })));

// 原有 user sync（保留） - singular
app.post('/api/user/sync', async (req, res) => {
  try {
    const { userId, userid } = req.body || {};
    const uid = userId || userid || req.headers['x-user-id'] || req.headers['x-user-id'.toLowerCase()];
    if (!uid) return res.json(fail('missing userId'));
    await dbSave(`/users/${uid}`, { userId: uid, updatedAt: Date.now() });
    const b = (await dbRead(`/balances/${uid}`)) || null;
    if (!b) await dbSave(`/balances/${uid}`, { balance: 0 });
    return res.json(ok());
  } catch (e) {
    console.error('/api/user/sync', e);
    return res.json(fail('sync error'));
  }
});

// 新增 alias：/api/users/sync（plural） 兼容前端多处路径
app.post('/api/users/sync', async (req, res) => {
  try {
    const { userId, userid } = req.body || {};
    const uid = userId || userid || req.headers['x-user-id'] || req.headers['x-user-id'.toLowerCase()];
    if (!uid) return res.json(fail('missing userid'));
    await dbSave(`/users/${uid}`, { userId: uid, updatedAt: Date.now() });
    const b = (await dbRead(`/balances/${uid}`)) || null;
    if (!b) await dbSave(`/balances/${uid}`, { balance: 0 });
    return res.json(ok());
  } catch (e) {
    console.error('/api/users/sync', e);
    return res.json(fail('sync error'));
  }
});

// list users
app.get('/api/list-users', async (req, res) => {
  try {
    const users = (await dbRead('/users')) || {};
    const arr = Object.keys(users).map(k => users[k]);
    return res.json(ok({ users: arr }));
  } catch (e) {
    console.error('/api/list-users', e);
    return res.json(ok({ users: [] }));
  }
});

// balance GET (兼容 query.userId 或 header)
app.get('/api/balance', async (req, res) => {
  try {
    const userId = req.query.userId || req.headers['x-user-id'] || req.headers['x-user-id'.toLowerCase()];
    if (!userId) return res.json(fail('missing userId'));
    const b = (await dbRead(`/balances/${userId}`)) || { balance: 0 };
    return res.json(ok({ balance: Number(b.balance || 0) }));
  } catch (e) {
    console.error('/api/balance GET', e);
    return res.json(fail('read balance error'));
  }
});

// balance POST update
app.post('/api/balance', async (req, res) => {
  try {
    const { userId, userid, amount } = req.body || {};
    const uid = userId || userid || req.headers['x-user-id'] || req.headers['x-user-id'.toLowerCase()];
    if (!uid || typeof amount === 'undefined') return res.json(fail('missing params'));
    const cur = (await dbRead(`/balances/${uid}`)) || { balance: 0 };
    const newBalance = Number(cur.balance || 0) + Number(amount);
    await dbSave(`/balances/${uid}`, { balance: newBalance });
    const key = await dbPush('/transactions', { userId: uid, amount: Number(amount), timestamp: Date.now(), status: 'processing', type: 'balance_update' });
    // 确保 transaction 存在 id
    try { await dbSave(`/transactions/${key}`, Object.assign({ id: key }, { userId: uid, amount: Number(amount), timestamp: Date.now(), status: 'processing', type: 'balance_update' })); } catch(e){}
    return res.json(ok({ balance: newBalance }));
  } catch (e) {
    console.error('/api/balance POST', e);
    return res.json(fail('balance update error'));
  }
});

// --------- proxy transactions read（保证每条记录返回包含 id 字段） ----------
app.get('/proxy/transactions', async (req, res) => {
  try {
    const raw = (await dbRead('/transactions')) || {};
    // map 保证将 key 作为 id 且保留对象实际字段
    const list = Object.keys(raw).map(k => {
      const obj = raw[k] || {};
      // 以存储内字段优先，但强制返回 id 字段为 key
      return Object.assign({ id: k }, obj, { id: obj.id || obj._id || k });
    });
    const { start, end, q, type, status, currency } = req.query || {};
    let filtered = list.slice().sort((a,b)=> (b.timestamp||0)-(a.timestamp||0));
    if (start) { const t = Date.parse(start); if(!isNaN(t)) filtered = filtered.filter(x => (x.timestamp || 0) >= t); }
    if (end) { const t = Date.parse(end); if(!isNaN(t)) filtered = filtered.filter(x => (x.timestamp || 0) <= (t + 24*3600*1000)); }
    if (q) { const qq = q.toString().toLowerCase(); filtered = filtered.filter(x => (`${x.orderId||x.id||''} ${x.userId||x.user||''} ${x.wallet||x.address||''}`).toLowerCase().indexOf(qq)!==-1); }
    if (type) filtered = filtered.filter(x => (x.type||'').toString().toLowerCase().indexOf(type.toString().toLowerCase()) !== -1);
    if (status) filtered = filtered.filter(x => (x.status||'').toString().toLowerCase() === status.toString().toLowerCase());
    if (currency) filtered = filtered.filter(x => (x.currency||x.coin||'').toString().toLowerCase() === currency.toString().toLowerCase());
    return res.json(filtered);
  } catch (e) {
    console.error('/proxy/transactions', e);
    return res.json([]);
  }
});

// --------- 兼容前端 /api/order/recharge 与 /proxy/recharge（把写入的记录带 id） ----------
app.post('/api/order/recharge', async (req, res) => {
  try {
    const rec = req.body || {};
    rec.type = rec.type || 'recharge';
    rec.timestamp = Date.now();
    rec.status = rec.status || 'processing';
    const key = await dbPush('/transactions', rec);
    // 写回 id 字段（覆盖或补充）
    try { await dbSave(`/transactions/${key}`, Object.assign({ id: key }, rec)); } catch(e){ console.warn('save id back failed', e); }
    if (rec.userId && typeof rec.amount !== 'undefined') {
      const cur = (await dbRead(`/balances/${rec.userId}`)) || { balance: 0 };
      await dbSave(`/balances/${rec.userId}`, { balance: Number(cur.balance || 0) + Number(rec.amount) });
    }
    return res.json(ok({ orderId: rec.orderId || key }));
  } catch (e) {
    console.error('/api/order/recharge', e);
    return res.json(fail('recharge error'));
  }
});

// 兼容 /api/order/withdraw -> 存 transactions 并返回 orderId
app.post('/api/order/withdraw', async (req, res) => {
  try {
    const rec = req.body || {};
    rec.type = rec.type || 'withdraw';
    rec.timestamp = Date.now();
    rec.status = rec.status || 'processing';
    const key = await dbPush('/transactions', rec);
    try { await dbSave(`/transactions/${key}`, Object.assign({ id: key }, rec)); } catch(e){ console.warn('save id back failed', e); }
    if (rec.userId && typeof rec.amount !== 'undefined') {
      const cur = (await dbRead(`/balances/${rec.userId}`)) || { balance: 0 };
      await dbSave(`/balances/${rec.userId}`, { balance: Number(cur.balance || 0) - Number(rec.amount) });
    }
    return res.json(ok({ orderId: rec.orderId || key }));
  } catch (e) {
    console.error('/api/order/withdraw', e);
    return res.json(fail('withdraw error'));
  }
});

// proxy recharge (保留，为兼容直接使用 proxy 路径的前端)
app.post('/proxy/recharge', async (req, res) => {
  try {
    const rec = req.body || {};
    rec.type = rec.type || 'recharge';
    rec.timestamp = Date.now();
    rec.status = rec.status || 'processing';
    const key = await dbPush('/transactions', rec);
    try { await dbSave(`/transactions/${key}`, Object.assign({ id: key }, rec)); } catch(e){ }
    if (rec.userId && typeof rec.amount !== 'undefined') {
      const cur = (await dbRead(`/balances/${rec.userId}`)) || { balance: 0 };
      await dbSave(`/balances/${rec.userId}`, { balance: Number(cur.balance || 0) + Number(rec.amount) });
    }
    return res.json(ok());
  } catch (e) {
    console.error('/proxy/recharge', e);
    return res.json(fail('recharge error'));
  }
});

// proxy withdraw
app.post('/proxy/withdraw', async (req, res) => {
  try {
    const rec = req.body || {};
    rec.type = rec.type || 'withdraw';
    rec.timestamp = Date.now();
    rec.status = rec.status || 'processing';
    const key = await dbPush('/transactions', rec);
    try { await dbSave(`/transactions/${key}`, Object.assign({ id: key }, rec)); } catch(e){ }
    if (rec.userId && typeof rec.amount !== 'undefined') {
      const cur = (await dbRead(`/balances/${rec.userId}`)) || { balance: 0 };
      await dbSave(`/balances/${rec.userId}`, { balance: Number(cur.balance || 0) - Number(rec.amount) });
    }
    return res.json(ok());
  } catch (e) {
    console.error('/proxy/withdraw', e);
    return res.json(fail('withdraw error'));
  }
});

// update transaction status (lock/confirm/cancel)
// POST /proxy/transaction/update { transactionId, status } 
app.post('/proxy/transaction/update', async (req, res) => {
  try {
    const { transactionId, status } = req.body || {};
    if (!transactionId || !status) return res.json(fail('missing params'));
    const raw = (await dbRead('/transactions')) || {};
    // find key by matching object content (memory mode or firebase)
    let foundKey = null;
    for (const k of Object.keys(raw || {})) {
      const obj = raw[k];
      if (!obj) continue;
      if (obj.id === transactionId || obj.transactionId === transactionId || obj.orderId === transactionId || k === transactionId) {
        foundKey = k;
        break;
      }
    }
    if (!foundKey) {
      // try treat transactionId as key directly
      if ((raw || {})[transactionId]) foundKey = transactionId;
    }
    if (!foundKey) return res.json(fail('transaction not found'));
    const tx = raw[foundKey];
    tx.status = status;
    // write back
    await dbSave(`/transactions/${foundKey}`, tx);
    return res.json(ok());
  } catch (e) {
    console.error('/proxy/transaction/update', e);
    return res.json(fail('update error'));
  }
});

// settings
app.get('/api/settings', async (req, res) => {
  try {
    const s = (await dbRead('/settings')) || {};
    return res.json(ok(s));
  } catch (e) {
    console.error('/api/settings GET', e);
    return res.json(fail('settings read error'));
  }
});
app.post('/api/settings', async (req, res) => {
  try {
    await dbSave('/settings', req.body || {});
    return res.json(ok());
  } catch (e) {
    console.error('/api/settings POST', e);
    return res.json(fail('settings save error'));
  }
});

// admin login example
app.post('/api/admin/login', async (req, res) => {
  try {
    const { user, pass } = req.body || {};
    if (!user || !pass) return res.json({ success: false });
    const s = (await dbRead('/settings')) || {};
    if (s.loginUser === user && s.loginPassword === pass) return res.json({ success: true });
    if (user === 'admin' && (!s.loginPassword || s.loginPassword === pass)) return res.json({ success: true });
    return res.json({ success: false });
  } catch (e) {
    console.error('/api/admin/login', e);
    return res.json({ success: false });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`[SERVER] NEXBIT server running on port ${PORT}`);
});
process.on('uncaughtException', err => console.error('uncaughtException', err));
process.on('unhandledRejection', reason => console.error('unhandledRejection', reason));
