// server.js — 修复版（静态托管 + orders SSE + 管理审核统一接口）
const express = require("express");
const admin = require("firebase-admin");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());

/* ===== Firebase 初始化 ===== */
if (!process.env.FIREBASE_SERVICE_ACCOUNT || !process.env.FIREBASE_DATABASE_URL) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT or FIREBASE_DATABASE_URL env var");
  process.exit(1);
}
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});
const db = admin.firestore();
const rtdb = admin.database();

console.log("✔ Firebase RTDB connected");

/* ===== 静态文件托管（必须） =====
   将 dashboard-brand.html 放到 /public 下，部署时 Railway 会一起托管
*/
app.use(express.static(path.join(__dirname, "public")));

// 明确路由，确保 /dashboard-brand.html 永远可访问（避免某些部署环境 static 路径问题）
app.get("/dashboard-brand.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard-brand.html"));
});

/* ======== SSE 管理 ======== */
// 钱包 SSE 客户端（按 uid 分组）
const walletSseClients = {}; // { uid: [res, ...] }

// 订单 / 管理端 SSE（dashboard 监听 /api/orders/stream）
let orderSseClients = []; // [res, ...]

function pushWalletSSE(uid, payload) {
  const list = walletSseClients[uid];
  if (!list || !list.length) return;
  const data = `event: balance\ndata:${JSON.stringify(payload)}\n\n`;
  list.forEach((res) => {
    try { res.write(data); } catch (e) {}
  });
}

function pushOrderSSE(payload) {
  if (!orderSseClients.length) return;
  const data = `data:${JSON.stringify(payload)}\n\n`;
  orderSseClients.forEach((res) => {
    try { res.write(data); } catch (e) {}
  });
}

/* ======== 实时同步余额 ======== */
async function updateBalance(uid, diff) {
  if (!uid) return null;
  const ref = rtdb.ref(`balances/${uid}`);
  const snap = await ref.get();
  const cur = snap.exists() ? Number(snap.val()) : 0;
  const final = cur + Number(diff || 0);
  await ref.set(final);
  // 推送 SSE 给监听该 uid 的客户端
  pushWalletSSE(uid, { balance: final });
  console.log(`Balance updated for ${uid}: ${cur} -> ${final} (diff ${diff})`);
  return final;
}

/* ======== 钱包 SSE & balance endpoint ======== */
app.get("/wallet/:uid/sse", (req, res) => {
  const uid = req.params.uid;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  if (!walletSseClients[uid]) walletSseClients[uid] = [];
  walletSseClients[uid].push(res);
  console.log(`SSE client connected for uid=${uid}`);

  // Keep connection alive comment ping
  const keepAlive = setInterval(() => {
    try { res.write(`:\n`); } catch (e) {}
  }, 20000);
  req.on("close", () => {
    clearInterval(keepAlive);
    walletSseClients[uid] = walletSseClients[uid].filter((c) => c !== res);
    console.log(`SSE client disconnected for uid=${uid}`);
  });
});

app.get("/wallet/:uid/balance", async (req, res) => {
  const uid = req.params.uid;
  try {
    const snap = await rtdb.ref(`balances/${uid}`).get();
    const bal = snap.exists() ? Number(snap.val()) : 0;
    res.json({ ok: true, balance: bal });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.toString() });
  }
});

/* ======== BuySell / Recharge / Withdraw APIs ======== */
app.post("/buy_sell", async (req, res) => {
  try {
    const { uid, amount, side, coin, price } = req.body;
    const time = Date.now();
    const docRef = await db.collection("orders").add({
      uid, amount, side, coin, price, status: "pending", time,
    });
    // 下单立即扣减（业务决定：下单即锁仓）
    await updateBalance(uid, -Math.abs(Number(amount || 0)));
    // 推送订单事件给 dashboard
    pushOrderSSE({ event: "new_order", orderId: docRef.id, order: { uid, amount, side, coin, price, status: "pending", time } });
    res.json({ ok: true, id: docRef.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.toString() });
  }
});

app.post("/recharge", async (req, res) => {
  try {
    const { uid, amount, txid } = req.body;
    const time = Date.now();
    const docRef = await db.collection("recharge").add({ uid, amount, txid, time, status: "pending" });
    pushOrderSSE({ event: "new_recharge", id: docRef.id, data: { uid, amount, txid, time, status: "pending" } });
    res.json({ ok: true, id: docRef.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.toString() });
  }
});

app.post("/withdraw", async (req, res) => {
  try {
    const { uid, amount, address } = req.body;
    const time = Date.now();
    const docRef = await db.collection("withdraw").add({ uid, amount, address, time, status: "pending" });
    // 预先扣减（如同你的原逻辑）
    await updateBalance(uid, -Math.abs(Number(amount || 0)));
    pushOrderSSE({ event: "new_withdraw", id: docRef.id, data: { uid, amount, address, time, status: "pending" } });
    res.json({ ok: true, id: docRef.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.toString() });
  }
});

/* ======== 后台管理 API（用于 dashboard） ======== */
/* 返回 orders / recharge / withdraw 的合并数据（dashboard 用 fetchAll）
   支持查询参数进行过滤，但这里先返回全部（dashboard 前端在客户端筛选）
*/
app.get("/api/transactions", async (req, res) => {
  try {
    const list = { buysell: [], recharge: [], withdraw: [], users: {}, stats: {} };

    const ordersSnap = await db.collection("orders").orderBy("time", "desc").limit(500).get();
    ordersSnap.forEach((d) => list.buysell.push({ orderId: d.id, ...d.data() }));

    const rechSnap = await db.collection("recharge").orderBy("time", "desc").limit(500).get();
    rechSnap.forEach((d) => list.recharge.push({ orderId: d.id, ...d.data() }));

    const wSnap = await db.collection("withdraw").orderBy("time", "desc").limit(500).get();
    wSnap.forEach((d) => list.withdraw.push({ orderId: d.id, ...d.data() }));

    // 可扩展：users/stats 由你自己生成或从其他集合聚合
    list.stats = { todayRecharge: 0, todayWithdraw: 0, todayOrders: list.buysell.length, alerts: 0 };

    res.json({ ok: true, ...list });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.toString() });
  }
});

/* Dashboard 单条订单详情（fetchOrder 参数）*/
app.get("/api/transactions", async (req, res, next) => {
  // 已被上面的方法覆盖（保持兼容）；这里保留以免重复路由错误
  next();
});

/* 管理端统一更新接口（dashboard 用 /api/transaction/update）*/
app.post("/api/transaction/update", async (req, res) => {
  try {
    const { orderId, type, status, note } = req.body;
    if (!orderId) return res.status(400).json({ ok: false, error: "missing orderId" });

    // 优先在 orders, recharge, withdraw 三个集合尝试更新
    const collections = ["orders", "recharge", "withdraw"];
    let updated = false;
    let updatedDoc = null;

    for (const col of collections) {
      const docRef = db.collection(col).doc(orderId);
      const docSnap = await docRef.get();
      if (docSnap.exists) {
        await docRef.update({ status });
        updated = true;
        updatedDoc = { id: docSnap.id, collection: col, data: { ...docSnap.data(), status } };

        // 特殊逻辑：充值成功要增加余额
        if (col === "recharge" && status === "success") {
          const uid = docSnap.data().uid;
          const amount = Number(docSnap.data().amount || 0);
          await updateBalance(uid, amount);
        }

        // 如果是 orders 且审核为 success/failed/locked -> 触发不同逻辑
        if (col === "orders") {
          const uid = docSnap.data().uid;
          const amount = Number(docSnap.data().amount || 0);
          // 如果订单被标为 failed -> 退回余额
          if (status === "failed") {
            await updateBalance(uid, amount); // 退回
          }
          // 如果订单被标为 success -> 已在下单时扣款（或根据业务调整）
        }

        // 推送事件给 dashboard SSE
        pushOrderSSE({ event: "update", collection: col, id: docSnap.id, status, note });

        break;
      }
    }

    if (!updated) return res.status(404).json({ ok: false, error: "order not found in known collections" });

    res.json({ ok: true, updated: updatedDoc });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.toString() });
  }
});

/* 后台专用：获取所有 orders（供 SSE 直接打开用）*/
app.get("/api/orders", async (req, res) => {
  try {
    const snapshot = await db.collection("orders").orderBy("time", "desc").limit(500).get();
    const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ ok: true, list: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.toString() });
  }
});

/* ======== Orders SSE（dashboard 订阅：/api/orders/stream） ======== */
app.get("/api/orders/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // initial ping to keep connection
  res.write(`data: connected\n\n`);
  orderSseClients.push(res);
  console.log("Dashboard SSE connected (/api/orders/stream) - total:", orderSseClients.length);

  const keep = setInterval(() => {
    try { res.write(`:\n`); } catch (e) {}
  }, 20000);

  req.on("close", () => {
    clearInterval(keep);
    orderSseClients = orderSseClients.filter((r) => r !== res); // NOTE: reassign below can't mutate const; we'll reassign
    try {
      // remove closed streams
      orderSseClients = orderSseClients.filter((c) => c !== res);
    } catch (e) {}
    console.log("Dashboard SSE disconnected - remaining:", orderSseClients.length);
  });
});

/* ======== Firestore collection watchers（把变更主动推到 dashboard SSE） ======== */
function watchCollection(name) {
  const col = db.collection(name);
  col.onSnapshot((snap) => {
    snap.docChanges().forEach((change) => {
      try {
        const data = change.doc.data();
        const id = change.doc.id;
        const payload = { collection: name, id, type: change.type, data };
        // send to dashboard SSE
        pushOrderSSE({ event: `${name}_change`, payload });
      } catch (e) {
        console.error("Watcher error:", e.toString());
      }
    });
  }, (err) => {
    console.error("Watch error on", name, err && err.toString());
  });
}

// 启动监听（orders / recharge / withdraw）
watchCollection("orders");
watchCollection("recharge");
watchCollection("withdraw");

/* ======== 启动 ======== */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
