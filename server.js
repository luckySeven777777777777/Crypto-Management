// server.js - 完整版本 (Realtime Database)
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8080;

// CORS - allow Strikingly and others
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

// Helper functions
function now(){ return Date.now(); }
function usTime(ts){ return new Date(ts).toLocaleString('en-US',{ timeZone:'America/New_York' }); }
function genOrderId(prefix){ return `${prefix}-${now()}-${Math.floor(1000+Math.random()*9000)}`; }

// Basic root
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
   原始 Admin endpoint: set balance (保留兼容)
   仍可被 dashboard 调用用来直接设定余额
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
   body: { userId, amount }
--------------------------------------------------------- */
app.post('/api/admin/recharge', async (req, res) => {
  try {
    const { userId, amount } = req.body;

    if (!userId || (amount === undefined || amount === null)) {
      return res.status(400).json({ ok:false, error: "缺少 userId 或 amount" });
    }
    if (!db) return res.status(500).json({ ok:false, error: 'no-db' });

    const ref = db.ref('users/' + userId);
    const snap = await ref.once('value');
    const balance = snap.val()?.balance || 0;

    const newBalance = Number(balance) + Number(amount);

    await ref.update({
      balance: newBalance,
      lastUpdate: now()
    });

    // optionally record an admin action in logs
    await db.ref(`admin_actions/${now()}`).set({ type:'recharge', userId, amount: Number(amount), by: req.headers['x-user-id'] || 'admin', time: now() });

    return res.json({ ok: true, balance: newBalance });

  } catch (err) {
    console.error('admin recharge error', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ---------------------------------------------------------
   管理后台接口：扣费（/api/admin/deduct）
   body: { userId, amount }
--------------------------------------------------------- */
app.post('/api/admin/deduct', async (req, res) => {
  try {
    const { userId, amount } = req.body;

    if (!userId || (amount === undefined || amount === null)) {
      return res.status(400).json({ ok:false, error: "缺少 userId 或 amount" });
    }
    if (!db) return res.status(500).json({ ok:false, error: 'no-db' });

    const ref = db.ref('users/' + userId);
    const snap = await ref.once('Value'); // note: .once('value') below
    const snapVal = await ref.once('value');
    const balance = snapVal.val()?.balance || 0;

    if (Number(balance) < Number(amount)) {
      return res.status(400).json({ ok:false, error: "余额不足" });
    }

    const newBalance = Number(balance) - Number(amount);

    await ref.update({
      balance: newBalance,
      lastUpdate: now()
    });

    // log admin action
    await db.ref(`admin_actions/${now()}`).set({ type:'deduct', userId, amount: Number(amount), by: req.headers['x-user-id'] || 'admin', time: now() });

    return res.json({ ok: true, balance: newBalance });

  } catch (err) {
    console.error('admin deduct error', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ---------------------------------------------------------
   订单保存函数：saveOrder(type, data)
   用于 recharge / withdraw / buysell
--------------------------------------------------------- */
async function saveOrder(type, data){
  if(!db) return null;

  const ts = now();
  const id = data.orderId || genOrderId(type.toUpperCase());

  const payload = {
    ...data,
    orderId: id,
    timestamp: ts,
    time_us: usTime(ts),
    status: data.status || 'pending'
  };

  await db.ref(`orders/${type}/${id}`).set(payload);

  // Optionally increment per-user order index or stats
  try {
    if (data.userId) {
      await db.ref(`user_orders/${data.userId}/${id}`).set({ orderId: id, type, timestamp: ts });
    }
  } catch (e) {
    console.warn('saveOrder: user_orders write failed', e.message);
  }

  return id;
}

/* ---------------------------------------------------------
   提交买卖订单 (来自 buysell.html) -> /api/order/buysell
   示例 body: { userId, side, coin, amount, converted, tp, sl }
--------------------------------------------------------- */
app.post('/api/order/buysell', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });

    const { userId, side, coin, amount, converted, tp, sl } = req.body;

    if (!userId || !side || !coin || !amount) {
      // minimal validation
      return res.status(400).json({ ok:false, error: '缺少必要字段' });
    }

    const id = await saveOrder('buysell', {
      userId, side, coin, amount: Number(amount), converted: converted || null, tp: tp || null, sl: sl || null
    });

    return res.json({ ok: true, orderId: id });

  } catch (err) {
    console.error('buysell order error', err);
    return res.json({ ok: false, error: err.message });
  }
});

/* ---------------------------------------------------------
   提交充值订单 (来自 recharge.html) -> /api/order/recharge
   示例 body: any recharge payload (userId, amount, wallet, screenshotUrl, etc.)
--------------------------------------------------------- */
app.post('/api/order/recharge', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });

    const payload = req.body || {};
    if (!payload.userId || !payload.amount) {
      // allow non-strict if you want, but generally require userId+amount
      // still we will save whatever provided
    }

    const id = await saveOrder('recharge', payload);

    return res.json({ ok: true, orderId: id });
  } catch (e) {
    console.error('recharge order error', e);
    return res.json({ ok: false, error: e.message });
  }
});

/* ---------------------------------------------------------
   提交提款订单 (来自 withdraw.html) -> /api/order/withdraw
   示例 body: { userId, amount, wallet, password, ... }
--------------------------------------------------------- */
app.post('/api/order/withdraw', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });

    const payload = req.body || {};

    const id = await saveOrder('withdraw', payload);

    return res.json({ ok: true, orderId: id });
  } catch (e) {
    console.error('withdraw order error', e);
    return res.json({ ok: false, error: e.message });
  }
});

/* ---------------------------------------------------------
   Dashboard transactions (for admin UI)
   返回 recharge / withdraw / buysell / users / stats
--------------------------------------------------------- */
app.get('/api/transactions', async (req, res) => {
  try {
    if(!db) return res.json({ ok:true, recharge:{}, withdraw:{}, buysell:{}, users:{}, stats:{} });

    const [rechargeSnap, withdrawSnap, buysellSnap, usersSnap] = await Promise.all([
      db.ref('orders/recharge').once('value'),
      db.ref('orders/withdraw').once('value'),
      db.ref('orders/buysell').once('value'),
      db.ref('users').once('value')
    ]);

    const recharge = rechargeSnap.val() || {};
    const withdraw = withdrawSnap.val() || {};
    const buysell  = buysellSnap.val()  || {};
    const users    = usersSnap.val()    || {};

    res.json({
      ok: true,
      recharge,
      withdraw,
      buysell,
      users,
      stats: {
        todayRecharge: Object.keys(recharge).length,
        todayWithdraw: Object.keys(withdraw).length,
        todayOrders: Object.keys(recharge).length + Object.keys(withdraw).length + Object.keys(buysell).length,
        alerts: 0
      }
    });

  } catch (e) {
    console.error('transactions error', e);
    res.json({ ok:false, error: e.message });
  }
});

/* ---------------------------------------------------------
   Optional: allow admin to update order status (e.g. approve withdraw)
   这里保留一个简单接口：/api/transaction/update
   body: { type: 'recharge'|'withdraw'|'buysell', orderId, status, note }
--------------------------------------------------------- */
app.post('/api/transaction/update', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });

    const { type, orderId, status, note } = req.body;
    if (!type || !orderId) return res.status(400).json({ ok:false, error:'missing type/orderId' });

    const ref = db.ref(`orders/${type}/${orderId}`);
    const snap = await ref.once('value');
    if (!snap.exists()) return res.status(404).json({ ok:false, error: 'order not found' });

    await ref.update({ status, note: note || null, updated: now() });

    // If admin approves a recharge/withdraw and you want auto balance change, you can do it here.
    // Example: if approved withdraw -> deduct user balance; if approved recharge -> add balance.
    // We'll implement simple handlers based on status === 'approved'
    try {
      const order = snap.val();
      if (status === 'approved' && order && order.userId) {
        const userRef = db.ref(`users/${order.userId}`);
        const uSnap = await userRef.once('value');
        const curBal = uSnap.val()?.balance || 0;
        const amt = Number(order.amount || 0);

        if (type === 'recharge') {
          const nb = Number(curBal) + amt;
          await userRef.update({ balance: nb, lastUpdate: now() });
        } else if (type === 'withdraw') {
          // only deduct if enough balance
          if (Number(curBal) >= amt) {
            const nb = Number(curBal) - amt;
            await userRef.update({ balance: nb, lastUpdate: now() });
          } else {
            // insufficient balance - mark order as failed
            await ref.update({ status: 'failed', note: 'Insufficient balance when approving' });
          }
        }
      }
    } catch (e) {
      console.warn('transaction.update post-processing failed', e.message);
    }

    return res.json({ ok:true });
  } catch (e) {
    console.error('transaction update error', e);
    return res.json({ ok:false, error: e.message });
  }
});

app.listen(PORT, ()=> console.log('🚀 Server running on', PORT));
