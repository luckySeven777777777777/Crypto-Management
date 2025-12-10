require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.disable('etag');
const PORT = process.env.PORT || 8080;

// ---------------- CORS ----------------
app.use(cors({
  origin: '*',
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','x-user-id']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname,'public')));

// ---------------- Firebase Init ----------------
let db = null;
try {
  const admin = require('firebase-admin');
  if (process.env.FIREBASE_SERVICE_ACCOUNT && process.env.FIREBASE_DATABASE_URL) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    db = admin.database();
    console.log('✅ Firebase RTDB connected');
  } else {
    console.warn("❌ Firebase ENV missing.");
  }
} catch(e){
  console.warn("❌ Firebase init failed:", e.message);
}

// =============== Helpers ===============
function now(){ return Date.now(); }

function fmtUsTime(ts){
  return new Date(ts).toLocaleString('en-US',{ timeZone:'America/New_York' });
}

function safeNum(n, f=0){
  const v = Number(n);
  return Number.isFinite(v) ? v : f;
}

// =========================================
// =============== SSE 修复版 ===============
// =========================================
global.__sseClients = [];

// 全新的广播函数 —— 永不卡死、永不积压
function pushSSE(payload){
  const msg = `data: ${JSON.stringify(payload)}\n\n`;

  global.__sseClients = global.__sseClients.filter(res => {
    if (res.writableEnded) return false;
    try {
      res.write(msg);
      return true;
    } catch(e){
      return false;
    }
  });
}

app.get("/api/orders/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });
  res.flushHeaders();

  global.__sseClients.push(res);

  const keepAlive = setInterval(() => {
    try { res.write(":\n\n"); } catch(e){}
  }, 15000);

  req.on("close", () => {
    clearInterval(keepAlive);
    global.__sseClients = global.__sseClients.filter(r => r !== res);
  });
});

// Root
app.get('/', (_,res)=> res.send("Backend running"));
// ===============================================================
// =============== 用户自动修复（所有同步失败的根源） ===============
// ===============================================================
async function ensureUser(uid){
  if (!uid || !db) return null;

  const ref = db.ref(`/users/${uid}`);
  const snap = await ref.once("value");

  // 若用户不存在，则自动创建（永不出现用户找不到）
  if (!snap.exists()) {
    const newUser = {
      id: uid,
      balance: 0,
      createdAt: now()
    };
    await ref.set(newUser);
    console.log("⚡ 自动创建用户 →", uid);
    return newUser;
  }

  const data = snap.val();

  // 若余额字段损坏，则自动修复
  if (typeof data.balance !== "number") {
    data.balance = 0;
    await ref.update({ balance: 0 });
    console.log("⚡ 自动修复余额 →", uid);
  }

  return data;
}

// ===============================================================
// =============== 同步用户（前端页面进入自动触发） ===============
// ===============================================================
app.post("/api/users/sync", async (req, res) => {
  try{
    const { userId } = req.body;
    const user = await ensureUser(userId);

    res.json({ ok: true, user });
  }catch(e){
    res.json({ ok:false, err:e.message });
  }
});

// ===============================================================
// =============== 获取余额（前端每 5s 调用一次） ===============
// ===============================================================
app.get("/api/balance/:uid", async (req, res) => {
  try{
    const uid = req.params.uid;
    const user = await ensureUser(uid);

    res.json({
      ok: true,
      balance: user.balance || 0,
      syncedAt: fmtUsTime(now())
    });

  }catch(e){
    res.json({ ok:false, balance:0 });
  }
});
// ====================================================================
// =============== 余额写入函数（统一修复 + 推送 SSE） ===============
// ====================================================================
async function applyBalance(uid, delta){
  const user = await ensureUser(uid);
  const oldBal = user.balance || 0;
  const newBal = oldBal + delta;

  await db.ref(`/users/${uid}`).update({
    balance: newBal,
    updatedAt: now()
  });

  console.log(`💰 余额变动 → ${uid} : ${oldBal} => ${newBal}`);

  // ======== ★ 关键：推送实时事件，让前端立即同步 ========
  pushSSE({
    type: "balance_update",
    userId: uid,
    oldBalance: oldBal,
    newBalance: newBal,
    timestamp: now()
  });

  return newBal;
}



// ====================================================================
// ===================== 充值（管理后台调用） ==========================
// ====================================================================
app.post("/api/order/recharge", async (req, res) => {
  try{
    const { userId, amount } = req.body;

    const amt = safeNum(amount, 0);
    const newBal = await applyBalance(userId, amt);

    res.json({
      ok: true,
      userId,
      balance: newBal
    });

  }catch(e){
    res.json({ ok:false, err:e.message });
  }
});


// ====================================================================
// ====================== 扣款（管理后台调用） =========================
// ====================================================================
app.post("/api/order/withdraw", async (req, res) => {
  try{
    const { userId, amount } = req.body;

    const amt = -Math.abs(safeNum(amount, 0));
    const newBal = await applyBalance(userId, amt);

    res.json({
      ok: true,
      userId,
      balance: newBal
    });

  }catch(e){
    res.json({ ok:false, err:e.message });
  }
});


// ====================================================================
// ================= 买卖 buy/sell（必要时扣余额） ======================
// ====================================================================
app.post("/api/order/buysell", async (req, res) => {
  try{
    const { userId, fee } = req.body;

    const cost = safeNum(fee, 0);

    // 若需要扣费则写入
    if(cost > 0){
      await applyBalance(userId, -cost);
    }

    res.json({
      ok: true,
      userId,
      cost
    });

  }catch(e){
    res.json({ ok:false, err:e.message });
  }
});
// ====================================================================
// =========================== 管理员登录 ==============================
// ====================================================================

app.post("/api/admin/login", async (req, res) => {
  try{
    const { id, password } = req.body;

    const snap = await db.ref(`/admins/${id}`).once("value");
    if(!snap.exists()){
      return res.json({ ok:false, error:"admin_notfound" });
    }

    const admin = snap.val();
    const correct = await bcrypt.compare(password, admin.hashed);

    if(!correct){
      return res.json({ ok:false, error:"invalid_password" });
    }

    const token = uuidv4();
    await db.ref(`/admins_by_token/${token}`).set({
      id,
      created: now()
    });

    res.json({
      ok: true,
      token,
      id
    });

  }catch(e){
    res.json({ ok:false, error:e.message });
  }
});


// ====================================================================
// ======================= Token 权限验证 ==============================
// ====================================================================
async function checkAdminToken(req){
  try{
    const auth = req.headers["authorization"] || "";
    if(!auth.startsWith("Bearer ")) return null;

    const token = auth.replace("Bearer ","").trim();

    const snap = await db.ref(`/admins_by_token/${token}`).once("value");
    if(!snap.exists()) return null;

    return snap.val().id || null;

  }catch(e){
    return null;
  }
}


// ====================================================================
// ========================= SSE 实时推送 ==============================
// ====================================================================

const SSE_CLIENTS = [];

function pushSSE(data){
  const json = `data: ${JSON.stringify(data)}\n\n`;
  SSE_CLIENTS.forEach(c => c.write(json));
}

app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type","text/event-stream");
  res.setHeader("Cache-Control","no-cache");
  res.setHeader("Connection","keep-alive");

  res.write("data: connected\n\n");

  SSE_CLIENTS.push(res);

  req.on("close", () => {
    const i = SSE_CLIENTS.indexOf(res);
    if(i>=0) SSE_CLIENTS.splice(i,1);
  });
});


// ====================================================================
// ================== 自动生成 / 修复管理员账号 ========================
// ====================================================================

async function ensureAdmin(){
  try{
    const snap = await db.ref("/admins/admin").once("value");

    const plain = "970611";
    const hashed = await bcrypt.hash(plain,10);
    const token = uuidv4();

    const payload = {
      id: "admin",
      hashed,
      created: now(),
      token,
      isSuper: true
    };

    await db.ref("/admins/admin").set(payload);
    await db.ref("/admins_by_token/" + token).set({
      id: "admin",
      created: now()
    });

    console.log("✔ 管理员自动修复成功：admin / 970611");

  }catch(e){
    console.error("管理员自动修复失败", e);
  }
}

ensureAdmin();


// ====================================================================
// =========================== 服务器启动 ==============================
// ====================================================================

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
