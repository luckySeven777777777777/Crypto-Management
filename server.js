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
   CORS
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

// SSE
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
   Admin set balance
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

    return res.json({ ok:true, balance: newBal });
  } catch (e){
    console.error('admin balance set error', e);
    return res.json({ ok:false });
  }
});


/* ---------------------------------------------------------
   Admin recharge
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

    return res.json({ ok: true, balance: newBalance });
  } catch (e){
    console.error('admin recharge error', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});


/* ---------------------------------------------------------
   Admin deduct
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
    if (Number(balance) < Number(amount))
      return res.status(400).json({ ok:false, error:"余额不足" });

    const newBalance = Number(balance) - Number(amount);
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

    const ordId = genOrderId('WD');
    await db.ref(`orders/withdraw/${ordId}`).set({
      orderId: ordId,
      userId,
      amount: Number(amount),
      timestamp: now(),
      time_us: usTime(now()),
      type:'deduct',
      status:'success'
    });

    return res.json({ ok:true, balance:newBalance });
  } catch (e){
    console.error('admin deduct error', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});


/* ---------------------------------------------------------
   Save Order
--------------------------------------------------------- */
async function saveOrder(type, data){
  if(!db) return null;
  const ts = now();

  const allowed = [
    'userId','user','amount','coin','side','converted',
    'tp','sl','note','meta','orderId','status','type'
  ];

  const clean = {};
  Object.keys(data||{}).forEach(k=>{
    if(allowed.includes(k)) clean[k] = data[k];
  });

  if(!clean.userId && clean.user) clean.userId = clean.user;

  const id = clean.orderId || genOrderId(type.toUpperCase());

  const payload = {
    ...clean,
    orderId: id,
    timestamp: ts,
    time_us: usTime(ts),
    status: clean.status || 'processing',
    type
  };

  await db.ref(`orders/${type}/${id}`).set(payload);

  try {
    if (payload.userId) {
      await db.ref(`user_orders/${payload.userId}/${id}`).set({
        orderId: id, type, timestamp: ts
      });
    }
  } catch(e){
    console.warn('saveOrder:user_orders failed', e.message);
  }

  try{
    broadcastSSE({ type:'new', kind:type, order: payload });
  }catch(e){}

  return id;
}


/* ---------------------------------------------------------
   Buy/Sell Order
--------------------------------------------------------- */
app.post('/api/order/buysell', async (req, res) => {
  try {
    if(!db) return res.json({ ok:false, error:'no-db' });

    const { userId, user, side, coin, amount, converted, tp, sl, orderId } = req.body;
    const uid = userId || user;

    if(!uid || !side || !coin || amount === undefined || amount === null)
      return res.status(400).json({ ok:false, error:'missing fields' });

    const userRef = db.ref(`users/${uid}`);
    const snap = await userRef.once('value');

    const curBal = snap.exists() ? safeNumber(snap.val().balance, 0) : 0;

    if (String(side).toLowerCase() === 'buy') {
      if (curBal < Number(amount))
        return res.status(400).json({ ok:false, error:'余额不足' });

      await userRef.update({
        balance: curBal - Number(amount),
        lastUpdate: now()
      });
    }

    if (String(side).toLowerCase() === 'sell') {
      await userRef.update({
        balance: curBal + Number(amount),
        lastUpdate: now()
      });
    }

    const id = await saveOrder('buysell', {
      userId: uid,
      side, coin,
      amount: Number(amount),
      converted: converted || null,
      tp: tp || null,
      sl: sl || null,
      orderId
    });

    return res.json({ ok:true, orderId:id });

  } catch(e){
    console.error('buysell order error', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});
/* ---------------------------------------------------------
   提交充值订单
--------------------------------------------------------- */
app.post('/api/order/recharge', async (req, res) => {
  try {
    if(!db) return res.json({ ok:false, error:'no-db' });

    const payload = req.body || {};
    const id = await saveOrder('recharge', payload);

    return res.json({ ok:true, orderId: id });
  } catch(e){
    console.error('recharge order error', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});


/* ---------------------------------------------------------
   提交提款订单
--------------------------------------------------------- */
app.post('/api/order/withdraw', async (req, res) => {
  try {
    if(!db) return res.json({ ok:false, error:'no-db' });

    const payload = req.body || {};
    const userId = payload.userId || payload.user;

    if(!userId || payload.amount === undefined || payload.amount === null)
      return res.status(400).json({ ok:false, error:'missing userId/amount' });

    const snap = await db.ref(`users/${userId}/balance`).once('value');
    const curBal = snap.exists() ? safeNumber(snap.val(), 0) : 0;

    if(curBal < Number(payload.amount))
      return res.status(400).json({ ok:false, error:'余额不足' });

    const id = await saveOrder('withdraw', payload);

    return res.json({ ok:true, orderId:id });

  } catch(e){
    console.error('withdraw order error', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});


/* ---------------------------------------------------------
   获取全部订单 + 用户 + 快速订单查找
--------------------------------------------------------- */
app.get('/api/transactions', async (req, res) => {
  try {
    if(!db) return res.json({
      ok:true,
      recharge:[], withdraw:[], buysell:[],
      users:{}, stats:{}
    });

    const fetchOrderId = req.query.fetchOrder;
    if(fetchOrderId){
      const paths = ['orders/recharge','orders/withdraw','orders/buysell'];
      for(const p of paths){
        const snap = await db.ref(p).once('value');
        const obj = snap.val() || {};
        const found = Object.values(obj).find(o => String(o.orderId) === String(fetchOrderId));
        if(found){
          const actionsSnap = await db.ref('admin_actions')
            .orderByChild('orderId')
            .equalTo(fetchOrderId)
            .once('value');

          const actions = Object.values(actionsSnap.val() || {});
          return res.json({ ok:true, order:found, orderEvents:actions });
        }
      }
      return res.json({ ok:false, error:'order not found' });
    }

    const [rechargeSnap, withdrawSnap, buysellSnap, usersSnap] = await Promise.all([
      db.ref('orders/recharge').once('value'),
      db.ref('orders/withdraw').once('value'),
      db.ref('orders/buysell').once('value'),
      db.ref('users').once('value')
    ]);

    const recharge = objToSortedArray(rechargeSnap.val() || {});
    const withdraw = objToSortedArray(withdrawSnap.val() || {});
    const buysell  = objToSortedArray(buysellSnap.val()  || {});
    const users    = usersSnap.val() || {};

    return res.json({
      ok:true,
      recharge,
      withdraw,
      buysell,
      users,
      stats:{
        todayRecharge: recharge.length,
        todayWithdraw: withdraw.length,
        todayOrders: recharge.length + withdraw.length + buysell.length,
        alerts:0
      }
    });

  } catch(e){
    console.error('transactions error', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});


/* ---------------------------------------------------------
   Admin: token 校验
--------------------------------------------------------- */
async function isValidAdminToken(token){
  if(!db || !token) return false;
  try{
    const snap = await db.ref(`admins_by_token/${token}`).once('value');
    if(!snap.exists()) return false;

    const rec = snap.val();
    const ttlDays = safeNumber(process.env.ADMIN_TOKEN_TTL_DAYS, 30);
    const ageMs = now() - (rec.created || 0);

    if(ageMs > ttlDays * 24*60*60*1000){
      try{ await db.ref(`admins_by_token/${token}`).remove(); }catch(e){}
      return false;
    }
    return true;
  } catch(e){
    return false;
  }
}


/* ---------------------------------------------------------
   Admin: create
--------------------------------------------------------- */
app.post('/api/admin/create', async (req, res) => {
  try {
    const { id, password, createToken } = req.body;

    if(!id || !password) return res.status(400).json({ ok:false, error:'missing id/password' });

    // only allow creation via bootstrap token or existing admin
    if(process.env.ADMIN_BOOTSTRAP_TOKEN && createToken === process.env.ADMIN_BOOTSTRAP_TOKEN){
      // allow
    } else {
      const auth = req.headers['authorization'] || '';
      if(!auth.startsWith('Bearer ')) return res.status(403).json({ ok:false, error:'forbidden' });

      const token = auth.slice(7);
      if(!await isValidAdminToken(token)) return res.status(403).json({ ok:false, error:'forbidden' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const token = uuidv4();
    const created = now();

    await db.ref(`admins/${id}`).set({ id, hashed, created, token });
    await db.ref(`admins_by_token/${token}`).set({ id, created });

    return res.json({ ok:true, id, token });

  } catch(e){
    console.error('admin.create', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});


/* ---------------------------------------------------------
   Admin: login
--------------------------------------------------------- */
app.post('/api/admin/login', async (req, res) => {
  try {
    const { id, password } = req.body;

    if(!id || !password) return res.status(400).json({ ok:false, error:'missing' });

    const snap = await db.ref(`admins/${id}`).once('value');
    if(!snap.exists()) return res.status(404).json({ ok:false, error:'notfound' });

    const rec = snap.val();
    const hash = rec.hashed || rec.passwordHash || '';

    const ok = await bcrypt.compare(password, hash);
    if(!ok) return res.status(401).json({ ok:false, error:'invalid' });

    const token = rec.token || uuidv4();
    const created = now();

    await db.ref(`admins_by_token/${token}`).set({ id, created });

    return res.json({ ok:true, token, id });

  } catch(e){
    console.error('admin.login', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});
/* ---------------------------------------------------------
   交易更新（后台审批）
--------------------------------------------------------- */
app.post('/api/transaction/update', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });

    const auth = req.headers['authorization'] || '';
    if (!auth.startsWith('Bearer '))
      return res.status(403).json({ ok:false, error:'require admin auth' });

    const token = auth.slice(7);
    const valid = await isValidAdminToken(token);
    if (!valid) return res.status(403).json({ ok:false, error:'invalid admin token' });

    const adminRec = await db.ref(`admins_by_token/${token}`).once('value');
    const adminId = adminRec.exists() ? adminRec.val().id : 'admin';

    const { type, orderId, status, note } = req.body;
    if (!type || !orderId) return res.status(400).json({ ok:false, error:'missing type/orderId' });

    const ref = db.ref(`orders/${type}/${orderId}`);
    const snap = await ref.once('value');
    if (!snap.exists()) return res.status(404).json({ ok:false, error:'order not found' });

    await ref.update({
      status,
      note: note || null,
      updated: now()
    });

    const actId = uuidv4();
    await db.ref(`admin_actions/${actId}`).set({
      id: actId,
      admin: adminId,
      type,
      orderId,
      status,
      note,
      time: now()
    });

    // 如果审批成功：更新余额
    try {
      const order = snap.val();
      if (status === 'success' && order && order.userId) {
        const userRef = db.ref(`users/${order.userId}`);
        const uSnap = await userRef.once('value');
        const curBal = uSnap.exists() ? safeNumber(uSnap.val().balance, 0) : 0;
        const amt = Number(order.amount || 0);

        if (type === 'recharge') {
          await userRef.update({ balance: curBal + amt, lastUpdate: now() });
        } else if (type === 'withdraw') {
          if (curBal >= amt) {
            await userRef.update({ balance: curBal - amt, lastUpdate: now() });
          } else {
            await ref.update({ status:'failed', note:'Insufficient balance when approving' });
          }
        }
      }
    } catch (e) {
      console.warn('post-processing failed', e.message);
    }

    // 推送 SSE
    try {
      broadcastSSE({
        type:'update',
        orderId,
        typeName:type,
        order:{ ...snap.val(), orderId },
        action:{ admin:adminId, status, note }
      });
    } catch(e){}

    return res.json({ ok:true });

  } catch(e){
    console.error('transaction.update err', e);
    return res.status(500).json({ ok:false, error:e.message });
  }
});


/* ---------------------------------------------------------
   SSE 订单流
--------------------------------------------------------- */
app.get('/api/orders/stream', async (req, res) => {
  res.set({
    'Content-Type':'text/event-stream',
    'Cache-Control':'no-cache',
    'Connection':'keep-alive'
  });
  res.flushHeaders();

  // keepalive
  const ka = setInterval(()=>{ try{ res.write(':\n\n'); } catch(e){} }, 15000);

  global.__sseClients.push(res);

  req.on('close', () => {
    clearInterval(ka);
    global.__sseClients = global.__sseClients.filter(r => r !== res);
  });
});

// Firebase watchers
try {
  if (db) {
    const ordersRef = db.ref('orders');
    ordersRef.on('child_changed', (snap) => {
      const kind = snap.key;
      const val = snap.val() || {};
      Object.values(val).forEach(ord => {
        broadcastSSE({ type:'update', kind, order:ord });
      });
    });
  }
} catch(e){
  console.warn('SSE firebase watch failed', e.message);
}


/* ---------------------------------------------------------
   强制重置管理员：admin / 970611
   （覆盖 Firebase 中 admins/admin）
--------------------------------------------------------- */
async function ensureDefaultAdmin() {
  try {
    if (!db) {
      console.warn('⚠️ 无法创建管理员：Firebase 未连接');
      return;
    }

    console.log('⚠️ 正在强制重置管理员：admin / 970611');

    const plain = '970611';
    const hashed = await bcrypt.hash(plain, 10);
    const token = uuidv4();
    const created = now();

    // 直接覆盖，无条件重置
    await db.ref('admins/admin').set({
      id: 'admin',
      hashed,
      created,
      token,
      isSuper: true
    });

    await db.ref(`admins_by_token/${token}`).set({
      id: 'admin',
      created
    });

    console.log('🎉 管理员已强制重置：admin / 970611');

  } catch(e){
    console.error('❌ ensureDefaultAdmin 失败:', e);
  }
}

// 启动时执行一次
ensureDefaultAdmin();


/* ---------------------------------------------------------
   启动服务器
--------------------------------------------------------- */
app.listen(PORT, () => {
  console.log('🚀 Server running on', PORT);
});
