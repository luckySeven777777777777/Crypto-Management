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

/* --------------------- Global safety --------------------- */
process.on('unhandledRejection', r => console.error(r));
process.on('uncaughtException', e => console.error(e));

/* --------------------- Middleware --------------------- */
app.use(cors({ origin:'*' }));
app.use(express.json());
app.use(express.urlencoded({ extended:true }));
app.use(express.static(path.join(__dirname,'public')));

/* --------------------- Firebase RTDB --------------------- */
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
  console.error('Firebase init failed', e.message);
}

/* --------------------- Helpers --------------------- */
const now = () => Date.now();
const usTime = t => new Date(t).toLocaleString('en-US',{timeZone:'America/New_York'});
const safeNum = (v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const genId = p => `${p}-${now()}-${Math.floor(1000+Math.random()*9000)}`;
const isSafeUid = u => typeof u==='string' && !/[.#$\[\]]/.test(u);

/* --------------------- SSE Core --------------------- */
global.__sseClients = [];

function sendSSE(res,data,event){
  try{
    if(res.finished) return;
    if(event) res.write(`event: ${event}\n`);
    res.write(`data: ${data}\n\n`);
  }catch{}
}

function broadcastSSE(obj){
  const payload = JSON.stringify(obj);
  global.__sseClients = global.__sseClients.filter(c=>{
    try{
      if(c.uid && obj.userId && String(c.uid)!==String(obj.userId)) return true;
      sendSSE(c.res,payload,obj.type);
      return true;
    }catch{ return false; }
  });
}

/* --------------------- Root --------------------- */
app.get('/',(_,res)=>res.send('OK'));

/* --------------------- Balance API --------------------- */
app.get('/wallet/:uid/balance', async (req,res)=>{
  const uid=req.params.uid;
  if(!db||!isSafeUid(uid)) return res.json({ok:true,balance:0});
  const s=await db.ref(`users/${uid}/balance`).once('value');
  res.json({ok:true,balance:safeNum(s.val())});
});

/* --------------------- Buy / Sell --------------------- */
async function handleBuySell(req,res){
  if(!db) return res.json({ok:false});
  const { userId, side, coin, amount } = req.body;
  if(!userId||!side||!coin) return res.status(400).json({ok:false});
  const amt=safeNum(amount);
  const uref=db.ref(`users/${userId}`);
  const snap=await uref.once('value');
  let bal=safeNum(snap.val()?.balance);

  if(side.toLowerCase()==='buy'){
    if(bal<amt) return res.status(400).json({ok:false});
    bal-=amt;
    await uref.update({balance:bal,lastUpdate:now()});
    broadcastSSE({type:'balance',userId,balance:bal});
  }

  const oid=genId('BUYSELL');
  await db.ref(`orders/buysell/${oid}`).set({
    orderId:oid,userId,side,coin,amount:amt,
    status:'processing',processed:false,
    timestamp:now(),time_us:usTime(now())
  });

  broadcastSSE({type:'new',typeName:'buysell',userId,order:{orderId:oid}});
  res.json({ok:true,orderId:oid});
}

app.post('/api/order/buysell',handleBuySell);
app.post('/proxy/buysell',handleBuySell);

/* --------------------- Recharge --------------------- */
app.post('/api/order/recharge',async(req,res)=>{
  if(!db) return res.json({ok:false});
  const { userId, amount }=req.body;
  const oid=genId('RECHARGE');
  await db.ref(`orders/recharge/${oid}`).set({
    orderId:oid,userId,amount:safeNum(amount),
    status:'pending',processed:false,
    timestamp:now(),time_us:usTime(now())
  });
  broadcastSSE({type:'new',typeName:'recharge',userId,order:{orderId:oid}});
  res.json({ok:true,orderId:oid});
});

/* --------------------- Withdraw --------------------- */
app.post('/api/order/withdraw',async(req,res)=>{
  if(!db) return res.json({ok:false});
  const { userId, amount }=req.body;
  const amt=safeNum(amount);
  const ref=db.ref(`users/${userId}`);
  const s=await ref.once('value');
  let bal=safeNum(s.val()?.balance);
  if(bal<amt) return res.status(400).json({ok:false});
  bal-=amt;
  await ref.update({balance:bal,lastUpdate:now()});
  broadcastSSE({type:'balance',userId,balance:bal});

  const oid=genId('WITHDRAW');
  await db.ref(`orders/withdraw/${oid}`).set({
    orderId:oid,userId,amount:amt,
    status:'pending',processed:false,
    timestamp:now(),time_us:usTime(now())
  });
  broadcastSSE({type:'new',typeName:'withdraw',userId,order:{orderId:oid}});
  res.json({ok:true,orderId:oid});
});

/* --------------------- Admin approve --------------------- */
app.post('/api/transaction/update',async(req,res)=>{
  if(!db) return res.json({ok:false});
  const { type, orderId, status }=req.body;
  const ref=db.ref(`orders/${type}/${orderId}`);
  const s=await ref.once('value');
  if(!s.exists()) return res.status(404).json({ok:false});
  const o=s.val();
  if(o.processed) return res.json({ok:true});

  if(type==='recharge' && ['success','approved','pass'].includes(String(status).toLowerCase())){
    const u=db.ref(`users/${o.userId}`);
    const us=await u.once('value');
    let bal=safeNum(us.val()?.balance)+safeNum(o.amount);
    await u.update({balance:bal,lastUpdate:now()});

    broadcastSSE({
      type:'balance',
      userId:o.userId,
      balance:bal,
      source:'recharge_approved'
    });
  }

  await ref.update({status,processed:true,updated:now()});
  broadcastSSE({type:'update',typeName:type,userId:o.userId,order:{...o,status}});
  res.json({ok:true});
});

/* --------------------- SSE endpoints --------------------- */
app.get('/api/orders/stream',(req,res)=>{
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
  res.flushHeaders();
  global.__sseClients.push({res,uid:null});
  req.on('close',()=>global.__sseClients=global.__sseClients.filter(c=>c.res!==res));
});

app.get('/wallet/:uid/sse',async(req,res)=>{
  const uid=req.params.uid;
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
  res.flushHeaders();
  global.__sseClients.push({res,uid});
  if(db){
    const s=await db.ref(`users/${uid}/balance`).once('value');
    sendSSE(res,JSON.stringify({type:'balance',userId:uid,balance:safeNum(s.val())}),'balance');
  }
  req.on('close',()=>global.__sseClients=global.__sseClients.filter(c=>c.res!==res));
});

/* --------------------- Start --------------------- */
app.listen(PORT,()=>console.log('🚀 running',PORT));
