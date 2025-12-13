/******************************************************
 * NEXBIT BACKEND — FULL server.js (WITHDRAW-LOGIC)
 * 规则：
 * 充值：仅后台通过才加钱
 * BUY ：下单立即扣钱
 * SELL：下单不动余额，后台通过才加钱
 * 提款：下单立即扣钱，拒绝退回
 * 后台 / 机器人 / SSE 同步一致
 ******************************************************/

require('dotenv').config()
const express = require('express')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const { v4: uuidv4 } = require('uuid')
const admin = require('firebase-admin')

/* ================= INIT ================= */
const app = express()
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'] }))
app.use(express.json())

const PORT = process.env.PORT || 8080

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  ),
  databaseURL: process.env.FIREBASE_DATABASE_URL
})
const db = admin.database()

/* ================= UTILS ================= */
const now = () => Date.now()
const genId = p => `${p}-${now()}-${Math.floor(Math.random()*9000+1000)}`
const okStatus = s =>
  ['success','approved','completed','ok','通过'].includes(String(s).toLowerCase())
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0

/* ================= SSE ================= */
global.__SSE = []

function pushBalance(uid, balance){
  const data = `data: ${JSON.stringify({ type:'balance', userId:uid, balance })}\n\n`
  global.__SSE = global.__SSE.filter(c=>{
    try{
      if(c.uid && c.uid !== uid) return true
      c.res.write(data)
      return true
    }catch(e){ return false }
  })
}

app.get('/wallet/:uid/sse', async(req,res)=>{
  const uid = req.params.uid
  res.set({
    'Content-Type':'text/event-stream',
    'Cache-Control':'no-cache',
    'Connection':'keep-alive'
  })
  res.flushHeaders()
  global.__SSE.push({ res, uid })

  const balSnap = await db.ref(`users/${uid}/balance`).once('value')
  const bal = balSnap.exists() ? num(balSnap.val()) : 0
  res.write(`data: ${JSON.stringify({ type:'balance', userId:uid, balance:bal })}\n\n`)

  req.on('close',()=>{
    global.__SSE = global.__SSE.filter(c=>c.res!==res)
  })
})

/* ================= BALANCE API ================= */
app.get('/wallet/:uid/balance', async(req,res)=>{
  const snap = await db.ref(`users/${req.params.uid}/balance`).once('value')
  res.json({ ok:true, balance: num(snap.val()) })
})

/* =================================================
   CREATE ORDERS
================================================= */

/* -------- BUY / SELL -------- */
app.post('/api/order/buysell', async(req,res)=>{
  const { userId, side, amount } = req.body
  const amt = num(amount)
  const userRef = db.ref(`users/${userId}`)
  const snap = await userRef.once('value')
  let bal = snap.exists() ? num(snap.val().balance) : 0

  if(side === 'buy'){
    if(bal < amt) return res.status(400).json({ ok:false, error:'balance low' })
    bal -= amt
    await userRef.update({ balance: bal })
    pushBalance(userId, bal)
  }

  const oid = genId('BS')
  await db.ref(`orders/buysell/${oid}`).set({
    orderId: oid,
    userId,
    side,
    amount: amt,
    deducted: side === 'buy',
    processed: false,
    status: 'pending',
    time: now()
  })

  res.json({ ok:true, orderId: oid })
})

/* -------- RECHARGE -------- */
app.post('/api/order/recharge', async(req,res)=>{
  const oid = genId('RC')
  await db.ref(`orders/recharge/${oid}`).set({
    ...req.body,
    orderId: oid,
    processed: false,
    status: 'pending',
    time: now()
  })
  res.json({ ok:true, orderId: oid })
})

/* -------- WITHDRAW -------- */
app.post('/api/order/withdraw', async(req,res)=>{
  const { userId, amount } = req.body
  const amt = num(amount)
  const userRef = db.ref(`users/${userId}`)
  const snap = await userRef.once('value')
  let bal = snap.exists() ? num(snap.val().balance) : 0

  if(bal < amt) return res.status(400).json({ ok:false, error:'balance low' })

  bal -= amt
  await userRef.update({ balance: bal })
  pushBalance(userId, bal)

  const oid = genId('WD')
  await db.ref(`orders/withdraw/${oid}`).set({
    orderId: oid,
    userId,
    amount: amt,
    deducted: true,
    processed: false,
    status: 'pending',
    time: now()
  })

  res.json({ ok:true, orderId: oid })
})

/* =================================================
   ADMIN APPROVE / REJECT — 核心（提款逻辑）
================================================= */
app.post('/api/transaction/update', async(req,res)=>{
  const { type, orderId, status } = req.body
  const ref = db.ref(`orders/${type}/${orderId}`)
  const snap = await ref.once('value')
  if(!snap.exists()) return res.status(404).json({ ok:false })
  const ord = snap.val()
  if(ord.processed) return res.json({ ok:true })

  const userRef = db.ref(`users/${ord.userId}`)
  const usnap = await userRef.once('value')
  let bal = usnap.exists() ? num(usnap.val().balance) : 0
  const amt = num(ord.amount)

  if(okStatus(status)){
    if(type === 'recharge') bal += amt
    if(type === 'buysell' && ord.side === 'sell') bal += amt
  }else{
    if(type === 'withdraw' && ord.deducted) bal += amt
    if(type === 'buysell' && ord.side === 'buy' && ord.deducted) bal += amt
  }

  await userRef.update({ balance: bal })
  await ref.update({ status, processed:true })
  pushBalance(ord.userId, bal)

  res.json({ ok:true })
})

/* ================= START ================= */
app.listen(PORT, ()=> {
  console.log('🚀 NEXBIT RUNNING ON PORT', PORT)
})

