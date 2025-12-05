// final_server.js
// ==========================
//  NEXBIT - Unified Paths Server
//  transactions/, userList/, balances/
//  Deploy this file to Railway (overwrite server.js)
// ==========================

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const path = require("path");
require("dotenv").config();

// If your Node doesn't include global fetch, uncomment the next line and install node-fetch:
// const fetch = (...args) => import('node-fetch').then(({default:fetch})=>fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files from /public
app.use(express.static(path.join(__dirname, "public")));

// Firebase init
if (!process.env.FIREBASE_SERVICE_ACCOUNT || !process.env.FIREBASE_DATABASE_URL) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT or FIREBASE_DATABASE_URL in env!");
  // don't exit to allow dev, but logs will show error
}

const serviceAccount = (() => {
  try {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  } catch (e) {
    console.error("Invalid FIREBASE_SERVICE_ACCOUNT JSON:", e);
    return {};
  }
})();

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}
const db = admin.database();

// Helper
function generateOrderId(prefix = "TX") {
  return `${prefix}-${Math.random().toString(36).slice(2,10).toUpperCase()}`;
}
function getUserId(req) {
  // priority: header X-User-Id -> body.userid -> query.userid -> "guest"
  return (req.headers["x-user-id"] || req.body.userid || req.query.userid || "guest").toString();
}

// Telegram send helper
async function sendToTelegram(type, text) {
  try {
    let token = "";
    let groupId = "";
    let userId = "";

    if (type === "recharge") {
      token = process.env.RECHARGE_BOT_TOKEN;
      groupId = process.env.RECHARGE_GROUP_CHAT_ID;
      userId = process.env.RECHARGE_USER_CHAT_ID;
    } else if (type === "withdraw") {
      token = process.env.WITHDRAW_BOT_TOKEN;
      groupId = process.env.WITHDRAW_GROUP_CHAT_ID;
      userId = process.env.WITHDRAW_USER_CHAT_ID;
    } else if (type === "trade") {
      token = process.env.TRADE_BOT_TOKEN;
      groupId = process.env.TRADE_GROUP_CHAT_ID;
      userId = process.env.TRADE_USER_CHAT_ID;
    }

    if (!token || !groupId) {
      // missing config; just return
      console.log("Telegram config missing for", type);
      return;
    }

    const payload = (chat_id) => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, text, parse_mode: "Markdown" })
    });

    // send to group
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, payload(groupId));
    // send to admin (if provided)
    if (userId) await fetch(`https://api.telegram.org/bot${token}/sendMessage`, payload(userId));
  } catch (err) {
    console.log("Telegram send error:", err);
  }
}

/* =========================
   API: user sync
   Writes user info into userList/{userid}
   ========================= */
app.post("/api/user/sync", async (req, res) => {
  try {
    const userid = getUserId(req);
    const userRef = db.ref(`userList/${userid}`);
    const now = Date.now();
    await userRef.update({
      userid,
      wallet: req.body.wallet || "",
      level: req.body.level || "normal",
      lastActive: now,
      balance: req.body.balance || 0
    });
    return res.json({ success: true, userid });
  } catch (e) {
    console.error("user/sync error:", e);
    return res.status(500).json({ success: false, error: "server error" });
  }
});

/* =========================
   Balance API (supports GET and POST)
   Writes/reads balances/{userid}
   ========================= */
// GET /api/balance?userid=1234   OR header X-User-Id
app.get("/api/balance", async (req, res) => {
  try {
    const userid = getUserId(req);
    const snap = await db.ref(`balances/${userid}`).once("value");
    const balance = snap.exists() ? snap.val() : 0;
    return res.json({ success: true, userid, balance });
  } catch (e) {
    console.error("GET /api/balance error", e);
    return res.status(500).json({ success: false, error: "server error" });
  }
});

// POST /api/balance  { userid? }  (for older frontends)
app.post("/api/balance", async (req, res) => {
  try {
    const userid = getUserId(req);
    const snap = await db.ref(`balances/${userid}`).once("value");
    const balance = snap.exists() ? snap.val() : 0;
    return res.json({ success: true, userid, balance });
  } catch (e) {
    console.error("POST /api/balance error", e);
    return res.status(500).json({ success: false, error: "server error" });
  }
});

/* =========================
   Orders: unified path -> transactions/{orderId}
   Each endpoint pushes a record to transactions/
   ========================= */

// Recharge
app.post("/api/order/recharge", async (req, res) => {
  try {
    const userid = getUserId(req);
    const { coin, amount, wallet } = req.body;
    const orderId = generateOrderId("RC");
    const data = { userid, coin, amount, wallet, orderId, type: "recharge", status: "processing", timestamp: Date.now() };

    await db.ref(`transactions/${orderId}`).set(data);
    // optionally create user record if not exists
    await db.ref(`userList/${userid}`).update({ userid, lastActive: Date.now() });

    // Telegram notify (non-blocking)
    sendToTelegram("recharge", `🔔 *充值申请*\n用户: ${userid}\n金额: ${amount} ${coin}\n订单号: ${orderId}\n地址: ${wallet}`);

    return res.json({ success: true, orderId });
  } catch (e) {
    console.error("/api/order/recharge error", e);
    return res.status(500).json({ success: false, error: "server error" });
  }
});

// Withdraw
app.post("/api/order/withdraw", async (req, res) => {
  try {
    const userid = getUserId(req);
    const { coin, amount, wallet, hash } = req.body;
    const orderId = generateOrderId("WD");
    const data = { userid, coin, amount, wallet, hash: hash || "", orderId, type: "withdraw", status: "processing", timestamp: Date.now() };

    await db.ref(`transactions/${orderId}`).set(data);
    await db.ref(`userList/${userid}`).update({ userid, lastActive: Date.now() });

    sendToTelegram("withdraw", `📤 *提款申请*\n用户: ${userid}\n金额: ${amount} ${coin}\n订单号: ${orderId}`);

    return res.json({ success: true, orderId });
  } catch (e) {
    console.error("/api/order/withdraw error", e);
    return res.status(500).json({ success: false, error: "server error" });
  }
});

// BuySell
app.post("/api/order/buysell", async (req, res) => {
  try {
    const userid = getUserId(req);
    const { coin, amount, side, amountCurrency, tp, sl } = req.body;
    const orderId = generateOrderId("TR");
    const data = { userid, coin, amount, side, amountCurrency: amountCurrency || "USDT", tp: tp || null, sl: sl || null, orderId, type: "trade", status: "processing", timestamp: Date.now() };

    await db.ref(`transactions/${orderId}`).set(data);
    await db.ref(`userList/${userid}`).update({ userid, lastActive: Date.now() });

    sendToTelegram("trade", `💱 *买卖订单*\n用户: ${userid}\n方向: ${side}\n金额: ${amount} ${coin}\n订单号: ${orderId}`);

    return res.json({ success: true, orderId });
  } catch (e) {
    console.error("/api/order/buysell error", e);
    return res.status(500).json({ success: false, error: "server error" });
  }
});

/* =========================
   Admin APIs (formal)
   ========================= */

app.get("/api/admin/users", async (req, res) => {
  try {
    const users = (await db.ref("userList").once("value")).val() || {};
    return res.json({ success: true, users });
  } catch (e) {
    console.error("/api/admin/users error", e);
    return res.status(500).json({ success: false, error: "server error" });
  }
});

app.get("/api/admin/transactions", async (req, res) => {
  try {
    const tx = (await db.ref("transactions").once("value")).val() || {};
    return res.json({ success: true, transactions: tx });
  } catch (e) {
    console.error("/api/admin/transactions error", e);
    return res.status(500).json({ success: false, error: "server error" });
  }
});

/* =========================
   Proxy (compat for older dashboard JS)
   ========================= */

app.get("/proxy/users", async (req, res) => {
  try {
    const users = (await db.ref("userList").once("value")).val() || {};
    return res.json({ success: true, users });
  } catch (e) {
    console.error("/proxy/users error", e);
    return res.status(500).json({ success: false, error: "server error" });
  }
});

app.get("/proxy/transactions", async (req, res) => {
  try {
    const tx = (await db.ref("transactions").once("value")).val() || {};
    return res.json({ success: true, transactions: tx });
  } catch (e) {
    console.error("/proxy/transactions error", e);
    return res.status(500).json({ success: false, error: "server error" });
  }
});

// settings endpoint used by dashboard
app.get("/api/settings", (req, res) => {
  res.json({ success: true });
});

// fallback serve index for SPA support (if needed)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard-brand.html"));
});

// run
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
