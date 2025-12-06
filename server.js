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
// ✅ GET BALANCE
// ======================================================
app.get("/api/balance", async (req, res) => {
  try {
    const uid = req.query.userid || req.headers["x-user-id"] || req.headers["x-userid"];
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

app.post("/api/order/recharge", async (req,res)=>{
  const id = await saveOrder("recharge", req.body);
  if(!id) return res.json({ ok:true, orderId:"local-"+now() });
  res.json({ ok:true, orderId:id });
});

app.post("/api/order/withdraw", async (req,res)=>{
  const id = await saveOrder("withdraw", req.body);
  if(!id) return res.json({ ok:true, orderId:"local-"+now() });
  res.json({ ok:true, orderId:id });
});

app.post("/api/order/buysell", async (req,res)=>{
  const id = await saveOrder("buysell", req.body);
  if(!id) return res.json({ ok:true, orderId:id });
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
        stats: { todayRecharge:0, todayWithdraw:0, todayOrders:0, alerts:0 }
      });
    }

    const recharge = (await db.ref("orders/recharge").once("value")).val() || {};
    const withdraw = (await db.ref("orders/withdraw").once("value")).val() || {};
    const buysell  = (await db.ref("orders/buysell").once("value")).val() || {};
    const users    = (await db.ref("users").once("value")).val() || {};

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
    res.json({ ok:false });
  }
});

// ======================================================
// ✅ DASHBOARD - UPDATE ORDER STATUS
// ======================================================
app.post("/api/transaction/update", async (req, res) => {
  try {
    const { orderId, action } = req.body;
    if (!db) return res.json({ ok:true });

    const map = {
      confirm:"confirmed",
      cancel:"cancelled",
      lock:"locked",
      unlock:"unlocked"
    };

    const status = map[action] || action;

    const paths = ["recharge", "withdraw", "buysell"];

    for (const p of paths) {
      const ref = db.ref(`orders/${p}/${orderId}`);
      const snap = await ref.once("value");
      if (snap.exists()) {
        await ref.update({ status });
        break;
      }
    }

    res.json({ ok:true });
  } catch {
    res.json({ ok:false });
  }
});

// ======================================================
app.listen(PORT, () => console.log("🚀 Server running on", PORT));
