
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.disable('etag');   
const PORT = process.env.PORT || 8080;

// CORS
app.use(cors({
  origin: '*',
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','x-user-id','x-userid','Authorization','X-User-Id']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname,'public')));

// -----------------------------
// Firebase Realtime Database init
// -----------------------------
let db = null;
try {
  const admin = require('firebase-admin');
  if (process.env.FIREBASE_SERVICE_ACCOUNT && process.env.FIREBASE_DATABASE_URL) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    db = admin.database();
    console.log('✅ Firebase RTDB connected');
  } else {
    console.warn('⚠️ Firebase ENV missing: set FIREBASE_SERVICE_ACCOUNT and FIREBASE_DATABASE_URL');
  }
} catch (e) {
  console.warn('❌ Firebase init failed:', e.message);
}

// -----------------------------
// Helpers
// -----------------------------
function now(){ return Date.now(); }
function usTime(ts){ return new Date(ts).toLocaleString('en-US',{ timeZone:'America/New_York' }); }
function genOrderId(prefix){ return `${prefix || 'ORD'}-${now()}-${Math.floor(1000+Math.random()*9000)}`; }

function safeNumber(v, fallback = 0){ const n = Number(v); return Number.isFinite(n) ? n : fallback; }

// SSE client list and utils
global.__sseClients = global.__sseClients || [];

function broadcastSSE(payloadObj){
  const payload = JSON.stringify(payloadObj);
  const toRemove = [];
  global.__sseClients.forEach((res) => {
    try {
      // if connection closed, mark for removal
      if (res.finished || (res.connection && res.connection.destroyed)) {
        toRemove.push(res);
        return;
      }
      res.write(`data: ${payload}\n\n`);
    } catch (e) {
      // mark client for removal on any error
      toRemove.push(res);
    }
  });
  if (toRemove.length) {
    global.__sseClients = global.__sseClients.filter(r => !toRemove.includes(r));
  }
}

// Utility: convert RTDB object -> sorted array by timestamp desc
function objToSortedArray(objOrNull){
  if(!objOrNull) return [];
  try {
    const arr = Object.values(objOrNull);
    return arr.sort((a,b) => (b.timestamp || b.time || 0) - (a.timestamp || a.time || 0));
  } catch(e) {
    return [];
  }
}

// -----------------------------
// Root
// -----------------------------
app.get('/', (_, res) => res.send('✅ NEXBIT Backend (RTDB) Running'));

/* -------------------------
   Users sync - Strikingly should call this on page load
--------------------------*/
app.post('/api/users/sync', async (req, res) => {
  try {
    const { userid, userId } = req.body;
    const uid = userid || userId;
    if (!uid) return res.json({ ok:false, message: 'no uid' });
    if (!db) return res.json({ ok:true, message:'no-db' });

    const userRef = db.ref('users/' + uid);
    const createdSnap = await userRef.child('created').once('value');
    const createdVal = createdSnap.exists() ? createdSnap.val() : null;
    // 修复 created 被覆盖问题：如果数据库存在 created（即使为 0），保留；否则用 now()
    const created = (createdVal !== null && createdVal !== undefined) ? createdVal : now();
    const balanceSnap = await userRef.child('balance').once('value');
    const balance = safeNumber(balanceSnap.exists() ? balanceSnap.val() : 0, 0);

    await userRef.update({ userid: uid, created, updated: now(), balance });
    return res.json({ ok:true });
  } catch (e) {
    console.error('users sync error', e);
    return res.json({ ok:false });
  }
});

/* -------------------------
   GET balance by uid (used by widget)
--------------------------*/
app.get('/api/balance/:uid', async (req, res) => {
  try {
    const uid = req.params.uid;
    if (!uid) return res.json({ ok:true, balance: 0 });
    if (!db) return res.json({ ok:true, balance: 0 });
    const snap = await db.ref(`users/${uid}/balance`).once('value');
    return res.json({ ok:true, balance: Number(snap.val() || 0) });
  } catch (e) {
    console.error('balance api error', e);
    return res.json({ ok:false, balance: 0 });
  }
});

/* -------------------------
   Admin set balance (compat) - 也会写 admin_actions & orders/recharge/deduct
--------------------------*/
app.post('/api/admin/balance', async (req, res) => {
  try {
    const { user, amount } = req.body;
    if (!user || amount === undefined || amount === null) return res.status(400).json({ ok:false, error:'missing user/amount' });
    if (!db) return res.json({ ok:false, message:'no-db' });

    const ref = db.ref(`users/${user}`);
    const snap = await ref.once('value');
    const curBal = snap.exists() ? safeNumber(snap.val().balance, 0) : 0;
    const newBal = Number(amount);

    await ref.update({ balance: newBal, lastUpdate: now() });

    // write admin action
    const actId = genOrderId('ADMIN_ACT');
    await db.ref(`admin_actions/${actId}`).set({ id:actId, type:'set_balance', user, amount: Number(amount), by: req.headers['x-user-id'] || 'admin', time: now() });

    // also add a record to orders/recharge (type=set_balance) for visibility in admin transactions
    const ordId = genOrderId('ORD');
    const orderPayload = { orderId: ordId, userId: user, amount: Number(amount), timestamp: now(), time_us: usTime(now()), type: 'admin_set_balance', status: 'completed' };
    await db.ref(`orders/recharge/${ordId}`).set(orderPayload);

    return res.json({ ok:true, balance: newBal });
  } catch (e) {
    console.error('admin balance set error', e);
    return res.json({ ok:false });
  }
});

/* ---------------------------------------------------------
   管理后台接口：充值余额（/api/admin/recharge）
   会写 admin_actions 和 orders/recharge
--------------------------------------------------------- */
app.post('/api/admin/recharge', async (req, res) => {
  try {
    const { userId, amount } = req.body;
    if (!userId || (amount === undefined || amount === null)) return res.status(400).json({ ok:false, error: "缺少 userId 或 amount" });
    if (!db) return res.status(500).json({ ok:false, error: 'no-db' });

    const ref = db.ref('users/' + userId);
    const snap = await ref.once('value');
    const balance = snap.exists() ? safeNumber(snap.val().balance, 0) : 0;
    const newBalance = Number(balance) + Number(amount);
    await ref.update({ balance: newBalance, lastUpdate: now() });

    const actId = genOrderId('ADMIN_ACT');
    await db.ref(`admin_actions/${actId}`).set({ id: actId, type:'recharge', userId, amount: Number(amount), by: req.headers['x-user-id'] || 'admin', time: now() });

    // add to orders/recharge for admin UI visibility
    const ordId = genOrderId('RECH');
    const orderPayload = { orderId: ordId, userId, amount: Number(amount), timestamp: now(), time_us: usTime(now()), type:'recharge', status:'success' };
    await db.ref(`orders/recharge/${ordId}`).set(orderPayload);

    return res.json({ ok: true, balance: newBalance });
  } catch (err) {
    console.error('admin recharge error', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ---------------------------------------------------------
   管理后台接口：扣费（/api/admin/deduct）
   会写 admin_actions 和 orders/withdraw (type:deduct)
--------------------------------------------------------- */
app.post('/api/admin/deduct', async (req, res) => {
  try {
    const { userId, amount } = req.body;
    if (!userId || (amount === undefined || amount === null)) return res.status(400).json({ ok:false, error: "缺少 userId 或 amount" });
    if (!db) return res.status(500).json({ ok:false, error: 'no-db' });

    const ref = db.ref('users/' + userId);
    const snapVal = await ref.once('value');
    const balance = snapVal.exists() ? safeNumber(snapVal.val().balance, 0) : 0;
    if (Number(balance) < Number(amount)) return res.status(400).json({ ok:false, error: "余额不足" });

    const newBalance = Number(balance) - Number(amount);
    await ref.update({ balance: newBalance, lastUpdate: now() });

    const actId = genOrderId('ADMIN_ACT');
    await db.ref(`admin_actions/${actId}`).set({ id: actId, type:'deduct', userId, amount: Number(amount), by: req.headers['x-user-id'] || 'admin', time: now() });

    // write to orders/withdraw
    const ordId = genOrderId('WD');
    const orderPayload = { orderId: ordId, userId, amount: Number(amount), timestamp: now(), time_us: usTime(now()), type:'deduct', status:'success' };
    await db.ref(`orders/withdraw/${ordId}`).set(orderPayload);

    return res.json({ ok: true, balance: newBalance });
  } catch (err) {
    console.error('admin deduct error', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ---------------------------------------------------------
   订单保存函数：saveOrder(type, data)
   - 对传入字段做白名单过滤，避免任意字段写入
   - 返回 orderId
--------------------------------------------------------- */
async function saveOrder(type, data){
  if(!db) return null;
  const ts = now();
  // white-list fields we accept in an order
  const allowed = ['userId','user','amount','coin','side','converted','tp','sl','note','meta','orderId','status','type'];
  const clean = {};
  Object.keys(data || {}).forEach(k => {
    if(allowed.includes(k)) clean[k] = data[k];
  });

  // normalize userId
  if(!clean.userId && clean.user) clean.userId = clean.user;

  const id = clean.orderId || genOrderId(type.toUpperCase());
  const payload = { ...clean, orderId: id, timestamp: ts, time_us: usTime(ts), status: clean.status || 'processing', type };
  // write main order
  await db.ref(`orders/${type}/${id}`).set(payload);
  // also add quick index per user for lookup
  try {
    if (payload.userId) await db.ref(`user_orders/${payload.userId}/${id}`).set({ orderId: id, type, timestamp: ts });
  } catch (e) {
    console.warn('saveOrder:user_orders failed', e.message);
  }
  // SSE notify
  try {
    broadcastSSE({ type:'new', kind:type, order: payload });
  } catch(e){ /* ignore */ }
  return id;
}

/* ---------------------------------------------------------
   提交买卖订单 -> /api/order/buysell
   - 增加余额校验（买入时扣除余额）
   - 防止重复提交（由前端 + 后端唯一 orderId 共同负责）
--------------------------------------------------------- */
app.post('/api/order/buysell', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });

    // minimal validation
    const { userId, user, side, coin, amount, converted, tp, sl, orderId } = req.body;
    const uid = userId || user;
    if (!uid || !side || !coin || (amount === undefined || amount === null)) {
      return res.status(400).json({ ok:false, error: '缺少必要字段' });
    }

    // Pull user balance
    const userRef = db.ref(`users/${uid}`);
    const snap = await userRef.once('value');
    const curBal = snap.exists() ? safeNumber(snap.val().balance, 0) : 0;

    // for buys: require enough balance and deduct immediately
    if (String(side).toLowerCase() === 'buy') {
      // here amount denotes cost in balance currency (USDT). If your front uses different semantics, adapt accordingly.
      if (Number(curBal) < Number(amount)) {
        return res.status(400).json({ ok:false, error: '余额不足' });
      }
      // deduct immediately to prevent double spend
      const newBal = Number(curBal) - Number(amount);
      await userRef.update({ balance: newBal, lastUpdate: now() });
    }

    // for sell: we simply increase balance immediately (depends on your business rule)
    if (String(side).toLowerCase() === 'sell') {
      const newBal = Number(curBal) + Number(amount);
      await userRef.update({ balance: newBal, lastUpdate: now() });
    }

    const id = await saveOrder('buysell', { userId: uid, side, coin, amount: Number(amount), converted: converted || null, tp: tp || null, sl: sl || null, orderId });
    return res.json({ ok: true, orderId: id });
  } catch (err) { console.error('buysell order error', err); return res.status(500).json({ ok: false, error: err.message }); }
});

/* ---------------------------------------------------------
   提交充值订单 -> /api/order/recharge
   - 仅保存订单，后台审批通过后才会加余额（或可由 admin 快速通过）
--------------------------------------------------------- */
app.post('/api/order/recharge', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });
    const payload = req.body || {};
    const id = await saveOrder('recharge', payload);
    return res.json({ ok: true, orderId: id });
  } catch (e) { console.error('recharge order error', e); return res.status(500).json({ ok: false, error: e.message }); }
});

/* ---------------------------------------------------------
   提交提款订单 -> /api/order/withdraw
--------------------------------------------------------- */
app.post('/api/order/withdraw', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });
    const payload = req.body || {};
    // Basic check: userId & amount
    const userId = payload.userId || payload.user;
    if (!userId || (payload.amount === undefined || payload.amount === null)) return res.status(400).json({ ok:false, error:'missing userId/amount' });

    // optional: check balance and mark as processing; but we won't deduct until admin approves
    const snap = await db.ref(`users/${userId}/balance`).once('value');
    const curBal = snap.exists() ? safeNumber(snap.val().balance, 0) : 0;
    if (Number(curBal) < Number(payload.amount)) {
      return res.status(400).json({ ok:false, error: '余额不足' });
    }
    const id = await saveOrder('withdraw', payload);
    return res.json({ ok: true, orderId: id });
  } catch (e) { console.error('withdraw order error', e); return res.status(500).json({ ok: false, error: e.message }); }
});

/* ---------------------------------------------------------
   Dashboard transactions (for admin UI) + fetchOrder support
   - 返回的数组都按 timestamp 排序（最近在前）
--------------------------------------------------------- */
app.get('/api/transactions', async (req, res) => {
  try {
    if(!db) return res.json({ ok:true, recharge:[], withdraw:[], buysell:[], users:{}, stats:{} });

    // fetch single order if requested
    const fetchOrderId = req.query.fetchOrder;
    if(fetchOrderId){
      const paths = ['orders/recharge','orders/withdraw','orders/buysell'];
      for(const p of paths){
        const snap = await db.ref(p).once('value');
        const obj = snap.val() || {};
        const found = Object.values(obj).find(o => String(o.orderId) === String(fetchOrderId));
        if(found){
          const actionsSnap = await db.ref('admin_actions').orderByChild('orderId').equalTo(fetchOrderId).once('value');
          const actionsObj = actionsSnap.val() || {};
          return res.json({ ok:true, order: found, orderEvents: Object.values(actionsObj) });
        }
      }
      return res.json({ ok:false, error:'order not found' });
    }

    // otherwise return lists (convert objects to arrays, sorted)
    const [rechargeSnap, withdrawSnap, buysellSnap, usersSnap] = await Promise.all([
      db.ref('orders/recharge').once('value'),
      db.ref('orders/withdraw').once('value'),
      db.ref('orders/buysell').once('value'),
      db.ref('users').once('value')
    ]);

    const rechargeObj = rechargeSnap.val() || {};
    const withdrawObj = withdrawSnap.val() || {};
    const buysellObj  = buysellSnap.val()  || {};
    const usersObj    = usersSnap.val()    || {};

    const recharge = objToSortedArray(rechargeObj);
    const withdraw = objToSortedArray(withdrawObj);
    const buysell  = objToSortedArray(buysellObj);
    const users    = usersObj;

    res.json({
      ok: true,
      recharge,
      withdraw,
      buysell,
      users,
      stats: {
        todayRecharge: recharge.length,
        todayWithdraw: withdraw.length,
        todayOrders: recharge.length + withdraw.length + buysell.length,
        alerts: 0
      }
    });

  } catch (e) {
    console.error('transactions error', e);
    res.status(500).json({ ok:false, error: e.message });
  }
});

/* ---------------------------------------------------------
   Admin: create & login (bcrypt + token)
   - tokens stored with created timestamp; checked for expiry
--------------------------------------------------------- */
async function isValidAdminToken(token){
  if(!db || !token) return false;
  try{
    const snap = await db.ref(`admins_by_token/${token}`).once('value');
    if(!snap.exists()) return false;
    const rec = snap.val();
    // token TTL days from env or default 30
    const ttlDays = safeNumber(process.env.ADMIN_TOKEN_TTL_DAYS, 30);
    const created = rec.created || 0;
    if (!created) return false;
    const ageMs = now() - created;
    if (ageMs > ttlDays * 24 * 60 * 60 * 1000) {
      // expired - remove it
      try { await db.ref(`admins_by_token/${token}`).remove(); } catch(e){}
      return false;
    }
    return true;
  }catch(e){ return false; }
}

app.post('/api/admin/create', async (req, res) => {
  try {
    const { id, password, createToken } = req.body;
    if(!id || !password) return res.status(400).json({ ok:false, error:'missing id/password' });

    // allow bootstrap if env token matches (for first admin)
    if(process.env.ADMIN_BOOTSTRAP_TOKEN && createToken === process.env.ADMIN_BOOTSTRAP_TOKEN){
      // ok
    } else {
      const auth = req.headers['authorization'] || '';
      if(!auth.startsWith('Bearer ')) return res.status(403).json({ ok:false, error:'forbidden' });
      const token = auth.slice(7);
      if(!await isValidAdminToken(token)) return res.status(403).json({ ok:false, error:'forbidden' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const token = uuidv4();
    const created = now();

    await db.ref(`admins/${id}`).set({ id, hashed, created, token });
    await db.ref(`admins_by_token/${token}`).set({ id, created });

    return res.json({ ok:true, id, token });
  } catch (e) {
    console.error('admin.create', e);
    return res.status(500).json({ ok:false, error: e.message });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try{
    const { id, password } = req.body;
    if(!id || !password) return res.status(400).json({ ok:false, error: 'missing' });
    const snap = await db.ref(`admins/${id}`).once('value');
    if(!snap.exists()) return res.status(404).json({ ok:false, error: 'notfound' });
    const rec = snap.val();
    const ok = await bcrypt.compare(password, rec.hashed || '');
    if(!ok) return res.status(401).json({ ok:false, error:'invalid' });
    const token = rec.token || uuidv4();
    const created = now();
    await db.ref(`admins_by_token/${token}`).set({ id, created });
    return res.json({ ok:true, token, id });
  }catch(e){
    console.error('admin.login', e);
    return res.status(500).json({ ok:false, error: e.message });
  }
});

/* ---------------------------------------------------------
   Transaction update (require admin token) + post-processing + SSE notify
   body: { type, orderId, status, note }
--------------------------------------------------------- */
app.post('/api/transaction/update', async (req, res) => {
  try {
    if(!db) return res.json({ ok:false, error:'no-db' });

    // Authorization header
    const auth = req.headers['authorization'] || req.headers['Authorization'] || '';
    if(!auth || !auth.startsWith('Bearer ')) return res.status(403).json({ ok:false, error:'require admin auth' });
    const token = auth.slice(7);
    const valid = await isValidAdminToken(token);
    if(!valid) return res.status(403).json({ ok:false, error:'invalid admin token' });

    const adminRecSnap = await db.ref(`admins_by_token/${token}`).once('value');
    const adminId = adminRecSnap.exists() ? (adminRecSnap.val().id || 'admin') : 'admin';
    const { type, orderId, status, note } = req.body;
    if(!type || !orderId) return res.status(400).json({ ok:false, error:'missing type/orderId' });

    const ref = db.ref(`orders/${type}/${orderId}`);
    const snap = await ref.once('value');
    if(!snap.exists()) return res.status(404).json({ ok:false, error: 'order not found' });

    await ref.update({ status, note: note || null, updated: Date.now() });

    const actId = uuidv4();
    await db.ref(`admin_actions/${actId}`).set({ id: actId, admin: adminId, type, orderId, status, note, time: Date.now() });

    // post-processing: approve -> adjust user balance for recharge/withdraw
    try {
      const order = snap.val();
      if(status === 'success' && order && order.userId){
        const userRef = db.ref(`users/${order.userId}`);
        const uSnap = await userRef.once('value');
        const curBal = uSnap.exists() ? safeNumber(uSnap.val().balance, 0) : 0;
        const amt = Number(order.amount || 0);
        if(type === 'recharge'){
          const nb = Number(curBal) + amt;
          await userRef.update({ balance: nb, lastUpdate: Date.now() });
        } else if(type === 'withdraw'){
          if(Number(curBal) >= amt){
            const nb = Number(curBal) - amt;
            await userRef.update({ balance: nb, lastUpdate: Date.now() });
          } else {
            await ref.update({ status: 'failed', note: 'Insufficient balance when approving' });
          }
        }
      }
    } catch (e) {
      console.warn('transaction.update post-processing failed', e.message);
    }

    // broadcast to SSE clients
    try{
      const payload = { type:'update', orderId, typeName:type, order: { ...snap.val(), orderId }, action: { admin: adminId, status, note }};
      broadcastSSE(payload);
    }catch(e){}

    return res.json({ ok:true });
  } catch (e) {
    console.error('transaction.update err', e);
    return res.status(500).json({ ok:false, error: e.message });
  }
});

/* ---------------------------------------------------------
   SSE for orders - /api/orders/stream
   Also setup firebase watchers to broadcast changes
--------------------------------------------------------- */
app.get('/api/orders/stream', async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.flushHeaders();

  // keepalive ping
  const keepAlive = setInterval(()=> { try{ res.write(':\n\n'); } catch(e){} }, 15000);

  // add client, and clean on close
  global.__sseClients = global.__sseClients || [];
  global.__sseClients.push(res);

  req.on('close', ()=> {
    clearInterval(keepAlive);
    global.__sseClients = (global.__sseClients || []).filter(r=> r !== res);
  });
});

// Firebase watchers (child_changed + child_added push)
try {
  if(db){
    const ordersRef = db.ref('orders');
    // child_changed: for each order type (recharge/withdraw/buysell), send updates
    ordersRef.on('child_changed', async (snap)=>{
      const kind = snap.key;
      const val = snap.val() || {};
      Object.values(val).forEach(ord=>{
        const payload = { type:'update', kind, order: ord };
        broadcastSSE(payload);
      });
    });
    // child_added not necessary (we call broadcast in saveOrder)
  }
} catch(e){
  console.warn('SSE firebase watch failed', e.message);
}
/* ---------------------------------------------------------
   自动确保管理员存在（一次性执行，不覆盖已有 admin）
   登录账号：admin
   登录密码：970611
--------------------------------------------------------- */
async function ensureDefaultAdmin(){
  try {
    if (!db) {
      console.warn('⚠️ 无法创建管理员：Firebase 未连接');
      return;
    }

    const snap = await db.ref('admins/admin').once('value');

    // 如果管理员已存在 -> 不修改
    if (snap.exists()) {
      console.log('✔ 管理员 admin 已存在，跳过创建');
      return;
    }

    const plain = '970611';   // 登录密码
    const hashed = await bcrypt.hash(plain, 10);
    const token = uuidv4();
    const created = now();

    await db.ref('admins/admin').set({
      id: 'admin',
      hashed,
      created,
      token,
      isSuper: true
    });

    await db.ref(`admins_by_token/${token}`).set({
      id: 'admin',
      created
    });

    console.log('🎉 成功自动创建管理员：admin / 970611');

  } catch (err) {
    console.error('❌ ensureDefaultAdmin 失败:', err);
  }
}

/* 调用一次（不会重复覆盖）*/
ensureDefaultAdmin();

// start server
app.listen(PORT, ()=> console.log('🚀 Server running on', PORT));
