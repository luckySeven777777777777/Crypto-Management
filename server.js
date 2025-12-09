require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({
  origin: '*',
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','x-user-id','x-userid','Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/* ===============================
   FIREBASE REALTIME DATABASE INIT
================================= */
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
    console.log("✅ Firebase RTDB Connected");
  }
} catch (e) {
  console.log("❌ Firebase error:", e.message);
}

/* ===============================
   Helpers
================================= */
function now() { return Date.now(); }
function usTime(ts) {
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour12: true,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).replace(",", "");
}

function genOrderId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(100000 + Math.random() * 900000)}`;
}

/* ===============================
   User Sync
================================= */
app.post('/api/users/sync', async (req, res) => {
  try {
    const uid = req.body.userid || req.body.userId;
    if (!uid || !db) return res.json({ ok: true });

    const ref = db.ref('users/' + uid);
    await ref.update({
      userid: uid,
      updated: now()
    });

    res.json({ ok: true });
  } catch {
    res.json({ ok: false });
  }
});

/* ===============================
   Admin: get transactions
================================= */
app.get('/api/transactions', async (_, res) => {
  if (!db) return res.json({ ok: true });

  const recharge = (await db.ref('orders/recharge').once('value')).val() || {};
  const withdraw = (await db.ref('orders/withdraw').once('value')).val() || {};
  const buysell = (await db.ref('orders/buysell').once('value')).val() || {};
  const users = (await db.ref('users').once('value')).val() || {};

  res.json({
    ok: true,
    recharge,
    withdraw,
    buysell,
    users
  });
});

/* ===============================
   Unified order saving
================================= */
async function saveOrder(type, data) {
  if (!db) return null;

  const ts = now();
  const orderId = genOrderId(type.toUpperCase());

  const payload = {
    ...data,
    orderId,
    type,
    timestamp: ts,
    time_us: usTime(ts),
    status: "pending"
  };

  await db.ref(`orders/${type}/${orderId}`).set(payload);

  return orderId;
}

/* ===============================
   RECHARGE
================================= */
app.post('/api/order/recharge', async (req, res) => {
  const { userId, coin, amount, wallet, imageUrl, txid, orderId, timestamp, time_us } = req.body;

  const id = await saveOrder("recharge", {
    userId,
    coin,
    amount,
    wallet,
    imageUrl,
    txid,
    orderId: orderId || undefined,
    timestamp: timestamp || now(),
    time_us: time_us || usTime(now())
  });

  res.json({ ok: true, orderId: id });
});

/* ===============================
   WITHDRAW
================================= */
app.post('/api/order/withdraw', async (req, res) => {
  const { userId, amount, coin, wallet, usdt, hash, orderId, time_us } = req.body;

  const id = await saveOrder("withdraw", {
    userId,
    amount,
    coin,
    wallet,
    usdt,
    hash,
    orderId: orderId || undefined,
    time_us: time_us || usTime(now())
  });

  res.json({ ok: true, orderId: id });
});

/* ===============================
   BUYSELL
================================= */
app.post('/api/order/buysell', async (req, res) => {
  const { userid, userId, tradeType, amount, amountCurrency, coin, tp, sl, orderId, timestamp, time_us } = req.body;

  const realUser = userId || userid;

  const id = await saveOrder("buysell", {
    userId: realUser,
    tradeType,
    amount,
    amountCurrency,
    coin,
    tp,
    sl,
    orderId: orderId || undefined,
    timestamp: timestamp || now(),
    time_us: time_us || usTime(now())
  });

  res.json({ ok: true, orderId: id });
});

app.listen(PORT, () => {
  console.log("🚀 Final NEXBIT server running on", PORT);
});
