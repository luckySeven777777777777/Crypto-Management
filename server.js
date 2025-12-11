// server.js — 完整修复版（分段发送：第 1 部分）
// 功能：充值/提款/买卖/后台审核/approveRecharge/approveWithdraw/tx update/SSE 广播
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

/* ---------------------------------------------------------
   CORS & body
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

// SSE clients
global.__sseClients = global.__sseClients || [];

function broadcastSSE(payloadObj){
  const payload = JSON.stringify(payloadObj);
  const toRemove = [];
  global.__sseClients.forEach(res=>{
    try {
      if (res.finished || (res.connection && res.connection.destroyed)) {
        toRemove.push(res);
        return;
      }
      res.write(`data: ${payload}\n\n`);
    } catch(e){
      toRemove.push(res);
    }
  });

  if(toRemove.length){
    global.__sseClients = global.__sseClients.filter(r => !toRemove.includes(r));
  }
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
   GET balance
--------------------------------------------------------- */
app.get('/api/balance/:uid', async (req, res) => {
  try {
    const uid = req.params.uid;
    if (!uid) return res.json({ ok:true, balance: 0 });
    if (!db) return res.json({ ok:true, balance: 0 });

    const snap = await db.ref(`users/${uid}/balance`).once('value');
    return res.json({ ok:true, balance: Number(snap.val() || 0) });
  } catch (e){
    console.error('balance api error', e);
    return res.json({ ok:false, balance: 0 });
  }
});
/* ---------------------------------------------------------
   Admin set balance (explicit set)
--------------------------------------------------------- */
app.post('/api/admin/balance', async (req, res) => {
  try {
    const { user, amount } = req.body;
    if (!user || amount === undefined || amount === null)
      return res.status(400).json({ ok:false, error:'missing user/amount' });
    if (!db) return res.json({ ok:false, message:'no-db' });

    const ref = db.ref(`users/${user}`);
    const snap = await ref.once('value');

    const curBal = snap.exists() ? safeNumber(snap.val().balance, 0) : 0;
    const newBal = Number(amount);

    await ref.update({ balance: newBal, lastUpdate: now() });

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

    // broadcast balance update so frontends can sync immediately
    try {
      broadcastSSE({
        type: 'balance',
        userId: user,
        balance: newBal
      });
    } catch(e){ console.warn('broadcastSSE error', e); }

    return res.json({ ok:true, balance: newBal });
  } catch (e){
    console.error('admin balance set error', e);
    return res.json({ ok:false });
  }
});

/* ---------------------------------------------------------
   Admin recharge (adds funds)
--------------------------------------------------------- */
app.post('/api/admin/recharge', async (req, res) => {
  try {
    const { userId, amount } = req.body;
    if (!userId || amount === undefined || amount === null)
      return res.status(400).json({ ok:false, error:"missing userId/amount" });
    if (!db) return res.status(500).json({ ok:false, error:'no-db' });

    const ref = db.ref('users/' + userId);
    const snap = await ref.once('value');

    const balance = snap.exists() ? safeNumber(snap.val().balance, 0) : 0;
    const newBalance = Number(balance) + Number(amount);

    await ref.update({ balance: newBalance, lastUpdate: now() });

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

    // broadcast balance update so frontends can sync immediately
    try {
      broadcastSSE({
        type: 'balance',
        userId,
        balance: newBalance
      });
    } catch(e){ console.warn('broadcastSSE error', e); }

    return res.json({ ok: true, balance: newBalance });
  } catch (e){
    console.error('admin recharge error', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});
// server.js — 完整修复版（分段发送：第 2 部分）
//（续接第 1 部分，直接往下拼即可）

/* ---------------------------------------------------------
   Admin deduct (subtract funds)
--------------------------------------------------------- */
app.post('/api/admin/deduct', async (req, res) => {
  try {
    const { userId, amount } = req.body;
    if (!userId || amount === undefined || amount === null)
      return res.status(400).json({ ok:false, error:"missing userId/amount" });
    if (!db) return res.status(500).json({ ok:false, error:'no-db' });

    const ref = db.ref('users/' + userId);
    const snap = await ref.once('value');

    const balance = snap.exists() ? safeNumber(snap.val().balance, 0) : 0;
    if (balance < Number(amount))
      return res.json({ ok:false, error:'insufficient balance' });

    const newBalance = balance - Number(amount);

    await ref.update({ balance: newBalance, lastUpdate: now() });

    const actId = genOrderId('ADMIN_ACT');
    await db.ref(`admin_actions/${actId}`).set({
      id: actId,
      type:'deduct',
      userId,
      amount: Number(amount),
      by: req.headers['x-user-id'] || 'admin',
      time: now()
    });

    const ordId = genOrderId('DEDUCT');
    await db.ref(`orders/withdraw/${ordId}`).set({
      orderId: ordId,
      userId,
      amount: Number(amount),
      timestamp: now(),
      time_us: usTime(now()),
      type: 'withdraw',
      status:'success'
    });

    try {
      broadcastSSE({
        type: 'balance',
        userId,
        balance: newBalance
      });
    } catch(e){ console.warn('broadcastSSE error', e); }

    return res.json({ ok: true, balance: newBalance });
  } catch (e){
    console.error('admin deduct error', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});

/* ---------------------------------------------------------
   Add an order record (general)
--------------------------------------------------------- */
async function saveOrder(type, userId, amount, ext={}){
  if(!db) return null;
  const ordId = genOrderId('ORD');
  const data = {
    orderId: ordId,
    userId,
    amount: Number(amount),
    type,
    status:'processing',
    timestamp: now(),
    time_us: usTime(now()),
    ...ext
  };
  await db.ref(`orders/${type}/${ordId}`).set(data);
  return data;
}

/* ---------------------------------------------------------
   Submit recharge (user)
--------------------------------------------------------- */
app.post('/api/order/recharge', async (req, res) => {
  try {
    const { userId, amount, currency, wallet, ip } = req.body;
    if (!userId || !amount)
      return res.json({ ok:false, error:'Missing userId/amount' });
    if (!db) return res.json({ ok:false, error:'no-db' });

    const data = {
      currency,
      wallet,
      ip: ip || req.headers['x-real-ip'] || req.ip
    };

    const order = await saveOrder('recharge', userId, amount, data);

    if(order){
      try {
        broadcastSSE({
          type:'order',
          orderType:'recharge',
          userId,
          order
        });
      } catch(e){ console.warn('broadcastSSE recharge error', e); }

      return res.json({ ok:true, order });
    }
    return res.json({ ok:false, message:'Save failed' });
  } catch(e){
    console.error('user recharge error', e);
    return res.json({ ok:false });
  }
});

/* ---------------------------------------------------------
   Submit withdraw (user) — no auto deduct here
--------------------------------------------------------- */
app.post('/api/order/withdraw', async (req, res) => {
  try {
    const { userId, amount, currency, wallet, ip } = req.body;
    if (!userId || !amount)
      return res.json({ ok:false, error:'Missing userId/amount' });
    if (!db) return res.json({ ok:false, error:'no-db' });

    const data = {
      currency,
      wallet,
      ip: ip || req.headers['x-real-ip'] || req.ip
    };

    const order = await saveOrder('withdraw', userId, amount, data);

    if(order){
      try {
        broadcastSSE({
          type:'order',
          orderType:'withdraw',
          userId,
          order
        });
      } catch(e){ console.warn('broadcastSSE withdraw error', e); }

      return res.json({ ok:true, order });
    }
    return res.json({ ok:false, message:'Save failed' });
  } catch(e){
    console.error('user withdraw error', e);
    return res.json({ ok:false });
  }
});

/* ---------------------------------------------------------
   BuySell
   BUY  = deduct amount
   SELL = add amount
--------------------------------------------------------- */
app.post('/api/order/buysell', async (req, res) => {
  try {
    const { userId, amount, side, coin, wallet, ip } = req.body;
    if (!userId || !amount || !side)
      return res.json({ ok:false, error:'missing data' });
    if(!db) return res.json({ ok:false, error:'no-db' });

    const userRef = db.ref(`users/${userId}`);
    const snap = await userRef.once('value');
    const curBal = snap.exists() ? safeNumber(snap.val().balance, 0) : 0;

    let newBal = curBal;
    if(side === 'buy'){
      if(newBal < Number(amount))
        return res.json({ ok:false, error:'insufficient balance' });
      newBal -= Number(amount);
    } else {
      newBal += Number(amount);
    }

    await userRef.update({ balance:newBal, lastUpdate: now() });

    const ext = {
      side,
      coin,
      wallet,
      estimatedUSDT: Number(amount),
      ip: ip || req.headers['x-real-ip'] || req.ip
    };
    const order = await saveOrder('buysell', userId, amount, ext);

    if(order){
      try {
        broadcastSSE({
          type:'balance',
          userId,
          balance:newBal
        });
        broadcastSSE({
          type:'order',
          orderType:'buysell',
          userId,
          order
        });
      } catch(e){ console.warn('broadcastSSE buysell error', e); }

      return res.json({ ok:true, order, balance:newBal });
    }

    return res.json({ ok:false, message:'Save order failed' });
  } catch(e){
    console.error('buysell error', e);
    return res.json({ ok:false });
  }
});

/* ---------------------------------------------------------
   getTransactions (list)
--------------------------------------------------------- */
app.get('/api/transactions/:user', async (req, res) => {
  try {
    const uid = req.params.user;
    if (!uid) return res.json({ ok:true, recharge:[], withdraw:[], buysell:[] });
    if (!db) return res.json({ ok:true, recharge:[], withdraw:[], buysell:[] });

    const reSnap = await db.ref(`orders/recharge`).once('value');
    const wdSnap = await db.ref(`orders/withdraw`).once('value');
    const bsSnap = await db.ref(`orders/buysell`).once('value');

    const reArr = objToSortedArray(reSnap.exists()? reSnap.val():{});
    const wdArr = objToSortedArray(wdSnap.exists()? wdSnap.val():{});
    const bsArr = objToSortedArray(bsSnap.exists()? bsSnap.val():{});

    // filter by user
    const filterByUser = arr => arr.filter(o => (o.userId===uid));

    return res.json({
      ok:true,
      recharge: filterByUser(reArr),
      withdraw: filterByUser(wdArr),
      buysell: filterByUser(bsArr)
    });
  } catch(e){
    console.error('transactions list error', e);
    return res.json({ ok:false });
  }
});
/* ---------------------------------------------------------
   Admin — Create account
--------------------------------------------------------- */
app.post('/api/admin/create', async (req, res) => {
  try {
    const { id, password } = req.body;
    if (!id || !password)
      return res.json({ ok:false, error:"missing id/password" });
    if (!db) return res.json({ ok:false, error:"no-db" });

    const ref = db.ref('admins/' + id);
    const snap = await ref.once('value');
    if (snap.exists())
      return res.json({ ok:false, error:'admin-exists' });

    await ref.set({
      id,
      password,
      created: now()
    });

    return res.json({ ok:true });
  } catch (e){
    console.error("create admin error", e);
    return res.json({ ok:false });
  }
});

/* ---------------------------------------------------------
   Admin Login
--------------------------------------------------------- */
app.post('/api/admin/login', async (req, res)=>{
  try{
    const { id, password } = req.body;
    if(!id || !password)
      return res.json({ ok:false, error:"missing id/password" });
    if(!db) return res.json({ ok:false, error:"no-db" });

    const snap = await db.ref('admins/' + id).once('value');
    if(!snap.exists() || snap.val().password !== password)
      return res.json({ ok:false, error:"invalid-login" });

    const token = genToken(id);
    adminTokens.set(token, id);

    return res.json({ ok:true, token });
  }catch(e){
    console.error("admin login error", e);
    return res.json({ ok:false });
  }
});

/* ---------------------------------------------------------
   Admin: Approve/Reject/Lock/Unlock Order
   - Approve recharge  → 真正加余额
   - Approve withdraw → 真正扣余额
--------------------------------------------------------- */
app.post('/api/transaction/update', async (req, res) => {
  try {
    const token = (req.headers.authorization || "").replace("Bearer ","").trim();
    if (!adminTokens.has(token))
      return res.status(403).json({ ok:false, error:"not-auth" });

    const adminId = adminTokens.get(token);

    const { orderId, type, status, note } = req.body;
    if (!orderId || !type || !status)
      return res.json({ ok:false, error:"missing fields" });
    if (!db) return res.json({ ok:false, error:"no-db" });

    let root = "";
    if (type === "recharge") root = "orders/recharge";
    else if (type === "withdraw") root = "orders/withdraw";
    else if (type === "buysell") root = "orders/buysell";
    else return res.json({ ok:false, error:"invalid-type" });

    const ref = db.ref(`${root}/${orderId}`);
    const snap = await ref.once("value");
    if (!snap.exists())
      return res.json({ ok:false, error:"order-not-found" });

    const ord = snap.val();

    // -----------------------------------------------------
    // 审核充值成功 = 真正加余额
    // -----------------------------------------------------
    if (type === "recharge" && status === "success") {
      const uref = db.ref("users/" + ord.userId);
      const uSnap = await uref.once("value");
      const bal = uSnap.exists() ? safeNumber(uSnap.val().balance, 0) : 0;
      const newBal = bal + Number(ord.amount);

      await uref.update({
        balance: newBal,
        lastUpdate: now()
      });

      broadcastSSE({
        type:"balance",
        userId: ord.userId,
        balance: newBal
      });
    }

    // -----------------------------------------------------
    // 审核提款成功 = 真正扣余额
    // -----------------------------------------------------
    if (type === "withdraw" && status === "success") {
      const uref = db.ref("users/" + ord.userId);
      const uSnap = await uref.once("value");
      const bal = uSnap.exists() ? safeNumber(uSnap.val().balance, 0) : 0;

      if (bal < Number(ord.amount))
        return res.json({ ok:false, error:"insufficient-balance" });

      const newBal = bal - Number(ord.amount);

      await uref.update({
        balance: newBal,
        lastUpdate: now()
      });

      broadcastSSE({
        type:"balance",
        userId: ord.userId,
        balance: newBal
      });
    }

    // -----------------------------------------------------
    // 更新订单状态 + 写入操作记录
    // -----------------------------------------------------
    await ref.update({
      status,
      adminNote: note || "",
      adminBy: adminId,
      adminTime: now()
    });

    await db.ref(`order_actions/${orderId}/${now()}`).set({
      orderId,
      type,
      status,
      by: adminId,
      note: note || "",
      time: now()
    });

    broadcastSSE({
      type:'order',
      orderType:type,
      orderId,
      status
    });

    return res.json({ ok:true });
  } catch (e){
    console.error("transaction update error", e);
    return res.json({ ok:false, error: e.message });
  }
});

/* ---------------------------------------------------------
   Admin fetch all orders + stats
--------------------------------------------------------- */
app.get('/api/transactions', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:"no-db" });

    const q = req.query.q || "";
    const start = req.query.start ? Date.parse(req.query.start) : 0;
    const end = req.query.end ? Date.parse(req.query.end) + 86400000 : Date.now() + 10000;
    const currency = req.query.currency || "";
    const side = req.query.side || "";
    const status = req.query.status || "";
    const type = req.query.type || "";

    const reSnap = await db.ref('orders/recharge').once('value');
    const wdSnap = await db.ref('orders/withdraw').once('value');
    const bsSnap = await db.ref('orders/buysell').once('value');

    const reArr = objToSortedArray(reSnap.exists()? reSnap.val():{});
    const wdArr = objToSortedArray(wdSnap.exists()? wdSnap.val():{});
    const bsArr = objToSortedArray(bsSnap.exists()? bsSnap.val():{});

    function filterOrder(o) {
      if (o.timestamp < start || o.timestamp > end) return false;
      if (q && !(o.orderId?.includes(q) || o.userId?.includes(q) || o.wallet?.includes(q))) return false;
      if (currency && (o.currency !== currency && o.coin !== currency)) return false;
      if (status && o.status !== status) return false;
      if (side && o.side !== side) return false;
      return true;
    }

    return res.json({
      ok:true,
      recharge: (type && type!=='recharge') ? [] : reArr.filter(filterOrder),
      withdraw: (type && type!=='withdraw') ? [] : wdArr.filter(filterOrder),
      buysell: (type && type!=='trade' && type!=='buysell') ? [] : bsArr.filter(filterOrder),
      users: (await db.ref('users').once('value')).val() || {},
      stats:{
        todayRecharge: reArr.filter(o=>o.timestamp>todayStartTS()).length,
        todayWithdraw: wdArr.filter(o=>o.timestamp>todayStartTS()).length,
        todayOrders: (reArr.length + wdArr.length + bsArr.length),
        alerts: wdArr.filter(o=>['failed','locked'].includes(o.status)).length
      }
    });
  } catch(e){
    console.error("admin fetch error", e);
    return res.json({ ok:false });
  }
});
/* ---------------------------------------------------------
   SSE — 前端实时同步余额 & 订单状态
--------------------------------------------------------- */
let sseClients = new Set();

app.get('/api/sse', (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });
  res.flushHeaders();

  const client = { id: Date.now(), res };
  sseClients.add(client);

  req.on('close', () => {
    sseClients.delete(client);
  });
});

/* 广播到所有 SSE 客户端 */
function broadcastSSE(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) {
    try { c.res.write(payload); }
    catch { }
  }
}

/* ---------------------------------------------------------
   Balance API (Strikingly 每 2 秒拉取)
--------------------------------------------------------- */
app.get('/api/balance/:uid', async (req, res) => {
  try {
    const uid = req.params.uid;
    const snap = await db.ref('users/' + uid).once('value');
    if (!snap.exists()) {
      return res.json({ balance: 0 });
    }
    return res.json({ balance: safeNumber(snap.val().balance, 0) });
  } catch (e) {
    return res.json({ balance: 0 });
  }
});

/* ---------------------------------------------------------
   Tools
--------------------------------------------------------- */
function todayStartTS() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function safeNumber(v, def = 0) {
  const n = Number(v);
  return isNaN(n) ? def : n;
}

function now() {
  return Date.now();
}

function objToSortedArray(obj) {
  const arr = Object.values(obj || {});
  arr.sort((a, b) => b.timestamp - a.timestamp);
  return arr;
}

/* ---------------------------------------------------------
   Server Start
--------------------------------------------------------- */
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});

/* ---------------------------------------------------------
   Init Admin (默认管理员)
--------------------------------------------------------- */
async function initAdmin() {
  if (!db) return;
  const adminRef = db.ref("admins/admin");
  const snap = await adminRef.once('value');
  if (!snap.exists()) {
    await adminRef.set({
      id: "admin",
      password: "970611",
      created: now()
    });
    console.log("Default admin account created.");
  }
}

setTimeout(initAdmin, 1500);
