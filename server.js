// server.js - 完整可部署版本 (Realtime Database + Admin + SSE)
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios');

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
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

// Firebase Realtime Database init (use FIREBASE_SERVICE_ACCOUNT and FIREBASE_DATABASE_URL)
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

// Helpers
function now(){ return Date.now(); }
function usTime(ts){ return new Date(ts).toLocaleString('en-US',{ timeZone:'America/New_York' }); }
function genOrderId(prefix){ return `${prefix}-${now()}-${Math.floor(1000+Math.random()*9000)}`; }

// Root
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
    const created = (await userRef.child('created').once('value')).val() || now();
    const balance = (await userRef.child('balance').once('value')).val() || 0;
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
   Admin set balance (compat)
--------------------------*/
app.post('/api/admin/balance', async (req, res) => {
  try {
    const { user, amount } = req.body;
    if (!db) return res.json({ ok:false, message:'no-db' });
    await db.ref(`users/${user}`).update({ balance: Number(amount), lastUpdate: now() });
    return res.json({ ok:true });
  } catch (e) {
    console.error('admin balance set error', e);
    return res.json({ ok:false });
  }
});

/* ---------------------------------------------------------
   管理后台接口：充值余额（/api/admin/recharge）
--------------------------------------------------------- */
app.post('/api/admin/recharge', async (req, res) => {
  try {
    const { userId, amount } = req.body;
    if (!userId || (amount === undefined || amount === null)) return res.status(400).json({ ok:false, error: "缺少 userId 或 amount" });
    if (!db) return res.status(500).json({ ok:false, error: 'no-db' });

    const ref = db.ref('users/' + userId);
    const snap = await ref.once('value');
    const balance = snap.val()?.balance || 0;
    const newBalance = Number(balance) + Number(amount);
    await ref.update({ balance: newBalance, lastUpdate: now() });

    await db.ref(`admin_actions/${now()}`).set({ type:'recharge', userId, amount: Number(amount), by: req.headers['x-user-id'] || 'admin', time: now() });

    return res.json({ ok: true, balance: newBalance });
  } catch (err) {
    console.error('admin recharge error', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ---------------------------------------------------------
   管理后台接口：扣费（/api/admin/deduct）
--------------------------------------------------------- */
app.post('/api/admin/deduct', async (req, res) => {
  try {
    const { userId, amount } = req.body;
    if (!userId || (amount === undefined || amount === null)) return res.status(400).json({ ok:false, error: "缺少 userId 或 amount" });
    if (!db) return res.status(500).json({ ok:false, error: 'no-db' });

    const ref = db.ref('users/' + userId);
    const snapVal = await ref.once('value');
    const balance = snapVal.val()?.balance || 0;
    if (Number(balance) < Number(amount)) return res.status(400).json({ ok:false, error: "余额不足" });

    const newBalance = Number(balance) - Number(amount);
    await ref.update({ balance: newBalance, lastUpdate: now() });

    await db.ref(`admin_actions/${now()}`).set({ type:'deduct', userId, amount: Number(amount), by: req.headers['x-user-id'] || 'admin', time: now() });

    return res.json({ ok: true, balance: newBalance });
  } catch (err) {
    console.error('admin deduct error', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ---------------------------------------------------------
   订单保存函数：saveOrder(type, data)
--------------------------------------------------------- */
async function saveOrder(type, data){
  if(!db) return null;
  const ts = now();
  const id = data.orderId || genOrderId(type.toUpperCase());
  const payload = { ...data, orderId: id, timestamp: ts, time_us: usTime(ts), status: data.status || 'processing' };
  await db.ref(`orders/${type}/${id}`).set(payload);
  try { if (data.userId) await db.ref(`user_orders/${data.userId}/${id}`).set({ orderId: id, type, timestamp: ts }); } catch (e) { console.warn('saveOrder:user_orders failed', e.message); }
  // notify SSE clients about new order
  try {
    if(global && global.__sseClients){
      const payloadMsg = JSON.stringify({ type:'new', kind:type, order: payload });
      global.__sseClients.forEach(r => { try{ r.write(`data: ${payloadMsg}\n\n`); }catch(e){} });
    }
  } catch(e){}
  return id;
}

/* ---------------------------------------------------------
   提交买卖订单 -> /api/order/buysell
--------------------------------------------------------- */
app.post('/api/order/buysell', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });
    const { userId, side, coin, amount, converted, tp, sl } = req.body;
    if (!userId || !side || !coin || !amount) return res.status(400).json({ ok:false, error: '缺少必要字段' });
    const id = await saveOrder('buysell', { userId, side, coin, amount: Number(amount), converted: converted || null, tp: tp || null, sl: sl || null });
    return res.json({ ok: true, orderId: id });
  } catch (err) { console.error('buysell order error', err); return res.json({ ok: false, error: err.message }); }
});

/* ---------------------------------------------------------
   提交充值订单 -> /api/order/recharge
--------------------------------------------------------- */
app.post('/api/order/recharge', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });
    const payload = req.body || {};
    const id = await saveOrder('recharge', payload);
    return res.json({ ok: true, orderId: id });
  } catch (e) { console.error('recharge order error', e); return res.json({ ok: false, error: e.message }); }
});

/* ---------------------------------------------------------
   提交提款订单 -> /api/order/withdraw
--------------------------------------------------------- */
app.post('/api/order/withdraw', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });
    const payload = req.body || {};
    const id = await saveOrder('withdraw', payload);
    return res.json({ ok: true, orderId: id });
  } catch (e) { console.error('withdraw order error', e); return res.json({ ok: false, error: e.message }); }
});

/* ---------------------------------------------------------
   Dashboard transactions (for admin UI) + fetchOrder support
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

    // otherwise return lists (convert objects to arrays)
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

    // convert to arrays
    const recharge = Object.values(rechargeObj);
    const withdraw = Object.values(withdrawObj);
    const buysell  = Object.values(buysellObj);
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
    res.json({ ok:false, error: e.message });
  }
});

/* ---------------------------------------------------------
   Admin: create & login (bcrypt + token)
   - POST /api/admin/create { id, password, createToken? }
   - POST /api/admin/login { id, password }
--------------------------------------------------------- */
async function isValidAdminToken(token){
  if(!db) return false;
  try{
    const snap = await db.ref(`admins_by_token/${token}`).once('value');
    return snap.exists();
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

    await db.ref(`admins/${id}`).set({ id, hashed, created: Date.now(), token });
    await db.ref(`admins_by_token/${token}`).set({ id, created: Date.now() });

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
    await db.ref(`admins_by_token/${token}`).set({ id, created: Date.now() });
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

    const adminId = (await db.ref(`admins_by_token/${token}`).once('value')).val()?.id || 'admin';
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
        const curBal = uSnap.val()?.balance || 0;
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
      const payload = JSON.stringify({ type:'update', orderId, typeName:type, order: { ...snap.val(), orderId }, action: { admin: adminId, status, note }});
      global.__sseClients = global.__sseClients || [];
      global.__sseClients.forEach(sres=>{
        try{ sres.write(`data: ${payload}\n\n`); }catch(e){}
      });
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

  const keepAlive = setInterval(()=> { try{ res.write(':\n\n'); } catch(e){} }, 15000);

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
    ordersRef.on('child_changed', async (snap)=>{
      const kind = snap.key;
      const val = snap.val() || {};
      // send updates for each order under this kind
      Object.values(val).forEach(ord=>{
        const payload = JSON.stringify({ type:'update', kind, order: ord });
        (global.__sseClients || []).forEach(r=>{
          try{ r.write(`data: ${payload}\n\n`); }catch(e){}
        });
      });
    });
    ordersRef.on('child_added', async ()=>{ /* no-op; new orders handled inside saveOrder */ });
  }
} catch(e){
  console.warn('SSE firebase watch failed', e.message);
}

app.listen(PORT, ()=> console.log('🚀 Server running on', PORT));
