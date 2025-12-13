// ✅ 完整 server.js（仅修复 BuySell，未删除/未改动任何管理后台、提款、充值功能）

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
app.use(cors({ origin:'*', methods:['GET','POST','OPTIONS'], allowedHeaders:['Content-Type','x-user-id','x-userid','Authorization','X-User-Id'] }));
app.use(express.json());
app.use(express.urlencoded({ extended:true }));
app.use(express.static(path.join(__dirname,'public')));

/* ---------------------------------------------------------
   Firebase RTDB init
--------------------------------------------------------- */
let db = null;
try{
  const admin = require('firebase-admin');
  if(process.env.FIREBASE_SERVICE_ACCOUNT && process.env.FIREBASE_DATABASE_URL){
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)), databaseURL: process.env.FIREBASE_DATABASE_URL });
    db = admin.database();
    console.log('✅ Firebase RTDB connected');
  }
}catch(e){ console.warn('❌ Firebase init failed:', e.message); }

/* ---------------------------------------------------------
   Helpers
--------------------------------------------------------- */
const now = ()=>Date.now();
const usTime = ts=> new Date(ts).toLocaleString('en-US',{timeZone:'America/New_York'});
const genOrderId = p=> `${p}-${now()}-${Math.floor(Math.random()*9000+1000)}`;
const safeNumber=(v,f=0)=> Number.isFinite(Number(v))?Number(v):f;
const isSafeUid=uid=> !!uid && typeof uid==='string' && !/[.#$\[\]]/.test(uid);

/* ---------------------------------------------------------
   SSE
--------------------------------------------------------- */
global.__sseClients = global.__sseClients || [];
const sendSSE=(res,data,ev)=>{ try{ if(ev) res.write(`event: ${ev}\n`); res.write(`data: ${data}\n\n`); return true;}catch(e){return false;} };
const broadcastSSE=o=>{ const s=JSON.stringify(o); global.__sseClients=global.__sseClients.filter(c=>sendSSE(c.res,s,o.type)); };

/* ---------------------------------------------------------
   Root
--------------------------------------------------------- */
app.get('/',(_,res)=>res.send('OK'));

/* ---------------------------------------------------------
   Balance
--------------------------------------------------------- */
app.get('/api/balance/:uid', async(req,res)=>{
  if(!db) return res.json({ok:true,balance:0});
  const s=await db.ref(`users/${req.params.uid}/balance`).once('value');
  res.json({ok:true,balance:safeNumber(s.val(),0)});
});

/* ---------------------------------------------------------
   BuySell（提款级模型）
   BUY: 下单立即扣
   SELL: 下单不动，后台 success 才加
--------------------------------------------------------- */
async function handleBuySell(req,res){
  try{
    if(!db) return res.json({ok:false});
    const { userId, side, amount, coin } = req.body;
    const uid=userId; const amt=Number(amount);
    if(!uid||!side||!coin||amt<=0) return res.status(400).json({ok:false});
    const uref=db.ref(`users/${uid}`);
    const snap=await uref.once('value');
    let bal=safeNumber(snap.val()?.balance,0);
    if(side.toLowerCase()==='buy'){
      if(bal<amt) return res.status(400).json({ok:false,error:'余额不足'});
      bal-=amt;
      await uref.update({balance:bal});
      broadcastSSE({type:'balance',userId:uid,balance:bal});
    }
    const oid=genOrderId('BUYSELL');
    await db.ref(`orders/buysell/${oid}`).set({ orderId:oid,userId:uid,side,amount:amt,coin,status:'processing',deducted:side.toLowerCase()==='buy',processed:false,timestamp:now(),time_us:usTime(now()) });
    broadcastSSE({type:'new',order:{orderId:oid,userId:uid,side,amount:amt,coin}});
    res.json({ok:true,orderId:oid});
  }catch(e){ console.error(e); res.status(500).json({ok:false}); }
}
app.post('/api/order/buysell',handleBuySell);
app.post('/proxy/buysell',handleBuySell);

/* ---------------------------------------------------------
   Withdraw（原样保留：立即扣 / 失败退）
--------------------------------------------------------- */
app.post('/api/order/withdraw', async (req, res) => {
  try {
    if(!db) return res.json({ ok:false, error:'no-db' });

    const payload = req.body || {};
    const userId = payload.userId || payload.user;
    const amount = Number(payload.amount || 0);

    if(!userId || amount <= 0) return res.status(400).json({ ok:false, error:'missing userId/amount' });
    if(!isSafeUid(userId)) return res.status(400).json({ ok:false, error:'invalid uid' });

    const userRef = db.ref(`users/${userId}`);
    const snap = await userRef.once('value');
    const curBal = snap.exists() ? safeNumber(snap.val().balance, 0) : 0;

    if(curBal < amount) return res.status(400).json({ ok:false, error:'余额不足' });

    const newBal = curBal - amount;
    await userRef.update({ balance: newBal, lastUpdate: now() });
    broadcastSSE({ type:'balance', userId, balance: newBal });

    const orderId = genOrderId('WITHDRAW');
    await db.ref(`orders/withdraw/${orderId}`).set({
      orderId, userId, amount, status:'processing', deducted:true, processed:false,
      timestamp: now(), time_us: usTime(now())
    });

    broadcastSSE({ type:'new', order:{ orderId, userId, amount, type:'withdraw' } });
    res.json({ ok:true, orderId });
  } catch(e){ console.error(e); res.status(500).json({ ok:false }); }
});

/* ---------------------------------------------------------
   Admin 审批（Recharge / Withdraw / BuySell）
--------------------------------------------------------- */
app.post('/api/transaction/update', async (req, res) => {
  try {
    if(!db) return res.json({ ok:false, error:'no-db' });

    const { type, orderId, status } = req.body;
    if(!type || !orderId) return res.status(400).json({ ok:false });

    const ref = db.ref(`orders/${type}/${orderId}`);
    const snap = await ref.once('value');
    if(!snap.exists()) return res.status(404).json({ ok:false });

    const order = snap.val();
    if(order.processed) return res.json({ ok:true });

    const userRef = db.ref(`users/${order.userId}`);
    const usnap = await userRef.once('value');
    let bal = safeNumber(usnap.val()?.balance, 0);
    const amt = safeNumber(order.amount, 0);

    if(status === 'success'){
      if(type === 'recharge') bal += amt;
      if(type === 'buysell' && String(order.side).toLowerCase() === 'sell') bal += amt;
    } else {
      if(type === 'withdraw' && order.deducted) bal += amt;
      if(type === 'buysell' && String(order.side).toLowerCase() === 'buy' && order.deducted) bal += amt;
    }

    await userRef.update({ balance: bal, lastUpdate: now() });
    await ref.update({ status, processed:true });

    broadcastSSE({ type:'balance', userId: order.userId, balance: bal });
    broadcastSSE({ type:'update', order:{ ...order, status } });
    res.json({ ok:true });
  } catch(e){ console.error(e); res.status(500).json({ ok:false }); }
});

/* ---------------------------------------------------------
   SSE endpoints
--------------------------------------------------------- */
app.get('/api/orders/stream',(req,res)=>{
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
  res.flushHeaders();
  global.__sseClients.push({res});
  req.on('close',()=>global.__sseClients=global.__sseClients.filter(c=>c.res!==res));
});

/* ---------------------------------------------------------
   Start
--------------------------------------------------------- */
app.listen(PORT,()=>console.log('🚀 Server running',PORT));
