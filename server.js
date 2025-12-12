// ======================
// FINAL VERSION server.js
// ======================

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// ------------------ FIREBASE INIT ------------------
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  databaseURL: process.env.FIREBASE_DB_URL
});

const db = admin.firestore();
const rtdb = admin.database();

// ------------------ STATIC FILES ------------------
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// ------------------ DASHBOARD HTML ------------------
app.get("/dashboard-brand.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public/dashboard-brand.html"));
});

// ------------------ GET ALL ORDERS ------------------
app.get("/api/transactions", async (req, res) => {
  try {
    const buysell = [];
    const recharge = [];
    const withdraw = [];

    const snap1 = await db.collection("orders").orderBy("time", "desc").limit(500).get();
    snap1.forEach(d => buysell.push({ id: d.id, ...d.data() }));

    const snap2 = await db.collection("recharge").orderBy("time", "desc").limit(500).get();
    snap2.forEach(d => recharge.push({ id: d.id, ...d.data() }));

    const snap3 = await db.collection("withdraw").orderBy("time", "desc").limit(500).get();
    snap3.forEach(d => withdraw.push({ id: d.id, ...d.data() }));

    return res.json({
      ok: true,
      buysell,
      recharge,
      withdraw,
      users: {},
      stats: {}
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false });
  }
});

// ------------------ SSE: USER BALANCE ------------------
app.get("/wallet/:uid/:token/sse", async (req, res) => {
  const { uid } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();

  const ref = rtdb.ref(`wallets/${uid}/balance`);
  const cb = ref.on("value", snap => {
    res.write(`data: ${JSON.stringify({ balance: snap.val() || 0 })}\n\n`);
  });

  req.on("close", () => ref.off("value", cb));
});

// ------------------ SSE: DASHBOARD ORDER STREAM ------------------
app.get("/api/orders/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();

  // 不使用 onSnapshot（会爆 retries）
  const ref = rtdb.ref("pending_orders");

  const cb = ref.on("child_added", snap => {
    const order = snap.val();
    res.write(`event: order\ndata: ${JSON.stringify(order)}\n\n`);
  });

  req.on("close", () => ref.off("child_added", cb));
});

// ------------------ SET BALANCE AFTER APPROVE ------------------
app.post("/api/updateBalance", async (req, res) => {
  try {
    const { uid, amount } = req.body;
    await rtdb.ref(`wallets/${uid}/balance`).set(amount);
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.json({ ok: false });
  }
});

// ------------------ SERVER ------------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});
