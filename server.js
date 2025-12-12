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

/* --------------------- Safety: global error handlers --------------------- */
process.on('unhandledRejection', (reason, p) => {
  console.error('UNHANDLED REJECTION at: Promise', p, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION', err);
});

/* ---------------------------------------------------------
   CORS
--------------------------------------------------------- */
app.use(cors({
  origin: '*',
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','x-user-id','x-userid','Authorization','X-User-Id']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname,'public')));


/* ---------------------------------------------------------
   Firebase RTDB init
--------------------------------------------------------- */
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
    console.warn('⚠️ Firebase ENV missing');
  }
} catch (e) {
  console.warn('❌ Firebase init failed:', e.message);
}


/* ---------------------------------------------------------
   Helpers
--------------------------------------------------------- */
function now(){ return Date.now(); }
function usTime(ts){ return new Date(ts).toLocaleString('en-US',{ timeZone:'America/New_York' }); }
function genOrderId(prefix){ return `${prefix || 'ORD'}-${now()}-${Math.floor(1000+Math.random()*9000)}`; }
function safeNumber(v, fallback=0){
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// isSafeUid: prevent firebase-invalid paths and template strings
function isSafeUid(uid){
  if(!uid || typeof uid !== 'string') return false;
  // forbid firebase invalid chars and template markers
  if(/[.#$\[\]]/.test(uid)) return false;
  if(uid.indexOf('{{') !== -1 || uid.indexOf('}}') !== -1) return false;
  if(uid.length < 2 || uid.length > 512) return false;
  return true;
}

// SSE
global.__sseClients = global.__sseClients || [];

/**
 * sendSSE(res, payloadStr, eventName)
 * If eventName provided, sends "event: <eventName>" before data,
 * so frontends using addEventListener("<eventName>", ...) will receive it.
 */
function sendSSE(res, payloadStr, eventName){
  try {
    if (res.finished || (res.connection && res.connection.destroyed)) return false;
    if (eventName) {
      res.write(`event: ${eventName}\n`);
    }
    res.write(`data: ${payloadStr}\n\n`);
    return true;
  } catch(e){
    return false;
  }
}

/**
 * broadcastSSE(payloadObj)
 * - If payloadObj.order && payloadObj.order.userId exists, send only to matching uid connections and general connections (uid === null)
 * - If payloadObj.userId exists (e.g., balance event), send to matching uid connections and general connections
 * - Else broadcast global to all connections
 *
 * This function attempts to send `event: <type>` if payloadObj.type is set.
 */
function broadcastSSE(payloadObj){
  const payload = JSON.stringify(payloadObj);
  const toKeep = [];
  global.__sseClients.forEach(client => {
    try {
      const { res, uid } = client;
      if (!res || (res.finished || (res.connection && res.connection.destroyed))) {
        return;
      }
      const eventName = payloadObj && payloadObj.type ? String(payloadObj.type) : null;

      if (payloadObj && payloadObj.order && payloadObj.order.userId) {
        // send to matching uid or general connections
        if (uid === null || uid === undefined || String(uid) === String(payloadObj.order.userId)) {
          const ok = sendSSE(res, payload, eventName);
          if (ok) toKeep.push(client);
        } else {
          // keep client but do not send
          toKeep.push(client);
        }
      } else if (payloadObj && payloadObj.userId) {
        // direct balance event: payloadObj.userId present
        if (uid === null || uid === undefined || String(uid) === String(payloadObj.userId)) {
          const ok = sendSSE(res, payload, eventName);
          if (ok) toKeep.push(client);
        } else {
          toKeep.push(client);
        }
      } else {
        // global event
        const ok = sendSSE(res, payload, eventName);
        if (ok) toKeep.push(client);
      }
    } catch(e){
      // ignore broken client
    }
  });
  global.__sseClients = toKeep;
}

function objToSortedArray(objOrNull){
  if(!objOrNull) return [];
  try {
    const arr = Object.values(objOrNull);
    return arr.sort((a,b)=> (b.timestamp||b.time||0) - (a.timestamp||a.time||0));
  } catch(e){
    return [];
  }
}


/* ---------------------------------------------------------
   Root
--------------------------------------------------------- */
app.get('/', (_,res)=> res.send('✅ NEXBIT Backend (RTDB) Running'));


/* ---------------------------------------------------------
   Users sync
--------------------------------------------------------- */
app.post('/api/users/sync', async (req, res) => {
  try {
    const { userid, userId } = req.body;
    const uid = userid || userId;
    if(!uid) return res.json({ ok:false, message:'no uid' });
    if(!db) return res.json({ ok:true, message:'no-db' });

    const userRef = db.ref('users/' + uid);
    const createdSnap = await userRef.child('created').once('value');
    const createdVal = createdSnap.exists() ? createdSnap.val() : null;
    const created = (createdVal !== null && createdVal !== undefined) ? createdVal : now();
    const balanceSnap = await userRef.child('balance').once('value');

    const balance = safeNumber(balanceSnap.exists() ? balanceSnap.val() : 0, 0);

    await userRef.update({
      userid: uid,
      created,
      updated: now(),
      balance
    });

    return res.json({ ok:true });
  } catch(e){
    console.error('users sync error', e);
    return res.json({ ok:false });
  }
});


/* ---------------------------------------------------------
   GET balance (robust: validate uid before using as Firebase path)
   NOTE: this is the /api/balance/:uid route you already had,
   and we also add /wallet/:uid/balance below for frontend compatibility.
--------------------------------------------------------- */
app.get('/api/balance/:uid', async (req, res) => {
  try {
    const uid = String(req.params.uid || '').trim();
    if(!isSafeUid(uid)) {
      // invalid -> don't attempt Firebase read
      console.warn('balance api: invalid uid request', uid);
      return res.status(400).json({ ok:false, error:'invalid uid' });
    }

    if (!db) return res.json({ ok:true, balance: 0 });

    const snap = await db.ref(`users/${uid}/balance`).once('value');
    return res.json({ ok:true, balance: Number(snap.val() || 0) });
  } catch (e){
    console.error('balance api error', e);
    return res.json({ ok:false, balance: 0 });
  }
});

/* ---------------------------------------------------------
   NEW: /wallet/:uid/balance
   This endpoint existed on the frontend in your logs (/wallet/.../balance).
   Add this to avoid 404s and to let the page pull the current balance directly.
--------------------------------------------------------- */
app.get('/wallet/:uid/balance', async (req, res) => {
  try {
    const uid = String(req.params.uid || '').trim();
    if(!isSafeUid(uid)) {
      return res.status(400).json({ ok:false, error:'invalid uid' });
    }
    if (!db) return res.json({ ok:true, uid, balance: 0 });

    const snap = await db.ref(`users/${uid}/balance`).once('value');
    const balance = safeNumber(snap.exists() ? snap.val() : 0, 0);
    return res.json({ ok:true, uid, balance });
  } catch (e) {
    console.error('/wallet/:uid/balance error', e);
    return res.status(500).json({ ok:false, error: e.message });
  }
});

/* ---------------------------------------------------------
   Admin set balance
--------------------------------------------------------- */
app.post('/api/admin/balance', async (req, res) => {
  try {
    const { user, amount } = req.body;
    if (!user || amount === undefined || amount === null)
      return res.status(400).json({ ok:false, error:'missing user/amount' });
    if (!db) return res.json({ ok:false, message:'no-db' });

    if(!isSafeUid(user)) return res.status(400).json({ ok:false, error:'invalid user id' });

    const ref = db.ref(`users/${user}`);
    const snap = await ref.once('value');

    const curBal = snap.exists() ? safeNumber(snap.val().balance, 0) : 0;
    const newBal = Number(amount);

    await ref.update({
      balance: newBal,
      lastUpdate: now(),
      boost_last: now()
    });


    // admin action
    const actId = genOrderId('ADMIN_ACT');
    await db.ref(`admin_actions/${actId}`).set({
      id: actId,
      type: 'set_balance',
      user,
      amount: Number(amount),
      by: req.headers['x-user-id'] || 'admin',
      time: now()
    });

    // also write an order record
    const ordId = genOrderId('ORD');
    await db.ref(`orders/recharge/${ordId}`).set({
      orderId: ordId,
      userId: user,
      amount: Number(amount),
      timestamp: now(),
      time_us: usTime(now()),
      type: 'admin_set_balance',
      status: 'completed'
    });

    // Broadcast balance event so clients update
    try {
      broadcastSSE({ type: 'balance', userId: user, balance: newBal });
    } catch(e){}

    return res.json({ ok:true, balance: newBal });
  } catch (e){
    console.error('admin balance set error', e);
    return res.json({ ok:false });
  }
});


/* ---------------------------------------------------------
   Admin recharge
--------------------------------------------------------- */
app.post('/api/admin/recharge', async (req, res) => {
  try {
    const { userId, amount } = req.body;
    if (!userId || amount === undefined || amount === null)
      return res.status(400).json({ ok:false, error:"missing userId/amount" });
    if (!db) return res.status(500).json({ ok:false, error:'no-db' });

    if(!isSafeUid(userId)) return res.status(400).json({ ok:false, error:'invalid userId' });

    const ref = db.ref('users/' + userId);
    const snap = await ref.once('value');

    const balance = snap.exists() ? safeNumber(snap.val().balance, 0) : 0;
    const newBalance = Number(balance) + Number(amount);

    await ref.update({
      balance: newBalance,
      lastUpdate: now(),
      boost_last: now()
    });


    const actId = genOrderId('ADMIN_ACT');
    await db.ref(`admin_actions/${actId}`).set({
      id: actId,
      type:'recharge',
      userId,
      amount: Number(amount),
      by: req.headers['x-user-id'] || 'admin',
      time: now()
    });

    const ordId = genOrderId('RECH');
    await db.ref(`orders/recharge/${ordId}`).set({
      orderId: ordId,
      userId,
      amount: Number(amount),
      timestamp: now(),
      time_us: usTime(now()),
      type:'recharge',
      status:'success'
    });

    // broadcast the recharge order so clients update quickly
    try {
      const snapNew = await db.ref(`orders/recharge/${ordId}`).once('value');
      const latestOrder = { ...snapNew.val(), orderId: ordId };
      broadcastSSE({ type:'update', typeName:'recharge', order: latestOrder, action:{ admin: req.headers['x-user-id'] || 'admin', status:'success' }});
    } catch(e){}

    // broadcast balance event as well
    try { broadcastSSE({ type:'balance', userId: userId, balance: newBalance }); } catch(e){}

    return res.json({ ok: true, balance: newBalance });
  } catch (e){
    console.error('admin recharge error', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});


/* ---------------------------------------------------------
   Admin deduct
--------------------------------------------------------- */
app.post('/api/admin/deduct', async (req, res) => {
  try {
    const { userId, amount } = req.body;
    if (!userId || amount === undefined || amount === null)
      return res.status(400).json({ ok:false, error:"missing userId/amount" });
    if (!db) return res.status(500).json({ ok:false, error:'no-db' });

    if(!isSafeUid(userId)) return res.status(400).json({ ok:false, error:'invalid userId' });

    const ref = db.ref('users/' + userId);
    const snap = await ref.once('value');

    const balance = snap.exists() ? safeNumber(snap.val().balance, 0) : 0;
    if (Number(balance) < Number(amount))
      return res.status(400).json({ ok:false, error:"余额不足" });

    const newBalance = Number(balance) - Number(amount);
    await ref.update({
      balance: newBalance,
      lastUpdate: now(),
      boost_last: now()
    });


    const actId = genOrderId('ADMIN_ACT');
    await db.ref(`admin_actions/${actId}`).set({
      id: actId,
      type:'deduct',
      userId,
      amount: Number(amount),
      by: req.headers['x-user-id'] || 'admin',
      time: now()
    });

    const ordId = genOrderId('WD');
    await db.ref(`orders/withdraw/${ordId}`).set({
      orderId: ordId,
      userId,
      amount: Number(amount),
      timestamp: now(),
      time_us: usTime(now()),
      type:'deduct',
      status:'success'
    });

    // broadcast deduction so client sees update
    try {
      const snapNew = await db.ref(`orders/withdraw/${ordId}`).once('value');
      const latestOrder = { ...snapNew.val(), orderId: ordId };
      broadcastSSE({ type:'update', typeName:'withdraw', order: latestOrder, action:{ admin: req.headers['x-user-id'] || 'admin', status:'success' }});
    } catch(e){}

    // broadcast balance event as well
    try { broadcastSSE({ type:'balance', userId: userId, balance: newBalance }); } catch(e){}

    return res.json({ ok:true, balance:newBalance });
  } catch (e){
    console.error('admin deduct error', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});

/* ---------------------------------------------------------
   Admin 修改用户 Boost 百分比（新增）
--------------------------------------------------------- */
app.post('/api/admin/boost', async (req, res) => {
  try {
    const { userId, pct } = req.body;

    if (!userId || pct === undefined) {
      return res.status(400).json({ ok:false, error:"missing userId/pct" });
    }
    if (!db) return res.status(500).json({ ok:false, error:"no-db" });

    if(!isSafeUid(userId)) return res.status(400).json({ ok:false, error:'invalid userId' });

    const ref = db.ref(`users/${userId}`);

    await ref.update({
      boost_pct: Number(pct),
      boost_last: now()
    });

    // 写入后台操作记录
    const actId = genOrderId('ADMIN_ACT');
    await db.ref(`admin_actions/${actId}`).set({
      id: actId,
      type: 'set_boost',
      userId,
      pct: Number(pct),
      by: req.headers['x-user-id'] || 'admin',
      time: now()
    });

    return res.json({ ok:true, pct:Number(pct) });

  } catch(e){
    console.error("admin boost error:", e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});

/* ---------------------------------------------------------
   Save Order
   - expanded allowed fields
   - broadcast includes userId at top-level so wallet SSE connections get it
--------------------------------------------------------- */
async function saveOrder(type, data){
  if(!db) return null;
  const ts = now();

  const allowed = [
    'userId','user','amount','coin','side','converted',
    'tp','sl','note','meta','orderId','status','type',
    // additional fields that frontends may send
    'tradeType','amountCurrency','converted','estimate','wallet','ip','deducted'
  ];

  const clean = {};
  Object.keys(data||{}).forEach(k=>{
    if(allowed.includes(k)) clean[k] = data[k];
  });

  if(!clean.userId && clean.user) clean.userId = clean.user;

  const id = clean.orderId || genOrderId(type.toUpperCase());

  const payload = {
    ...clean,
    orderId: id,
    timestamp: ts,
    time_us: usTime(ts),
    status: clean.status || 'processing',
    type
  };

  await db.ref(`orders/${type}/${id}`).set(payload);

  try {
    if (payload.userId) {
      await db.ref(`user_orders/${payload.userId}/${id}`).set({
        orderId: id, type, timestamp: ts
      });
    }
  } catch(e){
    console.warn('saveOrder:user_orders failed', e.message);
  }

  // Broadcast with userId at top-level to ensure wallet-specific SSE connections receive it
  try{
    broadcastSSE({
      type: (type === 'buysell' ? 'buysell' : 'new'),
      typeName: type,
      userId: payload.userId,
      order: payload
    });
  }catch(e){}

  return id;
}


/* ---------------------------------------------------------
   Buy/Sell Order
--------------------------------------------------------- */
app.post('/api/order/buysell', async (req, res) => {
  try {
    if(!db) return res.json({ ok:false, error:'no-db' });

    const { userId, user, side, coin, amount, converted, tp, sl, orderId } = req.body;
    const uid = userId || user;
    const amt = Number(amount || 0);

    if(!uid || !side || !coin || amt <= 0)
      return res.status(400).json({ ok:false, error:'missing fields' });

    if(!isSafeUid(uid)) return res.status(400).json({ ok:false, error:'invalid uid' });

    const userRef = db.ref(`users/${uid}`);
    const snap = await userRef.once('value');
    const balance = snap.exists() ? safeNumber(snap.val().balance, 0) : 0;

    const sideLower = String(side).toLowerCase();

    if(sideLower === 'buy') {
      // BUY 必须立即扣钱
      if(balance < amt) return res.status(400).json({ ok:false, error:'余额不足' });
      await userRef.update({
        balance: balance - amt,
        lastUpdate: now()
      });

      // 广播余额
      broadcastSSE({ type:'balance', userId: uid, balance: balance - amt });

    } else if (sideLower === 'sell') {
      // SELL 不加钱、不扣钱，等待后台审核
      // nothing now
    }

    // 保存订单
    const id = await saveOrder('buysell', {
      userId: uid,
      side,
      coin,
      amount: amt,
      converted: converted || null,
      tp: tp || null,
      sl: sl || null,
      orderId,
      deducted: (sideLower === 'buy') ? true : false // 买入已扣款
    });

    return res.json({ ok:true, orderId:id });

  } catch(e){
    console.error('buysell order error', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});
/* ---------------------------------------------------------
   提交充值订单
--------------------------------------------------------- */
app.post('/api/order/recharge', async (req, res) => {
  try {
    if(!db) return res.json({ ok:false, error:'no-db' });

    const payload = req.body || {};
    const userId = payload.userId || payload.user;
    if(!userId) return res.status(400).json({ ok:false, error:'missing userId' });
    if(!isSafeUid(userId)) return res.status(400).json({ ok:false, error:'invalid uid' });

    const id = await saveOrder('recharge', payload);

    return res.json({ ok:true, orderId: id });
  } catch(e){
    console.error('recharge order error', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});


/* ---------------------------------------------------------
   提交提款订单（提交时立即扣除余额，并在订单里标记 deducted: true）
   后台审核只更新状态，不重复扣款
--------------------------------------------------------- */
app.post('/api/order/withdraw', async (req, res) => {
  try {
    if(!db) return res.json({ ok:false, error:'no-db' });

    const payload = req.body || {};
    const userId = payload.userId || payload.user;
    const amount = Number(payload.amount || 0);

    if(!userId || amount === undefined || amount === null)
      return res.status(400).json({ ok:false, error:'missing userId/amount' });

    if(!isSafeUid(userId)) return res.status(400).json({ ok:false, error:'invalid uid' });

    const userRef = db.ref(`users/${userId}`);
    const snap = await userRef.once('value');

    const curBal = snap.exists() ? safeNumber(snap.val().balance, 0) : 0;

    if(curBal < amount)
      return res.status(400).json({ ok:false, error:'余额不足' });

    // 立即扣款（用户提交时就扣）
    const newBal = curBal - amount;
    await userRef.update({
      balance: newBal,
      lastUpdate: now(),
      boost_last: now()
    });

    // 广播余额变更，前端钱包实时看到减少
    try { broadcastSSE({ type:'balance', userId, balance: newBal }); } catch(e){}

    // 创建 withdraw 订单，并标记 deducted: true
    const orderId = await saveOrder('withdraw', {
      ...payload,
      userId,
      amount,
      status: 'pending',
      deducted: true
    });

    return res.json({ ok:true, orderId });

  } catch(e){
    console.error('withdraw order error', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});


/* ---------------------------------------------------------
   获取全部订单 + 用户 + 快速订单查找
--------------------------------------------------------- */
app.get('/api/transactions', async (req, res) => {
  try {
    if(!db) return res.json({
      ok:true,
      recharge:[], withdraw:[], buysell:[],
      users:{}, stats:{}
    });

    const fetchOrderId = req.query.fetchOrder;
    if(fetchOrderId){
      const paths = ['orders/recharge','orders/withdraw','orders/buysell'];
      for(const p of paths){
        const snap = await db.ref(p).once('value');
        const obj = snap.val() || {};
        const found = Object.values(obj).find(o => String(o.orderId) === String(fetchOrderId));
        if(found){
          const actionsSnap = await db.ref('admin_actions')
            .orderByChild('orderId')
            .equalTo(fetchOrderId)
            .once('value');

          const actions = Object.values(actionsSnap.val() || {});
          return res.json({ ok:true, order:found, orderEvents:actions });
        }
      }
      return res.json({ ok:false, error:'order not found' });
    }

    const [rechargeSnap, withdrawSnap, buysellSnap, usersSnap] = await Promise.all([
      db.ref('orders/recharge').once('value'),
      db.ref('orders/withdraw').once('value'),
      db.ref('orders/buysell').once('value'),
      db.ref('users').once('value')
    ]);

    const recharge = objToSortedArray(rechargeSnap.val() || {});
    const withdraw = objToSortedArray(withdrawSnap.val() || {});
    const buysell  = objToSortedArray(buysellSnap.val()  || {});
    const users    = usersSnap.val() || {};

    return res.json({
      ok:true,
      recharge,
      withdraw,
      buysell,
      users,
      stats:{
        todayRecharge: recharge.length,
        todayWithdraw: withdraw.length,
        todayOrders: recharge.length + withdraw.length + buysell.length,
        alerts:0
      }
    });

  } catch(e){
    console.error('transactions error', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});


/* ---------------------------------------------------------
   Admin: token 校验
--------------------------------------------------------- */
async function isValidAdminToken(token){
  if(!db || !token) return false;
  try{
    const snap = await db.ref(`admins_by_token/${token}`).once('value');
    if(!snap.exists()) return false;

    const rec = snap.val();
    const ttlDays = safeNumber(process.env.ADMIN_TOKEN_TTL_DAYS, 30);
    const ageMs = now() - (rec.created || 0);

    if(ageMs > ttlDays * 24*60*60*1000){
      try{ await db.ref(`admins_by_token/${token}`).remove(); }catch(e){}
      return false;
    }
    return true;
  } catch(e){
    return false;
  }
}


/* ---------------------------------------------------------
   Admin: create
--------------------------------------------------------- */
app.post('/api/admin/create', async (req, res) => {
  try {
    const { id, password, createToken } = req.body;

    if(!id || !password) return res.status(400).json({ ok:false, error:'missing id/password' });

    // only allow creation via bootstrap token or existing admin
    if(process.env.ADMIN_BOOTSTRAP_TOKEN && createToken === process.env.ADMIN_BOOTSTRAP_TOKEN){
      // allow
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

  } catch(e){
    console.error('admin.create', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});


/* ---------------------------------------------------------
   Admin: login
--------------------------------------------------------- */
app.post('/api/admin/login', async (req, res) => {
  try {
    const { id, password } = req.body;

    if(!id || !password) return res.status(400).json({ ok:false, error:'missing' });

    const snap = await db.ref(`admins/${id}`).once('value');
    if(!snap.exists()) return res.status(404).json({ ok:false, error:'notfound' });

    const rec = snap.val();
    const hash = rec.hashed || rec.passwordHash || '';

    const ok = await bcrypt.compare(password, hash);
    if(!ok) return res.status(401).json({ ok:false, error:'invalid' });

    const token = rec.token || uuidv4();
    const created = now();

    await db.ref(`admins_by_token/${token}`).set({ id, created });

    return res.json({ ok:true, token, id });

  } catch(e){
    console.error('admin.login', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});
/* ---------------------------------------------------------
   交易更新（后台审批）
   NOTE: 对 withdraw 类型，如果订单在提交时已扣款（order.deducted === true），则后台审批成功**不再重复扣款**。
--------------------------------------------------------- */
app.post('/api/transaction/update', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });

    const auth = req.headers['authorization'] || '';
    if (!auth.startsWith('Bearer '))
      return res.status(403).json({ ok:false, error:'require admin auth' });

    const token = auth.slice(7);
    const valid = await isValidAdminToken(token);
    if (!valid) return res.status(403).json({ ok:false, error:'invalid admin token' });

    const adminRec = await db.ref(`admins_by_token/${token}`).once('value');
    const adminId = adminRec.exists() ? adminRec.val().id : 'admin';

    const { type, orderId, status, note } = req.body;
    if (!type || !orderId) return res.status(400).json({ ok:false, error:'missing type/orderId' });

    const ref = db.ref(`orders/${type}/${orderId}`);
    const snap = await ref.once('value');
    if (!snap.exists()) return res.status(404).json({ ok:false, error:'order not found' });

    // 保存审批状态
    await ref.update({
      status,
      note: note || null,
      updated: now()
    });

    const actId = uuidv4();
    await db.ref(`admin_actions/${actId}`).set({
      id: actId,
      admin: adminId,
      type,
      orderId,
      status,
      note,
      time: now()
    });

    // 如果审批成功：更新余额（谨慎：避免重复扣款）
    try {
      const order = snap.val();
      if (status === 'success' && order && order.userId) {
        const userRef = db.ref(`users/${order.userId}`);
        const uSnap = await userRef.once('value');
        const curBal = uSnap.exists() ? safeNumber(uSnap.val().balance, 0) : 0;
        const amt = Number(order.amount || 0);

        if (type === 'recharge') {
          // 充值审批：把钱加上（通常充值在后台确认时才加）
          await userRef.update({
            balance: curBal + amt,
            lastUpdate: now(),
            boost_last: now()
          });
        } else if (type === 'withdraw') {
          // 提现审批：只有在订单提交时未扣款（deducted !== true）才会在审批时扣款
          if (order.deducted === true) {
            // 已在提交时扣过款，审批不再扣款
          } else {
            if (curBal >= amt) {
              await userRef.update({
                balance: curBal - amt,
                lastUpdate: now(),
                boost_last: now()
              });
            } else {
              await ref.update({ status:'failed', note:'Insufficient balance when approving' });
            }
          }
        }

        // broadcast balance event for this user
        try {
          const newUserSnap = await db.ref(`users/${order.userId}/balance`).once('value');
          const newBal = safeNumber(newUserSnap.exists() ? newUserSnap.val() : 0, 0);
          broadcastSSE({ type:'balance', userId: order.userId, balance: newBal });
        } catch(e){}
      }
    } catch (e) {
      console.warn('post-processing failed', e.message);
    }

    // 推送 SSE（订单更新）
    try {
      // 获取更新后的订单（最新数据）
      const newSnap = await ref.once("value");
      const latestOrder = { ...newSnap.val(), orderId };

      broadcastSSE({
        type: 'update',
        typeName: type,
        userId: latestOrder.userId,
        order: latestOrder,   // 最新订单数据（含 userId）
        action: { admin: adminId, status, note }
      });
    } catch(e){}

    
    if (type === 'buysell' && order.side === 'sell' && status === 'success') {
        await userRef.update({
            balance: curBal + amt,
            lastUpdate: now(),
            boost_last: now()
        });
    }
return res.json({ ok:true });

  } catch(e){
    console.error('transaction.update err', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});


/* ---------------------------------------------------------
   SSE: 支持 /api/orders/stream (通用) 与 /wallet/:uid/sse（钱包专用，按 uid 过滤）
--------------------------------------------------------- */
// 全局 clients 存储对象 { res, uid, ka }
global.__sseClients = global.__sseClients || [];

/**
 * sendSSE(res, payloadStr, eventName)
 * implemented above
 */

/**
 * broadcastSSE(payloadObj)
 * implemented above
 */

/**
 * sendInitialBalanceToRes(res, uid)
 * - Read users/:uid/balance and send a balance event immediately
 */
async function sendInitialBalanceToRes(res, uid){
  try {
    if (!db) {
      sendSSE(res, JSON.stringify({ type: 'balance', userId: uid, balance: 0 }), 'balance');
      return;
    }
    if (!isSafeUid(uid)) {
      sendSSE(res, JSON.stringify({ type:'error', message: 'invalid uid' }), 'error');
      try{ res.end(); }catch(e){}
      return;
    }
    const snap = await db.ref(`users/${uid}/balance`).once('value');
    const bal = safeNumber(snap.exists() ? snap.val() : 0, 0);
    sendSSE(res, JSON.stringify({ type: 'balance', userId: uid, balance: bal }), 'balance');
  } catch (e) {
    sendSSE(res, JSON.stringify({ type:'error', message: 'failed to read balance' }), 'error');
  }
}

/* ---------------------------------------------------------
   通用订单流（兼容旧路由 /api/orders/stream）
--------------------------------------------------------- */
app.get('/api/orders/stream', async (req, res) => {
  res.set({
    'Content-Type':'text/event-stream',
    'Cache-Control':'no-cache',
    'Connection':'keep-alive'
  });
  res.flushHeaders();

  // keepalive ping
  const ka = setInterval(()=>{ try{ res.write(':\n\n'); } catch(e){} }, 15000);

  global.__sseClients.push({ res, uid: null, ka });

  req.on('close', () => {
    clearInterval(ka);
    global.__sseClients = global.__sseClients.filter(c => c.res !== res);
  });
});

/* ---------------------------------------------------------
   钱包专用 SSE：/wallet/:uid/sse
   前端（wallet widget）会连接此路由以接收只属于该 uid 的余额更新
--------------------------------------------------------- */
app.get('/wallet/:uid/sse', async (req, res) => {
  const uid = String(req.params.uid || '').trim();

  res.set({
    'Content-Type':'text/event-stream',
    'Cache-Control':'no-cache',
    'Connection':'keep-alive'
  });
  res.flushHeaders();

  // keepalive ping
  const ka = setInterval(()=>{ try{ res.write(':\n\n'); } catch(e){} }, 15000);

  global.__sseClients.push({ res, uid, ka });

  // send current balance immediately so front-end shows correct amount without waiting
  sendInitialBalanceToRes(res, uid).catch(()=>{});

  req.on('close', () => {
    clearInterval(ka);
    global.__sseClients = global.__sseClients.filter(c => c.res !== res);
  });
});

/* ---------------------------------------------------------
   Firebase watchers: orders 和 users/balance 变化都广播事件
--------------------------------------------------------- */
try {
  if (db) {
    const ordersRef = db.ref('orders');
    ordersRef.on('child_changed', (snap) => {
      const kind = snap.key;
      const val = snap.val() || {};
      Object.values(val).forEach(ord => {
        try { broadcastSSE({ type:'update', kind, order:ord }); } catch(e){}
      });
    });
    ordersRef.on('child_added', (snap) => {
      const kind = snap.key;
      const val = snap.val() || {};
      Object.values(val).forEach(ord => {
        try { broadcastSSE({ type: (type === 'buysell' ? 'buysell' : 'new'), kind, order:ord }); } catch(e){}
      });
    });

    // watch users for balance changes and broadcast balance events
    const usersRef = db.ref('users');
    usersRef.on('child_changed', (snap) => {
      try {
        const uid = snap.key;
        const data = snap.val() || {};
        if (data && Object.prototype.hasOwnProperty.call(data, 'balance')) {
          broadcastSSE({ type:'balance', userId: uid, balance: safeNumber(data.balance,0) });
        }
      } catch (e) {
        // ignore
      }
    });
  }
} catch(e){
  console.warn('SSE firebase watch failed', e.message);
}
/* ---------------------------------------------------------
   强制重置管理员：admin / 970611
   （覆盖 Firebase 中 admins/admin）
--------------------------------------------------------- */
async function ensureDefaultAdmin() {
  try {
    if (!db) {
      console.warn('⚠️ 无法创建管理员：Firebase 未连接');
      return;
    }

    console.log('⚠️ 正在强制重置管理员：admin / 970611');

    const plain = '970611';
    const hashed = await bcrypt.hash(plain, 10);
    const token = uuidv4();
    const created = now();

    // 直接覆盖，无条件重置
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

    console.log('🎉 管理员已强制重置：admin / 970611');

  } catch(e){
    console.error('❌ ensureDefaultAdmin 失败:', e);
  }
}

// 启动时执行一次
ensureDefaultAdmin();


/* ---------------------------------------------------------
   启动服务器
--------------------------------------------------------- */
app.listen(PORT, () => {
  console.log('🚀 Server running on', PORT);
});
