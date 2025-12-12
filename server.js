// ======= NEXBIT FULL SERVER.JS (FINAL VERSION) =======

const express = require("express");
const admin = require("firebase-admin");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

/* ===== Firebase 初始化 ===== */
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});
const db = admin.firestore();
const rtdb = admin.database();

console.log("✔ Firebase RTDB connected");

/* ======== SSE 客户端存储 ======== */
const sseClients = {};

function pushSSE(uid, payload) {
  const list = sseClients[uid];
  if (!list) return;

  const data = `event: balance\ndata:${JSON.stringify(payload)}\n\n`;
  list.forEach((res) => res.write(data));
}

/* ======== 实时同步余额 ======== */
async function updateBalance(uid, diff) {
  const ref = rtdb.ref(`balances/${uid}`);
  const snap = await ref.get();
  const cur = snap.exists() ? Number(snap.val()) : 0;
  const final = cur + diff;

  await ref.set(final);
  pushSSE(uid, { balance: final });
  return final;
}

/* ======== 钱包 SSE ======== */
app.get("/wallet/:uid/sse", (req, res) => {
  const uid = req.params.uid;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  if (!sseClients[uid]) sseClients[uid] = [];
  sseClients[uid].push(res);

  console.log(`SSE client connected for uid=${uid}`);

  req.on("close", () => {
    sseClients[uid] = sseClients[uid].filter((c) => c !== res);
  });
});

/* ======== 钱包余额查询 ======== */
app.get("/wallet/:uid/balance", async (req, res) => {
  const uid = req.params.uid;
  const snap = await rtdb.ref(`balances/${uid}`).get();
  const bal = snap.exists() ? Number(snap.val()) : 0;
  res.json({ ok: true, balance: bal });
});

/* ======== BuySell 下单 ======== */
app.post("/buy_sell", async (req, res) => {
  try {
    const { uid, amount, side, coin, price } = req.body;

    const time = Date.now();
    await db.collection("orders").add({
      uid,
      amount,
      side,
      coin,
      price,
      status: "pending",
      time,
    });

    await updateBalance(uid, amount * -1);

    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.toString() });
  }
});

/* ======== 充值 ======== */
app.post("/recharge", async (req, res) => {
  try {
    const { uid, amount, txid } = req.body;

    const time = Date.now();
    await db.collection("recharge").add({
      uid,
      amount,
      txid,
      time,
      status: "pending",
    });

    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.toString() });
  }
});

/* ======== 提现 ======== */
app.post("/withdraw", async (req, res) => {
  try {
    const { uid, amount, address } = req.body;

    const time = Date.now();
    await db.collection("withdraw").add({
      uid,
      amount,
      address,
      time,
      status: "pending",
    });

    await updateBalance(uid, -amount);

    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.toString() });
  }
});

/* ============================================================
   ===============   【后台管理 API 恢复版】   =================
   ============================================================ */

/* ===== 所有订单（BuySell）===== */
app.get("/api/orders", async (req, res) => {
  try {
    const snapshot = await db.collection("orders").orderBy("time", "desc").get();
    const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ ok: true, list: data });
  } catch (err) {
    res.json({ ok: false, error: err.toString() });
  }
});

/* ===== 所有充值 ===== */
app.get("/api/recharge", async (req, res) => {
  try {
    const snapshot = await db.collection("recharge").orderBy("time", "desc").get();
    const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ ok: true, list: data });
  } catch (err) {
    res.json({ ok: false, error: err.toString() });
  }
});

/* ===== 所有提现 ===== */
app.get("/api/withdraw", async (req, res) => {
  try {
    const snapshot = await db.collection("withdraw").orderBy("time", "desc").get();
    const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.json({ ok: true, list: data });
  } catch (err) {
    res.json({ ok: false, error: err.toString() });
  }
});

/* ===== 所有交易（后台总表）===== */
app.get("/api/transactions", async (req, res) => {
  try {
    const list = [];

    const orders = await db.collection("orders").get();
    orders.forEach((doc) => list.push({ type: "order", id: doc.id, ...doc.data() }));

    const recharge = await db.collection("recharge").get();
    recharge.forEach((doc) =>
      list.push({ type: "recharge", id: doc.id, ...doc.data() })
    );

    const withdraw = await db.collection("withdraw").get();
    withdraw.forEach((doc) =>
      list.push({ type: "withdraw", id: doc.id, ...doc.data() })
    );

    list.sort((a, b) => b.time - a.time);

    res.json({ ok: true, list });
  } catch (err) {
    res.json({ ok: false, error: err.toString() });
  }
});

/* ===== 充值审核 ===== */
app.post("/api/recharge/update", async (req, res) => {
  try {
    const { id, status, uid, amount } = req.body;

    await db.collection("recharge").doc(id).update({ status });

    if (status === "success") {
      await updateBalance(uid, Number(amount));
    }

    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.toString() });
  }
});

/* ===== 提现审核 ===== */
app.post("/api/withdraw/update", async (req, res) => {
  try {
    const { id, status } = req.body;

    await db.collection("withdraw").doc(id).update({ status });
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.toString() });
  }
});

/* ======== 启动 ======== */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
