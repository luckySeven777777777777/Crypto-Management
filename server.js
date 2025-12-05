// server.js — FINAL FIXED (use with package.json that includes dotenv, axios, firebase-admin, express, cors)
require("dotenv").config();

const express = require("express");
const path = require("path");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Use PORT from environment (Railway sets this)
const PORT = process.env.PORT || 8080;

// Admin credentials (env or fallback)
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "123456";

// Firebase init (guarded — don't crash process if env missing)
let db = null;
try {
  const admin = require("firebase-admin");
  if (!process.env.FIREBASE_SERVICE_ACCOUNT || !process.env.FIREBASE_DATABASE_URL) {
    console.warn("Warning: FIREBASE_SERVICE_ACCOUNT or FIREBASE_DATABASE_URL not set. Firebase disabled.");
  } else {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    db = admin.database();
    console.log("Firebase initialized.");
  }
} catch (err) {
  console.warn("Firebase init error (continuing without Firebase):", err.message);
}

// Utils
function now() { return Date.now(); }
function usTime(ts) {
  try {
    return new Date(ts).toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour12: true,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).replace(",", "");
  } catch (e) { return new Date(ts).toString(); }
}
function genOrderId(prefix) {
  const d = new Date();
  const y = d.getFullYear();
  const m = ("0" + (d.getMonth() + 1)).slice(-2);
  const day = ("0" + d.getDate()).slice(-2);
  const r = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${y}${m}${day}-${r}`;
}

// Telegram bot config from env
const TG = {
  recharge: {
    token: process.env.RECHARGE_BOT_TOKEN,
    user: process.env.RECHARGE_USER_CHAT_ID,
    group: process.env.RECHARGE_GROUP_CHAT_ID
  },
  withdraw: {
    token: process.env.WITHDRAW_BOT_TOKEN,
    user: process.env.WITHDRAW_USER_CHAT_ID,
    group: process.env.WITHDRAW_GROUP_CHAT_ID
  },
  trade: {
    token: process.env.TRADE_BOT_TOKEN,
    user: process.env.TRADE_USER_CHAT_ID,
    group: process.env.TRADE_GROUP_CHAT_ID
  }
};

// Safe Telegram sender using axios — quietly ignores failures
async function sendTG(bot, text) {
  if (!bot || !bot.token) return;
  const url = `https://api.telegram.org/bot${bot.token}/sendMessage`;
  const payload = { parse_mode: "Markdown", text: text };

  try {
    if (bot.user) {
      await axios.post(url, { ...payload, chat_id: bot.user }).catch(()=>{});
    }
  } catch (e) { console.warn("tg user send error", e.message); }

  try {
    if (bot.group) {
      await axios.post(url, { ...payload, chat_id: bot.group }).catch(()=>{});
    }
  } catch (e) { console.warn("tg group send error", e.message); }
}

// --- Helper: write to firebase (safe) ---
async function firebaseSet(path, value) {
  if (!db) {
    console.warn("Firebase not initialized; skipping write to", path);
    return;
  }
  try {
    await db.ref(path).set(value);
  } catch (e) {
    console.error("Firebase write error:", e.message);
  }
}

async function firebaseGet(path) {
  if (!db) {
    return null;
  }
  try {
    const snap = await db.ref(path).once("value");
    return snap.val();
  } catch (e) {
    console.error("Firebase read error:", e.message);
    return null;
  }
}

// ================== API ROUTES ==================

// Serve static frontend from /public
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// Health
app.get("/", (_req, res) => res.send("NEXBIT Backend Running"));

// Compatibility balance route (some frontends call /api/balance)
app.get("/api/balance", async (req, res) => {
  try {
    // allow userid via query or header
    const userid = req.query.userid || req.headers["x-user-id"] || req.headers["x-userid"];
    if (!userid) return res.status(400).json({ ok:false, error:"userid required" });

    if (!db) return res.json({ ok:true, balance: 0 });

    const snap = await db.ref("users/" + userid + "/balance").once("value");
    return res.json({ ok: true, balance: snap.val() || 0 });
  } catch (e) {
    console.error("GET /api/balance error", e.message);
    return res.status(500).json({ ok:false, error:"server error" });
  }
});

// Legacy named balance endpoint used in some pages
app.get("/api/user/balance", async (req, res) => {
  try {
    const userid = req.query.userid || req.headers["x-user-id"] || req.headers["x-userid"];
    if (!userid) return res.status(400).json({ ok:false, error:"userid required" });
    if (!db) return res.json({ ok:true, balance: 0 });
    const snap = await db.ref("users/" + userid + "/balance").once("value");
    return res.json({ ok: true, balance: snap.val() || 0 });
  } catch (e) {
    console.error("GET /api/user/balance error", e.message);
    return res.status(500).json({ ok:false, error:"server error" });
  }
});

// --- Recharge
app.post("/api/order/recharge", async (req, res) => {
  try {
    const data = req.body || {};
    const ts = now();
    const orderId = data.orderId || genOrderId("RCH");
    const payload = { ...data, orderId, timestamp: ts, time_us: usTime(ts), status: "pending" };

    await firebaseSet(`orders/recharge/${orderId}`, payload);

    // Notify telegram
    await sendTG(TG.recharge,
`💰 *New Recharge*
User: ${data.userid || "-"}
Order: \`${orderId}\`
Amount: *${data.amount || "-"}* ${data.coin || ""}
Wallet: ${data.wallet || "-"}
Time (US): *${payload.time_us}*`
    );

    return res.json({ ok: true, orderId });
  } catch (e) {
    console.error("POST /api/order/recharge error:", e.message);
    return res.status(500).json({ ok:false, error:"server error" });
  }
});

// --- Withdraw
app.post("/api/order/withdraw", async (req, res) => {
  try {
    const data = req.body || {};
    const ts = now();
    const orderId = data.orderId || genOrderId("WDL");
    const payload = { ...data, orderId, timestamp: ts, time_us: usTime(ts), status: "pending" };

    await firebaseSet(`orders/withdraw/${orderId}`, payload);

    await sendTG(TG.withdraw,
`🏧 *New Withdrawal*
User: ${data.userid || "-"}
Order: \`${orderId}\`
Amount: *${data.amount || "-"}* ${data.coin || ""}
Wallet: ${data.wallet || "-"}
Hash: ${data.hash || "-"}
Time (US): *${payload.time_us}*`
    );

    return res.json({ ok: true, orderId });
  } catch (e) {
    console.error("POST /api/order/withdraw error:", e.message);
    return res.status(500).json({ ok:false, error:"server error" });
  }
});

// --- BuySell
app.post("/api/order/buysell", async (req, res) => {
  try {
    const data = req.body || {};
    const ts = now();
    const orderId = data.orderId || genOrderId("BS");
    const payload = { ...data, orderId, timestamp: ts, time_us: usTime(ts), status: "pending" };

    await firebaseSet(`orders/buysell/${orderId}`, payload);

    await sendTG(TG.trade,
`📊 *BuySell Order*
User: ${data.userid || "-"}
Order: \`${orderId}\`

Type: *${data.tradeType || data.type || "-"}*
Amount: *${data.amount || "-"}* ${data.amountCurrency || data.coin || "-"}

Coin: *${data.coin || "-"}*
TP: *${data.tp || "None"}*
SL: *${data.sl || "None"}*

Time (US): *${payload.time_us}*`
    );

    return res.json({ ok: true, orderId });
  } catch (e) {
    console.error("POST /api/order/buysell error:", e.message);
    return res.status(500).json({ ok:false, error:"server error" });
  }
});

// Lists
app.get("/api/order/recharge/list", async (req, res) => {
  try {
    const val = (await firebaseGet("orders/recharge")) || {};
    return res.json(val);
  } catch (e) { return res.status(500).json({ error: "server error" }); }
});
app.get("/api/order/withdraw/list", async (req, res) => {
  try {
    const val = (await firebaseGet("orders/withdraw")) || {};
    return res.json(val);
  } catch (e) { return res.status(500).json({ error: "server error" }); }
});
app.get("/api/order/buysell/list", async (req, res) => {
  try {
    const val = (await firebaseGet("orders/buysell")) || {};
    return res.json(val);
  } catch (e) { return res.status(500).json({ error: "server error" }); }
});

// Admin login
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ ok: true, token: "admin-ok" });
  }
  return res.status(403).json({ error: "Invalid admin credentials" });
});

// list users
app.get("/api/admin/list-users", async (req, res) => {
  try {
    const users = (await firebaseGet("users")) || {};
    const list = Object.keys(users).map(uid => ({
      userid: uid,
      balance: users[uid].balance || 0,
      created: users[uid].created || "",
      updated: users[uid].updated || ""
    }));
    return res.json({ ok: true, users: list });
  } catch (e) { console.error(e.message); return res.status(500).json({ error: "server error" }); }
});

// Generic update + notify helper
async function updateOrderAndNotify(path, orderId, newStatus, tgBot) {
  if (!db) throw new Error("Firebase not initialized");
  const refPath = `${path}/${orderId}`;
  const snap = await db.ref(refPath).once("value");
  if (!snap.exists()) throw new Error("Order not found");
  const order = snap.val();
  await db.ref(refPath).update({ status: newStatus });
  await sendTG(tgBot,
`⚠️ *Order Status Updated*
Order: \`${orderId}\`
User: ${order.userid || "-"}
Status: *${newStatus.toUpperCase()}*
Time (US): ${usTime(now())}
`);
  return true;
}

// Admin actions: support both specific endpoints and generic action route used by some frontends
app.post("/api/admin/order/confirm", async (req, res) => {
  try {
    const { type, orderId } = req.body;
    const tgType = type === "recharge" ? TG.recharge : type === "withdraw" ? TG.withdraw : TG.trade;
    await updateOrderAndNotify(`orders/${type}`, orderId, "confirmed", tgType);
    res.json({ ok: true });
  } catch (e) { console.error(e.message); res.status(500).json({ error: e.message || "server error" }); }
});
app.post("/api/admin/order/cancel", async (req, res) => {
  try { const { type, orderId } = req.body;
    const tgType = type === "recharge" ? TG.recharge : type === "withdraw" ? TG.withdraw : TG.trade;
    await updateOrderAndNotify(`orders/${type}`, orderId, "cancelled", tgType);
    res.json({ ok: true });
  } catch (e) { console.error(e.message); res.status(500).json({ error: e.message || "server error" }); }
});
app.post("/api/admin/order/lock", async (req, res) => {
  try { const { type, orderId } = req.body;
    const tgType = type === "recharge" ? TG.recharge : type === "withdraw" ? TG.withdraw : TG.trade;
    await updateOrderAndNotify(`orders/${type}`, orderId, "locked", tgType);
    res.json({ ok: true });
  } catch (e) { console.error(e.message); res.status(500).json({ error: e.message || "server error" }); }
});
app.post("/api/admin/order/unlock", async (req, res) => {
  try { const { type, orderId } = req.body;
    const tgType = type === "recharge" ? TG.recharge : type === "withdraw" ? TG.withdraw : TG.trade;
    await updateOrderAndNotify(`orders/${type}`, orderId, "unlocked", tgType);
    res.json({ ok: true });
  } catch (e) { console.error(e.message); res.status(500).json({ error: e.message || "server error" }); }
});

// Generic action endpoint (frontends may call /api/admin/order/action)
app.post("/api/admin/order/action", async (req, res) => {
  try {
    const { type, orderId, action } = req.body;
    if (!type || !orderId || !action) return res.status(400).json({ error: "missing params" });
    const tgType = type === "recharge" ? TG.recharge : type === "withdraw" ? TG.withdraw : TG.trade;
    const map = { confirm: "confirmed", cancel: "cancelled", lock: "locked", unlock: "unlocked" };
    const status = map[action] || action;
    await updateOrderAndNotify(`orders/${type}`, orderId, status, tgType);
    res.json({ ok: true });
  } catch (e) { console.error(e.message); res.status(500).json({ error: e.message || "server error" }); }
}
}); 
// Strikingly user sync
app.post("/api/users/sync", async (req, res) => {
  try {
    const { userid } = req.body || {};
    if (!userid) return res.json({ ok: false });
    const ts = now();
    if (!db) return res.json({ ok: false });
    const ref = db.ref("users/" + userid);
    await ref.update({
      userid,
      updated: usTime(ts),
      created: (await ref.child("created").once("value")).val() || usTime(ts),
      balance: (await ref.child("balance").once("value")).val() || 0
    });
    return res.json({ ok: true });
  } catch (err) { console.error("sync error:", err.message); return res.json({ ok: false }); }
});

// Update balance (admin or internal)
app.post("/api/user/balance/update", async (req, res) => {
  try {
    const { userid, balance } = req.body || {};
    if (!userid) return res.status(400).json({ error: "userid required" });
    if (!db) return res.status(500).json({ error: "firebase not initialized" });
    await db.ref("users/" + userid).update({ balance });
    res.json({ ok: true });
  } catch (e) { console.error(e.message); res.status(500).json({ error: "server error" }); }
});

// Admin aggregated orders
app.get("/api/admin/orders", async (req, res) => {
  try {
    const recharge = (await firebaseGet("orders/recharge")) || {};
    const withdraw = (await firebaseGet("orders/withdraw")) || {};
    const buysell = (await firebaseGet("orders/buysell")) || {};
    res.json({ ok: true, recharge, withdraw, buysell });
  } catch (e) { console.error(e.message); res.status(500).json({ error: "server error" }); }
});

// Error handler
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err && err.stack ? err.stack : err);
  res.status(500).json({ error: "Internal server error" });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 NEXBIT backend running on port ${PORT}`);
  console.log("Serving static files from:", publicDir);
});
