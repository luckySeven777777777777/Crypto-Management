// server.js - NEXBIT FINAL (Firebase 支持 全接口版)
// 环境变量（必须）：FIREBASE_SERVICE_ACCOUNT (JSON string), FIREBASE_DATABASE_URL

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 静态托管 public 文件夹（确保 public 存在）
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

// ---------- Firebase 初始化（容错） ----------
let db = null;
try {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT || !process.env.FIREBASE_DATABASE_URL) {
    console.warn('[SERVER] WARNING: Firebase 环境变量未配置，使用内存存储（仅测试）。');
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

// ---------- 简单 DB 抽象（优先 Firebase，回退 memory） ----------
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

async function dbPush(path, value) {
  if (db) {
    const ref = await db.ref(path).push(value);
    return ref.key;
  } else {
    const key = 'k' + Date.now() + Math.floor(Math.random() * 1000);
    const parts = path.split('/').filter(Boolean);
    let cur = memoryStore;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      cur[p] = cur[p] || {};
      if (i === parts.length - 1) {
        cur[p][key] = value;
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

// 1) Strikingly -> 后端 用户同步
// POST /api/user/sync  { userId }
app.post('/api/user/sync', async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.json(fail('missing userId'));
    await dbSave(`/users/${userId}`, { userId, updatedAt: Date.now() });
    // 若暂无余额则初始化
    const b = (await dbRead(`/balances/${userId}`)) || null;
    if (!b) await dbSave(`/balances/${userId}`, { balance: 0 });
    return res.json(ok());
  } catch (e) {
    console.error('/api/user/sync err', e);
    return res.json(fail('sync error'));
  }
});

// 2) 查询余额
// GET /api/balance?userId=Uxxx
app.get('/api/balance', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.json(fail('missing userId'));
    const b = (await dbRead(`/balances/${userId}`)) || { balance: 0 };
    return res.json(ok({ balance: Number(b.balance || 0) }));
  } catch (e) {
    console.error('/api/balance GET err', e);
    return res.json(fail('read balance error'));
  }
});

// 3) 写入余额（充值/扣款）
// POST /api/balance { userId, amount }
app.post('/api/balance', async (req, res) => {
  try {
    const { userId, amount } = req.body || {};
    if (!userId || typeof amount === 'undefined') return res.json(fail('missing params'));
    const cur = (await dbRead(`/balances/${userId}`)) || { balance: 0 };
    const newBalance = Number(cur.balance || 0) + Number(amount);
    await dbSave(`/balances/${userId}`, { balance: newBalance });
    // 写入交易记录
    await dbPush('/transactions', { userId, amount: Number(amount), timestamp: Date.now(), note: 'balance update' });
    return res.json(ok({ balance: newBalance }));
  } catch (e) {
    console.error('/api/balance POST err', e);
    return res.json(fail('balance update error'));
  }
});

// 4) Proxy: 交易记录读取（管理后台）
// GET /proxy/transactions?start=...&end=...&q=...&type=...&status=...&currency=...
app.get('/proxy/transactions', async (req, res) => {
  try {
    const raw = (await dbRead('/transactions')) || {};
    const list = Object.keys(raw).map(k => raw[k]);
    const { start, end, q, type, status, currency } = req.query || {};
    let filtered = list.slice().sort((a,b)=> (b.timestamp||0)-(a.timestamp||0));
    if (start) { const t = Date.parse(start); if(!isNaN(t)) filtered = filtered.filter(x => (x.timestamp || 0) >= t); }
    if (end) { const t = Date.parse(end); if(!isNaN(t)) filtered = filtered.filter(x => (x.timestamp || 0) <= (t + 24*3600*1000)); }
    if (q) { const qq = q.toString().toLowerCase(); filtered = filtered.filter(x => (`${x.orderId||x.id||''} ${x.userId||x.user||''} ${x.wallet||x.address||''}`).toLowerCase().indexOf(qq)!==-1); }
    if (type) filtered = filtered.filter(x => (x.type||x.txType||'').toString().toLowerCase().indexOf(type.toString().toLowerCase()) !== -1);
    if (status) filtered = filtered.filter(x => (x.status||'').toString().toLowerCase() === status.toString().toLowerCase());
    if (currency) filtered = filtered.filter(x => (x.currency||x.coin||'').toString().toLowerCase() === currency.toString().toLowerCase());
    return res.json(filtered);
  } catch (e) {
    console.error('/proxy/transactions err', e);
    return res.json([]);
  }
});

// 5) Proxy: recharge / withdraw 写入
app.post('/proxy/recharge', async (req, res) => {
  try {
    const rec = req.body || {};
    rec.type = rec.type || 'recharge';
    rec.timestamp = Date.now();
    await dbPush('/transactions', rec);
    if (rec.userId && typeof rec.amount !== 'undefined') {
      const cur = (await dbRead(`/balances/${rec.userId}`)) || { balance: 0 };
      await dbSave(`/balances/${rec.userId}`, { balance: Number(cur.balance || 0) + Number(rec.amount) });
    }
    return res.json(ok());
  } catch (e) {
    console.error('/proxy/recharge err', e);
    return res.json(fail('recharge error'));
  }
});

app.post('/proxy/withdraw', async (req, res) => {
  try {
    const rec = req.body || {};
    rec.type = rec.type || 'withdraw';
    rec.timestamp = Date.now();
    await dbPush('/transactions', rec);
    if (rec.userId && typeof rec.amount !== 'undefined') {
      const cur = (await dbRead(`/balances/${rec.userId}`)) || { balance: 0 };
      await dbSave(`/balances/${rec.userId}`, { balance: Number(cur.balance || 0) - Number(rec.amount) });
    }
    return res.json(ok());
  } catch (e) {
    console.error('/proxy/withdraw err', e);
    return res.json(fail('withdraw error'));
  }
});

// 6) Settings endpoints
app.get('/api/settings', async (req, res) => {
  try {
    const s = (await dbRead('/settings')) || {};
    return res.json(ok(s));
  } catch (e) {
    console.error('/api/settings GET err', e);
    return res.json(fail('settings read error'));
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    await dbSave('/settings', req.body || {});
    return res.json(ok());
  } catch (e) {
    console.error('/api/settings POST err', e);
    return res.json(fail('settings save error'));
  }
});

// 7) Admin login (简单示例，实际请安全加固)
// POST /api/admin/login { user, pass }
app.post('/api/admin/login', async (req, res) => {
  try {
    const { user, pass } = req.body || {};
    if (!user || !pass) return res.json({ success: false });
    const settings = (await dbRead('/settings')) || {};
    // 示例：settings.loginPassword 存明文（仅示例），真实系统请用哈希
    if (settings.loginUser === user && settings.loginPassword === pass) {
      return res.json({ success: true });
    }
    // 兼容默认 admin/admin（开发环境）
    if (user === 'admin' && (settings.loginPassword === undefined || settings.loginPassword === '' || settings.loginPassword === pass)) {
      return res.json({ success: true });
    }
    return res.json({ success: false });
  } catch (e) {
    console.error('/api/admin/login err', e);
    return res.json({ success: false });
  }
});

// 8) Change passwords examples
app.post('/api/change-login-password', async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!newPassword) return res.json(fail('missing newPassword'));
    const s = (await dbRead('/settings')) || {};
    if (s.loginPassword && oldPassword && s.loginPassword !== oldPassword) return res.json(fail('old password mismatch'));
    s.loginPassword = newPassword;
    await dbSave('/settings', s);
    return res.json(ok());
  } catch (e) {
    console.error('/api/change-login-password err', e);
    return res.json(fail('change login password error'));
  }
});

app.post('/api/change-withdraw-password', async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!newPassword) return res.json(fail('missing newPassword'));
    const s = (await dbRead('/settings')) || {};
    if (s.withdrawPassword && oldPassword && s.withdrawPassword !== oldPassword) return res.json(fail('old password mismatch'));
    s.withdrawPassword = newPassword;
    await dbSave('/settings', s);
    return res.json(ok());
  } catch (e) {
    console.error('/api/change-withdraw-password err', e);
    return res.json(fail('change withdraw password error'));
  }
});

// Fallback: SPA support - 若找不到路由则返回 index.html，便于前端路由
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// 启动 server 并保证异常不退出
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`[SERVER] NEXBIT server running on port ${PORT}`);
});

process.on('uncaughtException', err => {
  console.error('uncaughtException', err);
});
process.on('unhandledRejection', reason => {
  console.error('unhandledRejection', reason);
});
