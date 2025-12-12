// server.js — Robust SSE + wallet endpoints (replace your current file with this)
require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
app.disable('etag');
const PORT = process.env.PORT || 8080;

process.on('unhandledRejection', (r,p) => console.error('UNHANDLED REJECTION', r,p));
process.on('uncaughtException', e => console.error('UNCAUGHT EXCEPTION', e));

app.use(cors({
  origin: '*',
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','x-user-id','x-userid','authorization','X-User-Id','Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname,'public')));

/* ---------------- FIREBASE RTDB init (same approach) ---------------- */
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
    console.warn('⚠️ FIREBASE vars missing; RTDB disabled');
  }
} catch (e) {
  console.warn('❌ Firebase init failed:', e && e.message);
}

/* ---------------- Helpers ---------------- */
function now(){ return Date.now(); }
function safeNumber(v, fallback=0){ const n=Number(v); return Number.isFinite(n)?n:fallback; }
function isSafeUid(uid){
  if(!uid||typeof uid!=='string') return false;
  if(/[.#$\[\]]/.test(uid)) return false;
  if(uid.includes('{{')||uid.includes('}}')) return false;
  if(uid.length<2||uid.length>512) return false;
  return true;
}

/* ---------------- SSE client stores ---------------- */
/*
  We'll keep clients in global.__sseClientsPerUid = { uid: [res,...] }
  and also a global counter for diagnostics.
*/
global.__sseClientsPerUid = global.__sseClientsPerUid || {};
global.__sseClientCount = global.__sseClientCount || 0;

/* Unified broadcast helper: targetUid optional (if provided, send only to that uid clients) */
function broadcastSSE(payloadObj, targetUid){
  const json = JSON.stringify(payloadObj);
  if(targetUid){
    const arr = global.__sseClientsPerUid[targetUid] || [];
    const toRemove = [];
    arr.forEach((res) => {
      try{
        if(res.finished || (res.connection && res.connection.destroyed)) { toRemove.push(res); return; }
        res.write(`event: balance\n`);
        res.write(`data: ${json}\n\n`);
      }catch(e){ toRemove.push(res); }
    });
    if(toRemove.length){
      global.__sseClientsPerUid[targetUid] = (global.__sseClientsPerUid[targetUid] || []).filter(r=> !toRemove.includes(r));
      global.__sseClientCount = Object.values(global.__sseClientsPerUid).reduce((s,a)=> s + a.length, 0);
    }
    return;
  }
  // broadcast to all uids
  Object.keys(global.__sseClientsPerUid).forEach(uid=>{
    broadcastSSE(payloadObj, uid);
  });
}

/* ---------------- Basic root & health ---------------- */
app.get('/', (_,res)=> res.send('✅ NEXBIT Backend (RTDB) Running'));
app.get('/health', (_,res)=> res.json({ ok:true, time: now(), sseClients: global.__sseClientCount || 0 }));

/* ---------------- wallet balance (compat) ---------------- */
// GET /wallet/:uid/balance
app.get('/wallet/:uid/balance', async (req, res) => {
  try {
    const uid = String(req.params.uid || '').trim();
    if(!isSafeUid(uid)) return res.status(400).json({ ok:false, error:'invalid uid' });
    if(!db) return res.json({ ok:true, balance: 0 });

    const snap = await db.ref(`users/${uid}/balance`).once('value');
    const balance = safeNumber(snap.exists()?snap.val():0,0);
    return res.json({ ok:true, balance });
  } catch(e){
    console.error('/wallet/:uid/balance error', e && e.message);
    return res.status(500).json({ ok:false, error: String(e && e.message) });
  }
});

/* ---------------- wallet SSE: /wallet/:uid/sse ---------------- */
app.get('/wallet/:uid/sse', async (req, res) => {
  try {
    const uid = String(req.params.uid || '').trim();
    if(!isSafeUid(uid)) { res.status(400).end(); return; }

    // set SSE headers
    res.setHeader('Content-Type','text/event-stream');
    res.setHeader('Cache-Control','no-cache');
    res.setHeader('Connection','keep-alive');
    // some hosts require this to flush headers
    try { res.flushHeaders(); } catch(e){ /* ignore */ }

    // send an initial keepalive comment and initial snapshot
    res.write(`: connected\n\n`);

    // initial snapshot from RTDB if available
    try {
      if(db){
        const snap = await db.ref(`users/${uid}/balance`).once('value');
        const balance = safeNumber(snap.exists()?snap.val():0,0);
        res.write(`event: balance\n`);
        res.write(`data: ${JSON.stringify({ balance, time: now() })}\n\n`);
      } else {
        res.write(`event: balance\n`);
        res.write(`data: ${JSON.stringify({ balance: 0, time: now() })}\n\n`);
      }
    } catch(e){
      console.warn('wallet sse initial snapshot failed', e && e.message);
    }

    // register client
    if(!global.__sseClientsPerUid[uid]) global.__sseClientsPerUid[uid] = [];
    global.__sseClientsPerUid[uid].push(res);
    global.__sseClientCount = Object.values(global.__sseClientsPerUid).reduce((s,a)=> s + a.length, 0);
    console.log(`SSE client connected for uid=${uid} totalClients=${global.__sseClientCount}`);

    // heartbeat ping every 15s to keep connection alive
    const ka = setInterval(()=> {
      try { res.write(':ka\n\n'); } catch(e){}
    },15000);

    req.on('close', () => {
      clearInterval(ka);
      // remove client
      global.__sseClientsPerUid[uid] = (global.__sseClientsPerUid[uid] || []).filter(r => r !== res);
      global.__sseClientCount = Object.values(global.__sseClientsPerUid).reduce((s,a)=> s + a.length, 0);
      console.log(`SSE client disconnected for uid=${uid} totalClients=${global.__sseClientCount}`);
      try { res.end(); } catch(e){}
    });

  } catch(e){ console.error('/wallet/:uid/sse error', e && e.message); try{ res.end(); } catch(e){} }
});

/* ---------------- update balance endpoint (used by admin / internal) ---------------- */
// POST /wallet/:uid/update_balance  with header x-user-id
app.post('/wallet/:uid/update_balance', async (req, res) => {
  try {
    const uid = String(req.params.uid || '').trim();
    if(!isSafeUid(uid)) return res.status(400).json({ ok:false, error:'invalid uid' });

    const headerUid = String(req.headers['x-user-id'] || req.headers['X-User-Id'] || '').trim();
    if(!headerUid || headerUid !== uid) return res.status(400).json({ ok:false, error:'missing/invalid x-user-id' });

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount)) return res.status(400).json({ ok:false, error:'invalid amount' });

    if(!db) return res.status(500).json({ ok:false, error:'no-db' });

    // update RTDB
    await db.ref(`users/${uid}`).update({ balance: amount, lastUpdate: now(), boost_last: now() });

    // log an admin action entry
    const actId = `API_SET-${now()}-${Math.floor(Math.random()*9000+1000)}`;
    await db.ref(`admin_actions/${actId}`).set({
      id: actId, type:'api_set_balance', user: uid, amount, by: headerUid, time: now()
    });

    // broadcast to this uid only (so others don't get it)
    try {
      broadcastSSE({ type:'balance_update', uid, balance: amount, time: now() }, uid);
    } catch(e){ console.warn('broadcast failed', e && e.message); }

    return res.json({ ok:true, balance: amount });
  } catch(e){ console.error('/wallet/:uid/update_balance error', e && e.message); return res.status(500).json({ ok:false, error: String(e && e.message) }); }
});

/* ---------------- Keep original order stream route (leave intact) ---------------- */
app.get('/api/orders/stream', async (req, res) => {
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  try{ res.flushHeaders(); } catch(e){}

  const ka = setInterval(()=>{ try{ res.write(':\n\n'); } catch(e){} },15000);
  global.__sseClients = global.__sseClients || [];
  global.__sseClients.push(res);
  req.on('close', ()=> {
    clearInterval(ka);
    global.__sseClients = (global.__sseClients || []).filter(r => r !== res);
  });
});

/* ---------------- Firebase watchers: preserve original behavior but use broadcastSSE to target uid ---------------- */
try {
  if(db){
    const ordersRef = db.ref('orders');
    ordersRef.on('child_changed', (snap) => {
      const kind = snap.key;
      const val = snap.val() || {};
      Object.values(val).forEach(ord => {
        try {
          if (ord && ord.userId) {
            broadcastSSE({ type:'update', kind, order:ord }, ord.userId);
          } else {
            broadcastSSE({ type:'update', kind, order:ord });
          }
        } catch(e){
          try { broadcastSSE({ type:'update', kind, order:ord }); } catch(e2){}
        }
      });
    });
  }
} catch(e){ console.warn('firebase watcher setup failed', e && e.message); }

/* ---------------- Final: start ---------------- */
app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT} (pid ${process.pid})`);
});
