// ======================================================
// NEXBIT FINAL STRUCTURED SERVER.JS
// (Strikingly + Dashboard + Firebase + Telegram ready)
// ======================================================

require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 8080;

// ---------------- CORS ----------------
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-user-id", "x-userid", "Authorization"]
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------------- Admin ----------------
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "123456";

// ---------------- Firebase ----------------
let db = null;
try {
  const admin = require("firebase-admin");
  if (process.env.FIREBASE_SERVICE_ACCOUNT && process.env.FIREBASE_DATABASE_URL) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    db = admin.database();
    console.log("✅ Firebase connected");
  } else {
    console.warn("⚠️ Firebase ENV missing");
  }
} catch (e) {
  console.warn("❌ Firebase init failed:", e.message);
}

// ---------------- Helper ----------------
function now() { return Date.now(); }
function usTime(ts) {
  return new Date(ts).toLocaleString("en-US", { timeZone: "America/New_York" });
}
function genOrderId(prefix) {
  return `${prefix}-${now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

// ======================================================
// 💰 BALANCE UPDATE HELPER
// ======================================================
async function updateBalance(userId, amountChange) {
  if (!db) return false;

  const ref = db.ref(`users/${userId}/balance`);
  const snap = await ref.once("value");
  const current = snap.val() || 0;

  const newBalance = current + amountChange;

  // 防止负数
  if (newBalance < 0) return false;

  await ref.set(newBalance);
  return true;
}

// ---------------- Telegram ----------------
async function sendTG(bot, text) {
  if (!bot || !bot.token) return;
  const url = `https://api.telegram.org/bot${bot.token}/sendMessage`;
  const payload = { parse_mode: "Markdown", text };
  try {
    if (bot.user) await axios.post(url, { ...payload, chat_id: bot.user });
    if (bot.group) await axios.post(url, { ...payload, chat_id: bot.group });
  } catch {}
}

const TG = {
  recharge: { token: process.env.RECHARGE_BOT_TOKEN, user: process.env.RECHARGE_USER_CHAT_ID, group: process.env.RECHARGE_GROUP_CHAT_ID },
  withdraw: { token: process.env.WITHDRAW_BOT_TOKEN, user: process.env.WITHDRAW_USER_CHAT_ID, group: process.env.WITHDRAW_GROUP_CHAT_ID },
  trade:    { token: process.env.TRADE_BOT_TOKEN,    user: process.env.TRADE_USER_CHAT_ID,    group: process.env.TRADE_GROUP_CHAT_ID }
};

// ---------------- Static ----------------
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_, res) => res.send("✅ NEXBIT Backend Running"));

// ======================================================
// ✅ STRIKINGLY - USER SYNC
// ======================================================
app.post("/api/users/sync", async (req, res) => {
  try {
    const { userid, userId } = req.body;
    const uid = userid || userId;
    if (!uid) return res.json({ ok:false });

    const ts = usTime(now());

    if (!db) {
      return res.json({ ok:true });
    }

    const ref = db.ref("users/" + uid);
    const created = (await ref.child("created").once("value")).val() || ts;
    const balance = (await ref.child("balance").once("value")).val() || 0;

    await ref.update({
      userid: uid,
      created,
      updated: ts,
      balance
    });

    res.json({ ok:true });
  } catch (e) {
    res.json({ ok:false });
  }
});

// ======================================================
// ✅ GET BALANCE (RESTful: /api/balance/:userid)
// ======================================================
app.get("/api/balance/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;
    if (!uid) return res.json({ ok:true, balance: 0 });

    if (!db) return res.json({ ok:true, balance: 0 });

    const snap = await db.ref(`users/${uid}/balance`).once("value");
    res.json({ ok:true, balance: snap.val() || 0 });
  } catch {
    res.json({ ok:true, balance: 0 });
  }
});


// ======================================================
// ✅ ORDERS API
// ======================================================
async function saveOrder(type, data) {
  if (!db) return null;
  const ts = now();
  const id = data.orderId || genOrderId(type.toUpperCase());
  const payload = { ...data, orderId: id, timestamp: ts, time_us: usTime(ts), status: "pending" };
  await db.ref(`orders/${type}/${id}`).set(payload);
  return id;
}

// --- 手动充值 ---
app.post("/api/order/recharge", async (req, res) => {
  const { userId, amount } = req.body;
  const id = await saveOrder("recharge", { userId, amount });
  if (!id) return res.json({ ok: true, orderId: "local-" + now() });

  // 自动加钱
  await updateBalance(userId, Number(amount));

  res.json({ ok: true, orderId: id });

  const text = `New Recharge Order\nUserID: ${userId}\nAmount: ${amount}\nOrderID: ${id}`;
  await sendTG(TG.recharge, text);
});


// --- 手动扣款 ---
app.post("/api/order/withdraw", async (req, res) => {
  const { userId, amount } = req.body;
  const id = await saveOrder("withdraw", { userId, amount });
  if (!id) return res.json({ ok: true, orderId: "local-" + now() });

  // 自动扣钱
  const success = await updateBalance(userId, -Number(amount));
  if (!success) return res.json({ ok: false, msg: "Insufficient balance" });

  res.json({ ok: true, orderId: id });

  const text = `New Withdraw Order\nUserID: ${userId}\nAmount: ${amount}\nOrderID: ${id}`;
  await sendTG(TG.withdraw, text);
});


// --- 手动买卖 ---
app.post("/api/order/buysell", async (req, res) => {
  const { userId, amount, action } = req.body;
  const id = await saveOrder("buysell", { userId, amount, action });
  if (!id) return res.json({ ok: true, orderId: id });
  res.json({ ok: true, orderId: id });

  // 发送到 Telegram
  const text = `New Buy/Sell Order\nUserID: ${userId}\nAmount: ${amount}\nAction: ${action}\nOrderID: ${id}`;
  await sendTG(TG.trade, text);
});

// ======================================================
// ✅ DASHBOARD - TRANSACTIONS
// ======================================================
app.get("/api/transactions", async (req, res) => {
  try {
    if (!db) {
      return res.json({
        ok: true,
        recharge: {},
        withdraw: {},
        buysell: {},
        users: {},
        stats: { todayRecharge: 0, todayWithdraw: 0, todayOrders: 0, alerts: 0 }
      });
    }

    const recharge = (await db.ref("orders/recharge").once("value")).val() || {};
    const withdraw = (await db.ref("orders/withdraw").once("value")).val() || {};
    const buysell = (await db.ref("orders/buysell").once("value")).val() || {};
    const users = (await db.ref("users").once("value")).val() || {};

    res.json({
      ok: true,
      recharge,
      withdraw,
      buysell,
      users,
      stats: {
        todayRecharge: Object.keys(recharge).length,
        todayWithdraw: Object.keys(withdraw).length,
        todayOrders: (
          Object.keys(recharge).length +
          Object.keys(withdraw).length +
          Object.keys(buysell).length
        ),
        alerts: 0
      }
    });
  } catch {
    res.json({ ok: false });
  }
});

// ======================================================
// ✅ DASHBOARD - UPDATE ORDER STATUS
// ======================================================
app.post("/api/transaction/update", async (req, res) => {
  try {
    const { orderId, action } = req.body;
    if (!db) return res.json({ ok: true });

    const map = {
      confirm: "confirmed",
      cancel: "cancelled",
      lock: "locked",
      unlock: "unlocked"
    };

    const status = map[action] || action;

    const paths = ["recharge", "withdraw", "buysell"];
    let orderData = null;
    let orderType = null;

    // 找到订单
    for (const p of paths) {
      const ref = db.ref(`orders/${p}/${orderId}`);
      const snap = await ref.once("value");
      if (snap.exists()) {
        orderData = snap.val();
        orderType = p;
        await ref.update({ status });
        break;
      }
    }

    // 如果是确认订单 → 更新余额
    if (status === "confirmed" && orderData) {
      const { userId, amount } = orderData;

      if (orderType === "recharge") {
        await updateBalance(userId, Number(amount));
      }

      if (orderType === "withdraw") {
        await updateBalance(userId, -Number(amount));
      }
    }

    res.json({ ok: true });
  } catch {
    res.json({ ok: false });
  }
});


// ======================================================
app.listen(PORT, () => console.log("🚀 Server running on", PORT));
