// ===== server.js（在你原文件基础上，仅修 BuySell / SSE，不破坏提款）=====
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

/* --------------------- Global safety handlers --------------------- */
process.on('unhandledRejection', (reason, p) => {
  console.error('UNHANDLED REJECTION at: Promise', p, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION', err);
});

/* ---------------------------------------------------------
   Middleware
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
function isSafeUid(uid){
  if(!uid || typeof uid !== 'string') return false;
  if(/[.#$\[\]]/.test(uid)) return false;
  if(uid.indexOf('{{') !== -1 || uid.indexOf('}}') !== -1) return false;
  if(uid.length < 2 || uid.length > 512) return false;
  return true;
}

/* ---------------------------------------------------------
   SSE utilities (ONLY: balance / new / update)
--------------------------------------------------------- */
global.__sseClients = global.__sseClients || [];

function sendSSE(res, payloadStr, eventName){
  try {
    if (res.finished || (res.connection && res.connection.destroyed)) return false;
    if (eventName) res.write(`event: ${eventName}\n`);
    res.write(`data: ${payloadStr}\n\n`);
    return true;
  } catch(e){ return false; }
}

function broadcastSSE(payloadObj){
  const payload = JSON.stringify(payloadObj);
  const toKeep = [];
  global.__sseClients.forEach(client => {
    try {
      const { res, uid } = client;
      if (!res || (res.finished || (res.connection && res.connection.destroyed))) return;

      const eventName = payloadObj && payloadObj.type ? String(payloadObj.type) : null;

      if (payloadObj && payloadObj.order && payloadObj.order.userId) {
        if (uid == null || String(uid) === String(payloadObj.order.userId)) {
          if (sendSSE(res, payload, eventName)) toKeep.push(client);
        } else toKeep.push(client);
      } else if (payloadObj && payloadObj.userId) {
        if (uid == null || String(uid) === String(payloadObj.userId)) {
          if (sendSSE(res, payload, eventName)) toKeep.push(client);
        } else toKeep.push(client);
      } else {
        if (sendSSE(res, payload, eventName)) toKeep.push(client);
      }
    } catch(e){}
  });
  global.__sseClients = toKeep;
}

function objToSortedArray(objOrNull){
  if(!objOrNull) return [];
  try {
    const arr = Object.values(objOrNull);
    return arr.sort((a,b)=> (b.timestamp||b.time||0) - (a.timestamp||a.time||0));
  } catch(e){ return []; }
}

/* ---------------------------------------------------------
   Root
--------------------------------------------------------- */
app.get('/', (_,res)=> res.send('✅ NEXBIT Backend (RTDB) Running'));

/* ---------------------------------------------------------
   User sync
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
    const created = (createdVal != null) ? createdVal : now();
    const balanceSnap = await userRef.child('balance').once('value');
    const balance = safeNumber(balanceSnap.exists() ? balanceSnap.val() : 0, 0);

    await userRef.update({ userid: uid, created, updated: now(), balance });
    return res.json({ ok:true });
  } catch(e){
    console.error('users sync error', e);
    return res.json({ ok:false });
  }
});

/* ---------------------------------------------------------
   Balance endpoints
--------------------------------------------------------- */
app.get('/api/balance/:uid', async (req, res) => {
  try {
    const uid = String(req.params.uid || '').trim();
    if(!isSafeUid(uid)) return res.status(400).json({ ok:false, error:'invalid uid' });
    if (!db) return res.json({ ok:true, balance: 0 });
    const snap = await db.ref(`users/${uid}/balance`).once('value');
    return res.json({ ok:true, balance: Number(snap.val() || 0) });
  } catch (e){
    console.error('balance api error', e);
    return res.json({ ok:false, balance: 0 });
  }
});

app.get('/wallet/:uid/balance', async (req, res) => {
  try {
    const uid = String(req.params.uid || '').trim();
    if(!isSafeUid(uid)) return res.status(400).json({ ok:false, error:'invalid uid' });
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
   Central saveOrder (coin preserved)
--------------------------------------------------------- */
async function saveOrder(type, data){
  if(!db) return null;
  const ts = now();
  const allowed = ['userId','user','amount','coin','side','converted','tp','sl','note','meta','orderId','status','type','deducted','wallet','ip','currency'];
  const clean = {};
  Object.keys(data||{}).forEach(k=>{ if(allowed.includes(k)) clean[k]=data[k]; });
  if(!clean.userId && clean.user) clean.userId = clean.user;
  const id = clean.orderId || genOrderId(type.toUpperCase());

  const payload = {
    ...clean,
    orderId: id,
    timestamp: ts,
    time_us: usTime(ts),
    status: clean.status || 'processing',
    type,
    processed: false,
    coin: clean.coin || clean.currency || null
  };

  await db.ref(`orders/${type}/${id}`).set(payload);
  if (payload.userId) {
    try { await db.ref(`user_orders/${payload.userId}/${id}`).set({ orderId:id, type, timestamp:ts }); } catch(e){}
  }

  broadcastSSE({ type:'new', typeName:type, userId: payload.userId, order: payload });
  return id;
}

/* ---------------------------------------------------------
   BuySell (提款级模型)
--------------------------------------------------------- */
async function handleBuySellRequest(req, res){
  try {
    if(!db) return res.json({ ok:false, error:'no-db' });

    const { userId, user, side, coin, amount, converted, tp, sl, orderId, wallet, ip } = req.body;
    const uid = userId || user;
    const amt = Number(amount || 0);

    if(!uid || !side || !coin || amt <= 0) return res.status(400).json({ ok:false, error:'missing fields' });
    if(!isSafeUid(uid)) return res.status(400).json({ ok:false, error:'invalid uid' });

    const userRef = db.ref(`users/${uid}`);
    const snap = await userRef.once('value');
    const balance = snap.exists() ? safeNumber(snap.val().balance, 0) : 0;
    const sideLower = String(side).toLowerCase();

    if(sideLower === 'buy'){
      if(balance < amt) return res.status(400).json({ ok:false, error:'余额不足' });
      const newBal = balance - amt;
      await userRef.update({ balance: newBal, lastUpdate: now() });
      broadcastSSE({ type:'balance', userId: uid, balance: newBal });
    }

    const id = await saveOrder('buysell', {
      userId: uid, side, coin, amount: amt, converted: converted||null, tp: tp||null, sl: sl||null,
      orderId, deducted: (sideLower==='buy'), wallet: wallet||null, ip: ip||null
    });

    return res.json({ ok:true, orderId: id });
  } catch(e){
    console.error('handleBuySellRequest error', e);
    return res.status(500).json({ ok:false, error: e.message });
  }
}
app.post('/proxy/buysell', handleBuySellRequest);
app.post('/api/order/buysell', handleBuySellRequest);

/* ---------------------------------------------------------
   Recharge
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
  } catch(e){ return res.status(500).json({ ok:false, error:e.message }); }
});

/* ---------------------------------------------------------
   Withdraw (不动)
--------------------------------------------------------- */
app.post('/api/order/withdraw', async (req, res) => {
  try {
    if(!db) return res.json({ ok:false, error:'no-db' });
    const payload = req.body || {};
    const userId = payload.userId || payload.user;
    const amount = Number(payload.amount || 0);
    if(!userId || amount<=0) return res.status(400).json({ ok:false, error:'missing userId/amount' });
    if(!isSafeUid(userId)) return res.status(400).json({ ok:false, error:'invalid uid' });

    const userRef = db.ref(`users/${userId}`);
    const snap = await userRef.once('value');
    const curBal = snap.exists() ? safeNumber(snap.val().balance, 0) : 0;
    if(curBal < amount) return res.status(400).json({ ok:false, error:'余额不足' });

    const newBal = curBal - amount;
    await userRef.update({ balance: newBal, lastUpdate: now(), boost_last: now() });
    broadcastSSE({ type:'balance', userId, balance: newBal });

    const orderId = await saveOrder('withdraw', { ...payload, userId, amount, status:'pending', deducted:true });
    return res.json({ ok:true, orderId });
  } catch(e){ return res.status(500).json({ ok:false, error:e.message }); }
});

/* ---------------------------------------------------------
   Admin approve/decline (BuySell SELL 才加钱)
--------------------------------------------------------- */
async function isValidAdminToken(token){
  if(!db || !token) return false;
  const snap = await db.ref(`admins_by_token/${token}`).once('value');
  if(!snap.exists()) return false;
  const rec = snap.val();
  const ttlDays = safeNumber(process.env.ADMIN_TOKEN_TTL_DAYS, 30);
  if(now() - (rec.created||0) > ttlDays*24*60*60*1000){
    try{ await db.ref(`admins_by_token/${token}`).remove(); }catch(e){}
    return false;
  }
  return true;
}

app.post('/api/transaction/update', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });
    const auth = req.headers['authorization'] || '';
    if (!auth.startsWith('Bearer ')) return res.status(403).json({ ok:false });
    const token = auth.slice(7);
    if (!await isValidAdminToken(token)) return res.status(403).json({ ok:false });

    const { type, orderId, status, note } = req.body;
    const ref = db.ref(`orders/${type}/${orderId}`);
    const snap = await ref.once('value');
    if (!snap.exists()) return res.status(404).json({ ok:false });

    const order = snap.val();
    if (order.processed === true) return res.json({ ok:true });

    await ref.update({ status, note: note||null, updated: now() });

    const userId = order.userId;
    if (userId) {
      const userRef = db.ref(`users/${userId}`);
      const uSnap = await userRef.once('value');
      let curBal = uSnap.exists() ? safeNumber(uSnap.val().balance,0) : 0;
      const amt = Number(order.amount||0);

      if (status === 'success') {
        if (type === 'recharge') curBal += amt;
        if (type === 'buysell' && String(order.side).toLowerCase()==='sell') curBal += amt;
        await userRef.update({ balance: curBal, lastUpdate: now(), boost_last: now() });
      } else {
        if (type === 'buysell' && String(order.side).toLowerCase()==='buy' && order.deducted===true) {
          curBal += amt;
          await userRef.update({ balance: curBal, lastUpdate: now(), boost_last: now() });
        }
      }
      await ref.update({ processed:true });
      broadcastSSE({ type:'balance', userId, balance: curBal });
    }

    const latest = (await ref.once('value')).val();
    broadcastSSE({ type:'update', typeName:type, userId: latest.userId, order: latest });
    return res.json({ ok:true });
  } catch(e){ return res.status(500).json({ ok:false, error:e.message }); }
});

/* ---------------------------------------------------------
   SSE endpoints
--------------------------------------------------------- */
app.get('/api/orders/stream', (req, res) => {
  res.set({ 'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive' });
  res.flushHeaders();
  const ka = setInterval(()=>{ try{ res.write(':\n\n'); }catch(e){} },15000);
  global.__sseClients.push({ res, uid:null, ka });
  req.on('close', ()=>{ clearInterval(ka); global.__sseClients = global.__sseClients.filter(c=>c.res!==res); });
});

app.get('/wallet/:uid/sse', async (req, res) => {
  const uid = String(req.params.uid||'').trim();
  res.set({ 'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive' });
  res.flushHeaders();
  const ka = setInterval(()=>{ try{ res.write(':\n\n'); }catch(e){} },15000);
  global.__sseClients.push({ res, uid, ka });
  const snap = db ? await db.ref(`users/${uid}/balance`).once('value') : null;
  const bal = snap && snap.exists() ? safeNumber(snap.val(),0) : 0;
  sendSSE(res, JSON.stringify({ type:'balance', userId: uid, balance: bal }), 'balance');
  req.on('close', ()=>{ clearInterval(ka); global.__sseClients = global.__sseClients.filter(c=>c.res!==res); });
});

/* ---------------------------------------------------------
   Firebase watchers (ONLY new / update / balance)
--------------------------------------------------------- */
if (db) {
  db.ref('orders').on('child_added', snap=>{
    const kind = snap.key; const val = snap.val()||{};
    Object.values(val).forEach(ord=> broadcastSSE({ type:'new', typeName:kind, order:ord }));
  });
  db.ref('orders').on('child_changed', snap=>{
    const kind = snap.key; const val = snap.val()||{};
    Object.values(val).forEach(ord=> broadcastSSE({ type:'update', typeName:kind, order:ord }));
  });
  db.ref('users').on('child_changed', snap=>{
    const uid = snap.key; const d = snap.val()||{};
    if ('balance' in d) broadcastSSE({ type:'balance', userId:uid, balance:safeNumber(d.balance,0) });
  });
}

/* ---------------------------------------------------------
   Start
--------------------------------------------------------- */
app.listen(PORT, ()=> console.log('🚀 Server running on', PORT));
