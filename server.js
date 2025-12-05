// server.js — NEXBIT FINAL COMPLETE VERSION (with /api/transactions FIX)
require("dotenv").config();

const express = require("express");
const path = require("path");
const cors = require("cors");
const axios = require("axios");

const app = express();

// ===== ENABLE GLOBAL CORS =====
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "x-user-id", "x-userid"]
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8080;

// Admin login
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "123456";

// ========== Firebase Init ==========
let db = null;
try {
  const admin = require("firebase-admin");
  if (!process.env.FIREBASE_SERVICE_ACCOUNT || !process.env.FIREBASE_DATABASE_URL) {
    console.warn("⚠️ FIREBASE_SERVICE_ACCOUNT or FIREBASE_DATABASE_URL missing");
  } else {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    db = admin.database();
    console.log("✅ Firebase initialized");
  }
} catch (err) {
  console.warn("❌ Firebase init error:", err.message);
}

// Helper
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
  } catch {
    return new Date(ts).toString();
  }
}
function genOrderId(prefix) {
  const d = new Date();
  return `${prefix}-${d.getFullYear()}${("0"+(d.getMonth()+1)).slice(-2)}${("0"+d.getDate()).slice(-2)}-${Math.floor(100000+Math.random()*900000)}`;
}

// Telegram configs
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

async function sendTG(bot, text) {
  if (!bot || !bot.token) return;
  const url = `https://api.telegram.org/bot${bot.token}/sendMessage`;
  const payload = { parse_mode: "Markdown", text };

  try {
    if (bot.user) await axios.post(url, { ...payload, chat_id: bot.user }).catch(()=>{});
    if (bot.group) await axios.post(url, { ...payload, chat_id: bot.group }).catch(()=>{});
  } catch {}
}

async function firebaseSet(path, val) {
  if (!db) return;
  try { await db.ref(path).set(val); } catch (e) {}
}
async function firebaseGet(path) {
  if (!db) return null;
  try { return (await db.ref(path).once("value")).val(); }
  catch { return null; }
}

// ========= Static Frontend ===========
app.use(express.static(path.join(__dirname, "public")));
console.log("📂 Serving static files from:", path.join(__dirname, "public"));

app.get("/", (_req, res) => res.send("NEXBIT Backend Running"));

// ========= STRIKINGLY BALANCE API ==========
app.get("/api/balance", async (req, res) => {
  try {
    const userid = req.query.userid || req.headers["x-user-id"] || req.headers["x-userid"];
    if (!userid) return res.status(400).json({ ok:false, error:"userid required" });

    if (!db) return res.json({ ok:true, balance:0 });
    const snap = await db.ref(`users/${userid}/balance`).once("value");
    res.json({ ok:true, balance: snap.val() || 0 });
  } catch (e) {
    res.status(500).json({ ok:false });
  }
});

// Duplicate
app.get("/api/user/balance", async (req, res) => {
  try {
    const userid = req.query.userid || req.headers["x-user-id"] || req.headers["x-userid"];
    if (!userid) return res.status(400).json({ ok:false });

    const snap = await db.ref(`users/${userid}/balance`).once("value");
    res.json({ ok:true, balance: snap.val() || 0 });
  } catch {
    res.status(500).json({ ok:false });
  }
});

// ========== RECHARGE ==========
app.post("/api/order/recharge", async (req, res) => {
  try {
    const data = req.body;
    const ts = now();
    const orderId = data.orderId || genOrderId("RCH");

    const payload = { ...data, orderId, timestamp: ts, time_us: usTime(ts), status:"pending" };
    await firebaseSet(`orders/recharge/${orderId}`, payload);

    await sendTG(TG.recharge,
`💰 *New Recharge*
User: ${data.userid}
Order: \`${orderId}\`
Amount: *${data.amount}* ${data.coin}
Wallet: ${data.wallet}
Time (US): *${payload.time_us}*`);

    res.json({ ok:true, orderId });
  } catch {
    res.status(500).json({ ok:false });
  }
});

// ========== WITHDRAW ==========
app.post("/api/order/withdraw", async (req, res) => {
  try {
    const data = req.body;
    const ts = now();
    const orderId = data.orderId || genOrderId("WDL");

    const payload = { ...data, orderId, timestamp: ts, time_us: usTime(ts), status:"pending" };
    await firebaseSet(`orders/withdraw/${orderId}`, payload);

    await sendTG(TG.withdraw,
`🏧 *New Withdrawal*
User: ${data.userid}
Order: \`${orderId}\`
Amount: *${data.amount}* ${data.coin}
Wallet: ${data.wallet}
Hash: ${data.hash}
Time (US): *${payload.time_us}*`);

    res.json({ ok:true, orderId });
  } catch {
    res.status(500).json({ ok:false });
  }
});

// ========== BUYSELL ==========
app.post("/api/order/buysell", async (req, res) => {
  try {
    const data = req.body;
    const ts = now();
    const orderId = data.orderId || genOrderId("BS");

    const payload = { ...data, orderId, timestamp: ts, time_us: usTime(ts), status:"pending" };
    await firebaseSet(`orders/buysell/${orderId}`, payload);

    await sendTG(TG.trade,
`📊 *Buy/Sell Order*
User: ${data.userid}
Order: \`${orderId}\`
Type: *${data.tradeType}*
Amount: *${data.amount}*
Coin: *${data.coin}*
TP: ${data.tp}
SL: ${data.sl}
Time (US): *${payload.time_us}*`);

    res.json({ ok:true, orderId });
  } catch {
    res.status(500).json({ ok:false });
  }
});

// ===== LIST endpoints =====
app.get("/api/order/recharge/list", async (_, res) =>
  res.json(await firebaseGet("orders/recharge") || {})
);
app.get("/api/order/withdraw/list", async (_, res) =>
  res.json(await firebaseGet("orders/withdraw") || {})
);
app.get("/api/order/buysell/list", async (_, res) =>
  res.json(await firebaseGet("orders/buysell") || {})
);

// ========== ADMIN LOGIN ==========
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS)
    return res.json({ ok:true, token:"admin-ok" });
  res.status(403).json({ error:"Invalid admin credentials" });
});

// ========== ADMIN LIST USERS ==========
app.get("/api/admin/list-users", async (_, res) => {
  try {
    const users = await firebaseGet("users") || {};
    const list = Object.keys(users).map(u => ({
      userid: u,
      balance: users[u].balance || 0,
      created: users[u].created || "",
      updated: users[u].updated || ""
    }));
    res.json({ ok:true, users:list });
  } catch {
    res.status(500).json({ error:"server error" });
  }
});

// ====== ADMIN ORDER ACTIONS ======
async function updateOrder(path, orderId, newStatus, notifyBot) {
  const snap = await db.ref(path + "/" + orderId).once("value");
  if (!snap.exists()) throw new Error("Order not found");

  await db.ref(path + "/" + orderId).update({ status:newStatus });

  await sendTG(notifyBot,
`⚠️ *Order Status Updated*
Order: \`${orderId}\`
Status: *${newStatus.toUpperCase()}*
Time (US): ${usTime(now())}`);
}

app.post("/api/admin/order/action", async (req, res) => {
  try {
    const { type, orderId, action } = req.body;
    const map = { confirm:"confirmed", cancel:"cancelled", lock:"locked", unlock:"unlocked" };
    const status = map[action];

    const bot = type === "recharge" ? TG.recharge :
                type === "withdraw" ? TG.withdraw : TG.trade;

    await updateOrder(`orders/${type}`, orderId, status, bot);
    res.json({ ok:true });
  } catch (e) {
    res.status(500).json({ error:e.message });
  }
});

// ===== STRIKINGLY USER SYNC =====
app.post("/api/users/sync", async (req, res) => {
  try {
    const { userid } = req.body;
    if (!userid) return res.json({ ok:false });

    const ts = usTime(now());
    const ref = db.ref("users/" + userid);

    await ref.update({
      userid,
      updated: ts,
      created: (await ref.child("created").once("value")).val() || ts,
      balance: (await ref.child("balance").once("value")).val() || 0
    });

    res.json({ ok:true });
  } catch {
    res.json({ ok:false });
  }
});

// ===== UPDATE BALANCE =====
app.post("/api/user/balance/update", async (req, res) => {
  try {
    const { userid, balance } = req.body;
    await db.ref("users/" + userid).update({ balance });
    res.json({ ok:true });
  } catch {
    res.status(500).json({ error:"server error" });
  }
});

// ====== ADMIN AGGREGATED ORDERS ======
app.get("/api/admin/orders", async (_, res) => {
  res.json({
    ok:true,
    recharge: await firebaseGet("orders/recharge") || {},
    withdraw: await firebaseGet("orders/withdraw") || {},
    buysell: await firebaseGet("orders/buysell") || {}
  });
});


// =====================================================
// 🚀 SUPER IMPORTANT FIX — /api/transactions ENDPOINT
// =====================================================
app.get("/api/transactions", async (req, res) => {
  try {
    const recharge = await firebaseGet("orders/recharge") || {};
    const withdraw = await firebaseGet("orders/withdraw") || {};
    const buysell  = await firebaseGet("orders/buysell") || {};

    const list = [
      ...Object.values(recharge).map(r => ({ ...r, type:"recharge" })),
      ...Object.values(withdraw).map(w => ({ ...w, type:"withdraw" })),
      ...Object.values(buysell).map(b => ({ ...b, type:"buysell" }))
    ];

    list.sort((a, b) => b.timestamp - a.timestamp);

    res.json({ ok:true, list });

  } catch (e) {
    console.error("transactions error:", e);
    res.status(500).json({ ok:false, error:"server error" });
  }
});


// ====== Global Error Handler ======
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);
  res.status(500).json({ error:"Internal server error" });
});

// ====== Start Server ======
app.listen(PORT, () => {
  console.log(`🚀 NEXBIT backend running on port ${PORT}`);
});
