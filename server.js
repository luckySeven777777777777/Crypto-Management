// ====== 你原来的 require / middleware / firebase / helper 全部保持 ======
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
  console.error('UNHANDLED REJECTION at:', p, reason);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION', err);
});

/* --------------------- Middleware --------------------- */
app.use(cors({ origin:'*' }));
app.use(express.json());
app.use(express.urlencoded({ extended:true }));
app.use(express.static(path.join(__dirname,'public')));

/* --------------------- Firebase --------------------- */
let db = null;
try {
  const admin = require('firebase-admin');
  if (process.env.FIREBASE_SERVICE_ACCOUNT && process.env.FIREBASE_DATABASE_URL) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    db = admin.database();
    console.log('✅ Firebase connected');
  }
} catch(e){
  console.warn('Firebase init failed', e.message);
}

/* --------------------- Helpers --------------------- */
const now = ()=>Date.now();
const usTime = ts=>new Date(ts).toLocaleString('en-US',{timeZone:'America/New_York'});
const genOrderId = p=>`${p}-${now()}-${Math.floor(Math.random()*9000+1000)}`;
const safeNumber = (v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
const isSafeUid = uid => typeof uid==='string' && uid.length>1 && !/[.#$\[\]]/.test(uid);

/* --------------------- SSE --------------------- */
global.__sseClients = [];
function broadcastSSE(obj){
  const msg = JSON.stringify(obj);
  global.__sseClients = global.__sseClients.filter(c=>{
    try{
      if(c.res.finished) return false;
      if(obj.userId && c.uid && String(c.uid)!==String(obj.userId)) return true;
      c.res.write(`event:${obj.type}\n`);
      c.res.write(`data:${msg}\n\n`);
      return true;
    }catch(e){ return false; }
  });
}

/* ===================== 核心：统一 saveOrder ===================== */
async function saveOrder(type, data){
  const id = data.orderId || genOrderId(type.toUpperCase());
  const payload = {
    ...data,
    orderId: id,
    type,
    timestamp: now(),
    time_us: usTime(now()),
    status: data.status || 'processing',
    processed: false,
    coin: data.coin || null
  };
  await db.ref(`orders/${type}/${id}`).set(payload);
  await db.ref(`user_orders/${payload.userId}/${id}`).set({ type, timestamp: payload.timestamp });
  broadcastSSE({ type:'new', userId:payload.userId, order:payload });
  return id;
}

/* ===================== BuySell = 提款级模型 ===================== */
async function handleBuySell(req,res){
  try{
    const { userId, side, amount, coin } = req.body;
    const amt = safeNumber(amount);
    if(!db) return res.json({ok:false});
    if(!isSafeUid(userId) || !side || amt<=0) return res.status(400).json({ok:false});

    const ref = db.ref(`users/${userId}`);
    const snap = await ref.once('value');
    let bal = safeNumber(snap.val()?.balance,0);

    // ===== BUY：立即扣 =====
    if(side.toLowerCase()==='buy'){
      if(bal < amt) return res.status(400).json({ok:false,error:'余额不足'});
      bal -= amt;
      await ref.update({ balance: bal, lastUpdate: now() });
      broadcastSSE({ type:'balance', userId, balance: bal });
    }

    // ===== SELL：不动 =====
    const orderId = await saveOrder('buysell',{
      userId, side, amount:amt, coin,
      deducted: side.toLowerCase()==='buy'
    });

    res.json({ ok:true, orderId });
  }catch(e){
    console.error(e);
    res.status(500).json({ok:false});
  }
}

app.post('/api/order/buysell', handleBuySell);
app.post('/proxy/buysell', handleBuySell);

/* ===================== Withdraw（你原来逻辑，保留） ===================== */
app.post('/api/order/withdraw', async (req,res)=>{
  const { userId, amount } = req.body;
  const amt = safeNumber(amount);
  const ref = db.ref(`users/${userId}`);
  const snap = await ref.once('value');
  let bal = safeNumber(snap.val()?.balance,0);
  if(bal < amt) return res.status(400).json({ok:false});
  bal -= amt;
  await ref.update({ balance: bal });
  broadcastSSE({ type:'balance', userId, balance: bal });
  const orderId = await saveOrder('withdraw',{ userId, amount:amt, deducted:true });
  res.json({ ok:true, orderId });
});

/* ===================== Admin 审批（统一处理） ===================== */
app.post('/api/transaction/update', async (req,res)=>{
  const { type, orderId, status } = req.body;
  const ref = db.ref(`orders/${type}/${orderId}`);
  const snap = await ref.once('value');
  if(!snap.exists()) return res.json({ok:false});
  const ord = snap.val();
  if(ord.processed) return res.json({ok:true});

  const uref = db.ref(`users/${ord.userId}`);
  const usnap = await uref.once('value');
  let bal = safeNumber(usnap.val()?.balance,0);
  const amt = safeNumber(ord.amount);

  if(status==='success'){
    if(type==='recharge') bal += amt;
    if(type==='buysell' && ord.side==='sell') bal += amt;
  }else{
    if(type==='withdraw' && ord.deducted) bal += amt;
    if(type==='buysell' && ord.side==='buy' && ord.deducted) bal += amt;
  }

  await uref.update({ balance: bal });
  await ref.update({ status, processed:true });
  broadcastSSE({ type:'balance', userId:ord.userId, balance: bal });
  broadcastSSE({ type:'update', userId:ord.userId, order:{...ord,status} });
  res.json({ ok:true });
});

/* ===================== SSE endpoints ===================== */
app.get('/wallet/:uid/sse',(req,res)=>{
  res.set({ 'Content-Type':'text/event-stream','Cache-Control':'no-cache' });
  res.flushHeaders();
  global.__sseClients.push({ res, uid:req.params.uid });
});

app.listen(PORT,()=>console.log('🚀 running',PORT));
