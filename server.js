// Unified server.js - Realtime Database focused
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
  allowedHeaders: ['Content-Type','x-user-id','x-userid','Authorization']
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

// Users sync - Strikingly should call this on page load
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

// GET balance by uid (used by widget)
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

// Admin endpoint: set balance (call from dashboard)
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

// Orders saving helper
async function saveOrder(type, data){
  if(!db) return null;
  const ts = now();
  const id = data.orderId || genOrderId(type.toUpperCase());
  const payload = { ...data, orderId: id, timestamp: ts, time_us: usTime(ts), status: 'pending' };
  await db.ref(`orders/${type}/${id}`).set(payload);
  return id;
}

// Example order endpoints (recharge/withdraw)
app.post('/api/order/recharge', async (req, res) => {
  const { userId, amount } = req.body;
  const id = await saveOrder('recharge', { userId, amount });
  if(!id) return res.json({ ok:true, orderId: 'local-' + now() });
  return res.json({ ok:true, orderId: id });
});

app.post('/api/order/withdraw', async (req, res) => {
  const { userId, amount } = req.body;
  const id = await saveOrder('withdraw', { userId, amount });
  if(!id) return res.json({ ok:true, orderId: 'local-' + now() });
  return res.json({ ok:true, orderId: id });
});

// Dashboard transactions (for admin UI)
app.get('/api/transactions', async (req, res) => {
  try {
    if(!db) return res.json({ ok:true, recharge:{}, withdraw:{}, buysell:{}, users:{}, stats:{} });
    const recharge = (await db.ref('orders/recharge').once('value')).val() || {};
    const withdraw = (await db.ref('orders/withdraw').once('value')).val() || {};
    const buysell = (await db.ref('orders/buysell').once('value')).val() || {};
    const users = (await db.ref('users').once('value')).val() || {};
    res.json({ ok:true, recharge, withdraw, buysell, users, stats:{
        todayRecharge: Object.keys(recharge).length,
        todayWithdraw: Object.keys(withdraw).length,
        todayOrders: Object.keys(recharge).length + Object.keys(withdraw).length + Object.keys(buysell).length,
        alerts:0
    }});
  } catch (e) {
    console.error('transactions error', e);
    res.json({ ok:false });
  }
});

app.listen(PORT, ()=> console.log('🚀 Server running on', PORT));
