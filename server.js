require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const admin = require('firebase-admin');
const path = require('path');
const axios = require('axios'); 
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

const app = express();
app.disable('etag');
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;


/* --------------------- Global safety handlers --------------------- */
process.on('unhandledRejection', (reason, p) => {
  console.error('UNHANDLED REJECTION at: Promise', p, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION', err);
});
// 生成 2FA 密钥和二维码
app.post('/api/admin/generate-2fa', async (req, res) => {
  const { adminId } = req.body;  // 获取管理员ID

  if (!adminId) {
    return res.status(400).json({ ok: false, message: '管理员账号不能为空' });
  }

  // 生成 2FA 密钥
  const secret = speakeasy.generateSecret({ name: `NEXBIT 管理后台 - ${adminId}` });

  // 使用二维码生成库生成二维码 URL
  qrcode.toDataURL(secret.otpauth_url, function (err, qr_code) {
    if (err) {
      return res.status(500).json({ ok: false, message: '二维码生成失败' });
    }

    // 将密钥存储到数据库，方便后续验证
    // 示例：await db.ref(`admins/${adminId}/2fa_secret`).set(secret.base32);

    // 返回生成的二维码和密钥
    res.json({
      ok: true,
      qr_code: qr_code,  // 二维码链接
      secret: secret.base32 // 2FA 密钥
    });
  });
});

// 验证 2FA 验证码
app.post('/api/admin/verify-2fa', async (req, res) => {
  const { adminId, code } = req.body;

  if (!adminId || !code) {
    return res.status(400).json({ ok: false, message: '管理员账号和验证码不能为空' });
  }

  // 从数据库获取管理员的 2FA 密钥（此处为假设，实际使用时需从数据库读取）
  // 例如：const secret = await db.ref(`admins/${adminId}/2fa_secret`).once('value');
  const secret = '你的2FA密钥';  // 这里需要替换为从数据库中获取的密钥

  // 使用 speakeasy 库验证验证码
  const verified = speakeasy.totp.verify({
    secret: secret,
    encoding: 'base32',
    token: code
  });

  if (verified) {
    return res.json({ ok: true, message: '2FA 验证成功' });
  } else {
    return res.status(400).json({ ok: false, message: '验证码错误' });
  }
});
/* ---------------------------------------------------------
   Middleware
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
   Firebase RTDB init (optional)
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
function isSafeUid(uid){
  if(!uid || typeof uid !== 'string') return false;
  if(/[.#$\[\]]/.test(uid)) return false;
  if(uid.indexOf('{{') !== -1 || uid.indexOf('}}') !== -1) return false;
  if(uid.length < 2 || uid.length > 512) return false;
  return true;
}
async function ensureUserExists(uid){
  if(!db) return;
  if(!isSafeUid(uid)) return;

  const ref = db.ref(`users/${uid}`);
  const snap = await ref.once('value');

  if(snap.exists()) return;

  const ts = now();
  await ref.set({
    userid: uid,
    created: ts,
    updated: ts,
    balance: 0
  });
}

// ================================
// USDT 价格缓存（CoinGecko）
// ================================
const PRICE_CACHE = {
  USDT: 1
};

// CoinGecko 币种映射（常用 + 可无限扩展）
const COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  SOL: 'solana',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  TRX: 'tron',
  AVAX: 'avalanche-2',
  DOT: 'polkadot',
  MATIC: 'matic-network',
  LTC: 'litecoin',
  BCH: 'bitcoin-cash',
  LINK: 'chainlink',
  ATOM: 'cosmos',
  ETC: 'ethereum-classic',
  FIL: 'filecoin',
  ICP: 'internet-computer',
  APT: 'aptos',
  ARB: 'arbitrum',
  OP: 'optimism',
  NEAR: 'near',
  EOS: 'eos',
  XTZ: 'tezos',
  XLM: 'stellar',
  SAND: 'the-sandbox',
  MANA: 'decentraland',
  APE: 'apecoin',
  AXS: 'axie-infinity',
  GALA: 'gala',
  FTM: 'fantom',
  RUNE: 'thorchain',
  KAVA: 'kava',
  CRV: 'curve-dao-token',
  UNI: 'uniswap',
  AAVE: 'aave',
  CAKE: 'pancakeswap-token',
  DYDX: 'dydx',
  INJ: 'injective-protocol',
  SUI: 'sui'
};

// 拉取 CoinGecko 行情（稳定，不封云）
async function fetchCoinGeckoPrices(){
  try{
    const ids = Object.values(COINGECKO_IDS).join(',');
    const res = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price',
      {
        params: {
          ids,
          vs_currencies: 'usd'
        },
        timeout: 10000
      }
    );

    for(const [symbol, id] of Object.entries(COINGECKO_IDS)){
      const price = res.data[id]?.usd;
      if(price && price > 0){
        PRICE_CACHE[symbol] = price;
      }
    }

    PRICE_CACHE.USDT = 1;
    console.log('[PRICE] CoinGecko updated:', Object.keys(PRICE_CACHE).length);

  }catch(e){
    console.log('[PRICE] CoinGecko error:', e.message);
  }
}

// 启动 & 定时刷新（10 秒一次，后台足够）
fetchCoinGeckoPrices();
setInterval(fetchCoinGeckoPrices, 10000);

// ================================
// USDT 估算工具（统一）
// ================================
function getUSDTPrice(coin){
  if(!coin) return null;
  return PRICE_CACHE[String(coin).toUpperCase()] || null;
}

function calcEstimateUSDT(amount, coin){
  const p = getUSDTPrice(coin);
  if(!p) return null;
  return Number((safeNumber(amount, 0) * p).toFixed(4));
}
/* ---------------------------------------------------------
   SSE utilities
--------------------------------------------------------- */
global.__sseClients = global.__sseClients || [];

function sendSSE(res, payloadStr, eventName){
  try {
    if (res.finished || (res.connection && res.connection.destroyed)) return false;
    if (eventName) res.write(`event: ${eventName}\n`);
    res.write(`data: ${payloadStr}\n\n`);
    return true;
  } catch(e){
    return false;
  }
}

function broadcastSSE(payloadObj){
  const payload = JSON.stringify(payloadObj);
  const toKeep = [];
  global.__sseClients.forEach(client => {
    try {
      const { res, uid } = client;
      if (!res || (res.finished || (res.connection && res.connection.destroyed))) {
        return;
      }
      const eventName = payloadObj && payloadObj.type ? String(payloadObj.type) : null;

      if (payloadObj && payloadObj.order && payloadObj.order.userId) {
        if (uid === null || uid === undefined || String(uid) === String(payloadObj.order.userId)) {
          const ok = sendSSE(res, payload, eventName);
          if (ok) toKeep.push(client);
        } else {
          toKeep.push(client);
        }
      } else if (payloadObj && payloadObj.userId) {
        if (uid === null || uid === undefined || String(uid) === String(payloadObj.userId)) {
          const ok = sendSSE(res, payload, eventName);
          if (ok) toKeep.push(client);
        } else {
          toKeep.push(client);
        }
      } else {
        const ok = sendSSE(res, payload, eventName);
        if (ok) toKeep.push(client);
      }
    } catch(e){}
  });
  global.__sseClients = toKeep;
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
   Basic user sync
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
   Balance endpoints
--------------------------------------------------------- */
app.get('/api/balance/:uid', async (req, res) => {
  try {
    const uid = String(req.params.uid || '').trim();
    if(!isSafeUid(uid)) return res.status(400).json({ ok:false, error:'invalid uid' });
    if (!db) return res.json({ ok:true, balance: 0 });
    await ensureUserExists(uid);
    const snap = await db.ref(`users/${uid}/balance`).once('value');
    return res.json({ ok:true, balance: Number(snap.val() || 0) });
  } catch (e){
    console.error('balance api error', e);
    return res.json({ ok:false, balance: 0 });
  }
});

app.get('/wallet/:uid/balance', async (req, res) => {
  try {
    const uid = String(req.params.uid || '').trim();
    if(!isSafeUid(uid)) return res.status(400).json({ ok:false, error:'invalid uid' });
    if (!db) return res.json({ ok:true, uid, balance: 0 });
    const snap = await db.ref(`users/${uid}/balance`).once('value');
    const balance = safeNumber(snap.exists() ? snap.val() : 0, 0);
    return res.json({ ok:true, uid, balance });
  } catch (e) {
    console.error('/wallet/:uid/balance error', e);
    return res.status(500).json({ ok:false, error: e.message });
  }
});
/* ---------------------------------------------------------
   Wallet internal deduct (PLAN / TRADE 用)
--------------------------------------------------------- */
app.post('/wallet/:uid/deduct', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });

    const uid = String(req.params.uid || '').trim();
    const amount = Number(req.body.amount || 0);

    if (!isSafeUid(uid))
      return res.status(400).json({ ok:false, error:'invalid uid' });

    if (amount <= 0)
      return res.status(400).json({ ok:false, error:'invalid amount' });

    await ensureUserExists(uid);

    const userRef = db.ref(`users/${uid}`);
    const snap = await userRef.once('value');
    const curBal = snap.exists()
      ? safeNumber(snap.val().balance, 0)
      : 0;

    if (curBal < amount) {
      return res.status(400).json({ ok:false, error:'Insufficient balance' });
    }

    const newBal = curBal - amount;

    await userRef.update({
      balance: newBal,
      lastUpdate: now()
    });

    // 🔔 推送钱包余额（前端 SSE 立刻生效）
    try {
      broadcastSSE({
        type: 'balance',
        userId: uid,
        balance: newBal,
        source: 'plan_deduct'
      });
    } catch(e){}

    return res.json({ ok:true, balance: newBal });

  } catch (e) {
    console.error('/wallet/:uid/deduct error', e);
    return res.status(500).json({ ok:false, error: e.message });
  }
});

/* ---------------------------------------------------------
   Admin utility endpoints (set/deduct/boost)
--------------------------------------------------------- */
app.post('/api/admin/balance', async (req, res) => {
  try {

    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer '))
      return res.status(403).json({ ok:false });

    const token = auth.slice(7);
    if (!await isValidAdminToken(token))
      return res.status(403).json({ ok:false });

    // 👇 下面才是 balance 逻辑

    // ===============================
    // ✅ 后面只写业务逻辑（不要再验 token）
    // ===============================

    const { user, amount } = req.body;
    if (user === undefined || amount === undefined)
      return res.status(400).json({ ok:false, error:'missing user/amount' });

    if (!db) return res.json({ ok:false, message:'no-db' });
    if (!isSafeUid(user))
      return res.status(400).json({ ok:false, error:'invalid user id' });

    const ref = db.ref(`users/${user}`);
    await ref.update({
      balance: Number(amount),
      lastUpdate: now(),
      boost_last: now()
    });

    // 记录 admin action
    const actId = genOrderId('ADMIN_ACT');
    await db.ref(`admin_actions/${actId}`).set({
      id: actId,
      type: 'set_balance',
      user,
      amount: Number(amount),
      by: 'admin',
      time: now()
    });

    // 记录订单
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

    try {
      broadcastSSE({ type:'balance', userId:user, balance:Number(amount) });
    } catch(e){}

    return res.json({ ok:true, balance:Number(amount) });

  } catch (e) {
    console.error('[admin/balance]', e);
    return res.json({ ok:false });
  }
});


/* ---------------------------------------------------------
   Save Order (centralized)
   - ensures coin is preserved, writes user_orders
   - includes 'processed' flag to prevent double-processing by admin
   - broadcasts both 'new' and buysell events so admin UI and wallet UI both receive
--------------------------------------------------------- */
async function saveOrder(type, data){
  if (!db) return null;

  const ts = now();
  const allowed = [
  'userId','user','amount','coin','side','converted','coinQty',
  'tp','sl','note','meta','orderId','status','deducted','wallet','ip','currency'
];


  const clean = {};
  Object.keys(data || {}).forEach(k => {
    if (allowed.includes(k)) clean[k] = data[k];
  });

  if (!clean.userId && clean.user) clean.userId = clean.user;

  const id = clean.orderId || genOrderId(type.toUpperCase());

  const payload = {
    ...clean,
    orderId: id,
    timestamp: ts,
    time_us: usTime(ts),
    status: clean.status || 'processing',
    type,
    processed: false,
    coin: clean.coin || null,

    // 保存钱包地址到用户
    wallet: clean.wallet || null,
    estimate:
  type === 'buysell'
    ? Number(clean.amount)      // buysell 的 amount 本来就是 USDT
    : calcEstimateUSDT(clean.amount, clean.coin)
  };

  await db.ref(`orders/${type}/${id}`).set(payload);

  // user_orders 索引
  if (payload.userId) {
    try {
      await db.ref(`user_orders/${payload.userId}/${id}`).set({
        orderId: id,
        type,
        timestamp: ts
      });

      // ✅ 保存钱包地址到用户
      const userRef = db.ref(`users/${payload.userId}`);
      const userSnap = await userRef.once('value');
      const user = userSnap.val() || {};

      // 只保留最后一个钱包地址，避免重复记录
      const wallets = user.wallets || [];
      if (clean.wallet && !wallets.includes(clean.wallet)) {
        wallets.push(clean.wallet);
        await userRef.update({ wallets });
      }

    } catch(e) {
      console.warn('user_orders write failed:', e.message);
    }
  }

  // SSE 广播
  try {
    broadcastSSE({
      type: 'new',
      typeName: type,
      userId: payload.userId,
      order: payload
    });

    if (type === 'buysell') {
      broadcastSSE({
        type: 'buysell',
        typeName: type,
        userId: payload.userId,
        order: payload
      });
    }
  } catch(e){}

  return id;
}

/* ---------------------------------------------------------
   BuySell endpoints
   - /proxy/buysell kept for legacy frontends
   - both /proxy/buysell and /api/order/buysell share same logic
   - buy: immediate deduction; sell: create order (admin approval required to credit)
--------------------------------------------------------- */
async function handleBuySellRequest(req, res){
  try {
    if(!db) return res.json({ ok:false, error:'no-db' });

    const {
      userId,
      user,
      side,
      tradeType,   // ✅ 兼容 buysell.html
      coin,
      amount,
      converted,
      tp,
      sl,
      orderId,
      wallet,
      ip
    } = req.body;

    const uid = userId || user;
    await ensureUserExists(uid);
    const realSide = side || tradeType;   // ✅ 关键修复
    const amt = Number(amount || 0);

    if(!uid || !realSide || !coin || amt <= 0){
      return res.status(400).json({ ok:false, error:'missing fields' });
    }
    if(!isSafeUid(uid)){
      return res.status(400).json({ ok:false, error:'invalid uid' });
    }

    const userRef = db.ref(`users/${uid}`);
    const snap = await userRef.once('value');
    const balance = snap.exists() ? safeNumber(snap.val().balance, 0) : 0;

    const sideLower = String(realSide).toLowerCase();

    // ✅ BUY：立即扣钱
    if(sideLower === 'buy'){
      if(balance < amt){
        return res.status(400).json({ ok:false, error:'余额不足' });
      }
      const newBal = balance - amt;
      await userRef.update({ balance: newBal, lastUpdate: now() });
      broadcastSSE({ type:'balance', userId: uid, balance: newBal });
    }

    // ===== 计算币数量（安全版）=====
let coinQty = 0;

// ① 优先用前端传来的币数量
if (converted !== undefined && converted !== null && Number(converted) > 0) {
  coinQty = Number(converted);
}
// ② 否则用 USDT / price 计算
else {
  const price = getUSDTPrice(coin);
  if (price && price > 0) {
    coinQty = Number((amt / price).toFixed(6));
  }
}

// ===== 保存订单 =====
const id = await saveOrder('buysell', {
  userId: uid,
  side: sideLower,
  coin,
  amount: amt,              // USDT（保持不变）
  coinQty,                  // ✅ 新增：币数量
  tp: tp || null,
  sl: sl || null,
  orderId,
  deducted: (sideLower === 'buy'),
  wallet: wallet || null,
  ip: ip || null,
  processed: false
});

    return res.json({ ok:true, orderId: id });
  } catch(e){
    console.error('handleBuySellRequest error', e);
    return res.status(500).json({ ok:false, error: e.message });
  }
}
app.post('/proxy/buysell', handleBuySellRequest);
app.post('/api/order/buysell', handleBuySellRequest);

/* ---------------------------------------------------------
   Recharge endpoint
--------------------------------------------------------- */
app.post('/api/order/recharge', async (req, res) => {
  try {
    if(!db) return res.json({ ok:false, error:'no-db' });
    const payload = req.body || {};
    const userId = payload.userId || payload.user;
    await ensureUserExists(userId);
    if(!userId) return res.status(400).json({ ok:false, error:'missing userId' });
    if(!isSafeUid(userId)) return res.status(400).json({ ok:false, error:'invalid uid' });
    const id = await saveOrder('recharge', payload);
    return res.json({ ok:true, orderId: id });
  } catch(e){ console.error(e); return res.status(500).json({ ok:false, error:e.message }); }
});

/* ---------------------------------------------------------
   Withdraw endpoint (deduct immediately)
--------------------------------------------------------- */
app.post('/api/order/withdraw', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });

    const payload = req.body || {};
    const userId = payload.userId || payload.user;

    if (!userId) {
      return res.status(400).json({ ok:false, error:'missing userId' });
    }
    if (!isSafeUid(userId)) {
      return res.status(400).json({ ok:false, error:'invalid uid' });
    }

    await ensureUserExists(userId);

    // ===== 关键字段 =====
    const amountCoin = Number(payload.amount || 0);        // 币数量（只记录）
    const estimateUSDT = Number(payload.estimate || 0);    // ✅ USDT（扣款用）

    if (!amountCoin || amountCoin <= 0) {
      return res.status(400).json({ ok:false, error:'invalid amount' });
    }

    if (!estimateUSDT || estimateUSDT <= 0) {
      return res.status(400).json({ ok:false, error:'invalid estimate' });
    }

    const userRef = db.ref(`users/${userId}`);
    const snap = await userRef.once('value');
    const curBal = snap.exists()
      ? safeNumber(snap.val().balance, 0)
      : 0;

    // ✅ 用 USDT 校验余额
    if (curBal < estimateUSDT) {
      return res.status(400).json({ ok:false, error:'余额不足' });
    }

    // ✅ 用 USDT 扣款
    const newBal = curBal - estimateUSDT;

    await userRef.update({
      balance: newBal,
      lastUpdate: now(),
      boost_last: now()
    });

    // 推送余额更新
    try {
      broadcastSSE({
        type: 'balance',
        userId,
        balance: newBal,
        source: 'withdraw_submit'
      });
    } catch(e){}

    // 保存提款订单（币数量 + USDT 都保留）
    const orderId = await saveOrder('withdraw', {
      ...payload,
      userId,
      amount: amountCoin,          // 币数量
      estimate: estimateUSDT,       // USDT
      status: 'pending',
      deducted: true,
      processed: false
    });

    return res.json({ ok:true, orderId });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, error: e.message });
  }
});
// ===== 工具函数：按时间倒序 =====
function sortByTimeDesc(arr) {
  return (arr || []).sort(
    (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
  );
}

/* ---------------------------------------------------------
   Get transactions for admin UI
--------------------------------------------------------- */
app.get('/api/transactions', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer '))
      return res.status(403).json({ ok:false });

    const token = auth.slice(7);
    if (!await isValidAdminToken(token))
      return res.status(403).json({ ok:false });

    if (!db) {
      return res.json({
        ok:true,
        recharge: [],
        withdraw: [],
        buysell: [],
        users: {},
        stats: {}
      });
    }

    const [rechargeSnap, withdrawSnap, buysellSnap, usersSnap] =
      await Promise.all([
        db.ref('orders/recharge').once('value'),
        db.ref('orders/withdraw').once('value'),
        db.ref('orders/buysell').once('value'),
        db.ref('users').once('value')
      ]);

    return res.json({
      ok: true,
      recharge: sortByTimeDesc(Object.values(rechargeSnap.val() || {})),
      withdraw: sortByTimeDesc(Object.values(withdrawSnap.val() || {})),
      buysell:  sortByTimeDesc(Object.values(buysellSnap.val() || {})),
      users: usersSnap.val() || {}
    });

  } catch (e) {
    console.error('transactions error', e);
    return res.status(500).json({ ok:false });
  }
});
/* ---------------------------------------------------------
   Admin token helpers
--------------------------------------------------------- */
async function isValidAdminToken(token){
  if (!db || !token) return false;
  try {
    const snap = await db.ref(`admins_by_token/${token}`).once('value');
    if (!snap.exists()) return false;
    const rec = snap.val();
    const ttlDays = safeNumber(process.env.ADMIN_TOKEN_TTL_DAYS, 30); // 30天有效期
    const ageMs = now() - (rec.created || 0);
    if (ageMs > ttlDays * 24 * 60 * 60 * 1000) { 
      try { 
        await db.ref(`admins_by_token/${token}`).remove(); 
      } catch (e) {} 
      return false; 
    }
    return true;
  } catch(e) { return false; }
}



/* ---------------------------------------------------------
   Admin create/login (kept)
--------------------------------------------------------- */
app.post('/api/admin/create', async (req, res) => {
  try {
    const { id, password, createToken } = req.body;
    if (!id || !password) {
      return res.status(400).json({ ok: false, error: 'missing id/password' });
    }

    // 验证创建 Token 是否正确
    if (process.env.ADMIN_BOOTSTRAP_TOKEN && createToken === process.env.ADMIN_BOOTSTRAP_TOKEN) {
      // 如果是引导令牌，允许创建
    } else {
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Bearer '))
        return res.status(403).json({ ok: false, error: 'forbidden' });

      const adminToken = auth.slice(7);
      if (!await isValidAdminToken(adminToken)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }
    }

    // 哈希化密码
    const hashed = await bcrypt.hash(password, 10);
    const token = uuidv4();  // 生成管理员 token
    const created = now();   // 获取当前时间戳

    // 保存管理员信息到 Firebase 数据库
    await db.ref(`admins/${id}`).set({
      id,
      hashed,
      created,
      isSuper: false   // 设置为普通管理员，修改为 true 则为超级管理员
    });

    // 生成管理员 token
    await db.ref(`admins_by_token/${token}`).set({
      id,
      created
    });

    return res.json({ ok: true, id, token });  // 返回管理员信息和 token

  } catch (e) {
    console.error('admin create error', e);
    return res.status(500).json({ ok: false, error: 'internal server error' });
  }
});

/* --------------------------------------------------
   Utils
-------------------------------------------------- */
app.post('/api/admin/login', async (req, res) => {
  try {
    const { id, password } = req.body;
    if (!id || !password)
      return res.status(400).json({ ok: false, error: 'missing id/password' });

    const snap = await db.ref(`admins/${id}`).once('value');
    if (!snap.exists())
      return res.status(404).json({ ok: false, error: 'admin not found' });

    const admin = snap.val();
    const passOk = await bcrypt.compare(password, admin.hashed);  // 比较密码
    if (!passOk)
      return res.status(401).json({ ok: false, error: 'incorrect password' });

    const token = uuidv4();  // 生成新 token
    await db.ref(`admins_by_token/${token}`).set({
      id,
      created: now()  // 保存 token 和创建时间
    });

    return res.json({ ok: true, token });  // 返回登录成功的 token

  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'internal server error' });
  }
});
/* ---------------------------------------------------------
   Admin: approve/decline transactions (idempotent)
   - prevents double-processing by checking 'processed' flag
--------------------------------------------------------- */
app.post('/api/transaction/update', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });

const auth = req.headers.authorization || '';
if (!auth.startsWith('Bearer '))
  return res.status(403).json({ ok:false });

const token = auth.slice(7);
if (!await isValidAdminToken(token))
  return res.status(403).json({ ok:false });


    const adminRec = await db.ref(`admins_by_token/${token}`).once('value');
    const adminId = adminRec.exists() ? adminRec.val().id : 'admin';

    const { type, orderId, status, note } = req.body;
    if (!type || !orderId) return res.status(400).json({ ok:false, error:'missing type/orderId' });

    const ref = db.ref(`orders/${type}/${orderId}`);
    const snap = await ref.once('value');
    if (!snap.exists()) return res.status(404).json({ ok:false, error:'order not found' });

    const order = snap.val();

    // prevent double-processing
    if (order.processed === true) {
      // still record admin action but don't apply balance changes again
      const actIdSkip = uuidv4();
      await db.ref(`admin_actions/${actIdSkip}`).set({ id: actIdSkip, admin: adminId, type, orderId, status, note, time: now(), skipped:true });
      return res.json({ ok:true, message:'already processed' });
    }

    // update order status and mark processed after applying business logic
    const actId = uuidv4();
    await db.ref(`admin_actions/${actId}`).set({ id: actId, admin: adminId, type, orderId, status, note, time: now() });

    // handle balance effects
    const userId = order && order.userId ? order.userId : null;
    if (userId) {
      const userRef = db.ref(`users/${userId}`);
      const uSnap = await userRef.once('value');
      let curBal = uSnap.exists() ? safeNumber(uSnap.val().balance, 0) : 0;
      const amt = Number(order.estimate || 0);
// 1️⃣ 先更新状态（不 processed）
await ref.update({
  status,
  note: note || null,
  updated: now()
});

// 2️⃣ 统一计算状态
const statusNorm = String(status || '').toLowerCase();

// ✅ 统一批准
const isApproved = (
  statusNorm === 'success' ||
  statusNorm === 'approved' ||
  statusNorm === 'pass' ||
  statusNorm === '通过'
);

// ✅ 统一拒绝 / 取消（补全中文 & 常见值）
const isRejected = (
  statusNorm === 'failed' ||
  statusNorm === 'reject' ||
  statusNorm === 'rejected' ||
  statusNorm === 'cancel' ||
  statusNorm === 'canceled' ||
  statusNorm === 'decline' ||
  statusNorm === 'deny' ||
  statusNorm === '拒绝' ||
  statusNorm === '取消'
);

if (isApproved) {
  if (type === 'recharge') {
    curBal += amt;
    await userRef.update({
      balance: curBal,
      lastUpdate: now(),
      boost_last: now()
    });

    broadcastSSE({
      type: 'balance',
      userId,
      balance: curBal,
      source: 'recharge_approved'
    });
  }
 }

// ===== 所有余额业务逻辑 =====
// ===== withdraw 拒绝 → 退回 USDT（estimate）=====
if (
  type === 'withdraw' &&
  isRejected &&
  order.deducted === true &&
  order.refunded !== true
) {
  const refundUSDT = Number(order.estimate || 0); // ✅ USDT

  if (refundUSDT > 0) {
    curBal += refundUSDT;

    await userRef.update({
      balance: curBal,
      lastUpdate: now(),
      boost_last: now()
    });

    await ref.update({ refunded: true });

    broadcastSSE({
      type: 'balance',
      userId,
      balance: curBal,
      source: 'withdraw_refund'
    });
  }
}

// ===== buysell sell 通过 → 加钱（保持原样）=====
else if (
  type === 'buysell' &&
  isApproved &&
  String(order.side || '').toLowerCase() === 'sell'
) {
  curBal += amt; // amt 在 buysell 里本来就是 USDT
  await userRef.update({
    balance: curBal,
    lastUpdate: now(),
    boost_last: now()
  });

  broadcastSSE({
    type: 'balance',
    userId,
    balance: curBal
  });
}
// ===== ✅【最终正确】统一写回最终状态 + processed =====
let finalStatus = null;

if (isApproved) finalStatus = "approved";
if (isRejected) finalStatus = "rejected";

if (finalStatus) {
  await ref.update({
    status: finalStatus,
    processed: true,
    updated: now()
  });
}

// ===== 再广播订单更新 =====
const newSnap = await ref.once('value');
const latestOrder = { ...newSnap.val(), orderId };

broadcastSSE({
  type: 'update',
  typeName: type,
  userId: latestOrder.userId,
  order: latestOrder,
  action: { admin: adminId, status, note }
});
}
return res.json({ ok: true });

} catch (e) {
  console.error('transaction.update err', e);
  return res.status(500).json({ ok:false, error: e.message });
}
});

/* ---------------------------------------------------------
   SSE endpoints
--------------------------------------------------------- */
app.get('/api/orders/stream', async (req, res) => {
  res.set({ 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'Connection':'keep-alive' });
  res.flushHeaders();
  const ka = setInterval(()=>{ try{ res.write(':\n\n'); } catch(e){} }, 15000);
  global.__sseClients.push({ res, uid: null, ka });
  req.on('close', () => { clearInterval(ka); global.__sseClients = global.__sseClients.filter(c => c.res !== res); });
});

app.get('/wallet/:uid/sse', async (req, res) => {
  const uid = String(req.params.uid || '').trim();
  await ensureUserExists(uid);
  res.set({ 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'Connection':'keep-alive' });
  res.flushHeaders();
  const ka = setInterval(()=>{ try{ res.write(':\n\n'); } catch(e){} }, 15000);
  global.__sseClients.push({ res, uid, ka });
  try {
    if (!db) sendSSE(res, JSON.stringify({ type:'balance', userId: uid, balance: 0 }), 'balance');
    else {
      const snap = await db.ref(`users/${uid}/balance`).once('value');
      const bal = safeNumber(snap.exists() ? snap.val() : 0, 0);
      sendSSE(res, JSON.stringify({ type:'balance', userId: uid, balance: bal }), 'balance');
    }
  } catch(e){}
  req.on('close', () => { clearInterval(ka); global.__sseClients = global.__sseClients.filter(c => c.res !== res); });
});

/* ---------------------------------------------------------
   Firebase watchers
--------------------------------------------------------- */
try {
  if (db) {
    const ordersRef = db.ref('orders');
    ordersRef.on('child_changed', (snap) => {
      try {
        const kind = snap.key;
        const val = snap.val() || {};
        Object.values(val).forEach(ord => { try { broadcastSSE({ type:'update', typeName: kind, order:ord }); } catch(e){} });
      } catch(e){}
    });
    ordersRef.on('child_added', (snap) => {
      try {
        const kind = snap.key;
        const val = snap.val() || {};
        Object.values(val).forEach(ord => { try { broadcastSSE({ type: (kind === 'buysell' ? 'buysell' : 'new'), typeName: kind, order:ord }); } catch(e){} });
      } catch(e){}
    });

    const usersRef = db.ref('users');
    usersRef.on('child_changed', (snap) => {
      try {
        const uid = snap.key;
        const data = snap.val() || {};
   
      } catch(e){}
    });
  }
} catch(e){ console.warn('SSE firebase watch failed', e.message); }

/* ---------------------------------------------------------
   Ensure default admin (bootstrap)
--------------------------------------------------------- */
async function ensureDefaultAdmin() {
  if (!db) return;

  const snap = await db.ref('admins/admin').once('value');
  if (snap.exists()) return;

  const hashed = await bcrypt.hash('970611', 10);
  const token = uuidv4();
  const created = now();

  await db.ref('admins/admin').set({
    id: 'admin',
    hashed,
    created,
    isSuper: true
  });

  await db.ref(`admins_by_token/${token}`).set({
    id: 'admin',
    created
  });

  console.log('✅ Default admin created');
}
ensureDefaultAdmin();


/* ---------------------------------------------------------
   Start server
--------------------------------------------------------- */

app.listen(PORT, () => { console.log('🚀 Server running on', PORT); });
