// ================== SERVER INIT ==================
const express = require("express");
const app = express();
const cors = require("cors");
const axios = require("axios");

require("dotenv").config();

app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8080;

// ================== ADMIN ACCOUNT ==================
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "123456";

// ================== FIREBASE ==================
const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();

// ================== UTILS ==================
function now() {
  return Date.now();
}

function usTime(ts) {
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour12: true,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).replace(",", "");
}

function genOrderId(prefix) {
  const d = new Date();
  const y = d.getFullYear();
  const m = ("0" + (d.getMonth() + 1)).slice(-2);
  const day = ("0" + d.getDate()).slice(-2);
  const r = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${y}${m}${day}-${r}`;
}

// ================== Telegram Bots ==================
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

// ====== Telegram Sender ======
async function sendTG(bot, text) {
  try {
    const url = `https://api.telegram.org/bot${bot.token}/sendMessage`;

    const payload = {
      parse_mode: "Markdown",
      text
    };

    // user
    await axios.post(url, { ...payload, chat_id: bot.user }).catch(() => {});

    // group
    await axios.post(url, { ...payload, chat_id: bot.group }).catch(() => {});
  } catch (e) {
    console.log("TG send error:", e.message);
  }
}

// ================== RECHARGE API ==================
app.post("/api/order/recharge", async (req, res) => {
  try {
    const data = req.body;
    const ts = now();

    const orderId = data.orderId || genOrderId("RCH");

    const payload = {
      ...data,
      orderId,
      timestamp: ts,
      time_us: usTime(ts),
      status: "pending"
    };

    // save to firebase
    await db.ref("orders/recharge/" + orderId).set(payload);

    // Telegram notify
    await sendTG(TG.recharge, 
`💰 *New Recharge*
User: ${data.userid}
Order: \`${orderId}\`
Amount: *${data.amount}* ${data.coin}
Wallet: ${data.wallet || "-"}
Time (US): *${payload.time_us}*
`);

    return res.json({ ok: true, orderId });
  } catch (e) {
    console.log("recharge error:", e);
    return res.status(500).json({ error: "server error" });
  }
});


// ================== WITHDRAW API ==================
app.post("/api/order/withdraw", async (req, res) => {
  try {
    const data = req.body;
    const ts = now();
    const orderId = data.orderId || genOrderId("WDL");

    const payload = {
      ...data,
      orderId,
      timestamp: ts,
      time_us: usTime(ts),
      status: "pending"
    };

    // save
    await db.ref("orders/withdraw/" + orderId).set(payload);

    // telegram notify
    await sendTG(TG.withdraw, 
`🏧 *New Withdrawal*
User: ${data.userid}
Order: \`${orderId}\`
Amount: *${data.amount}* ${data.coin}
Wallet: ${data.wallet || "-"}
Hash: ${data.hash || "-"}
Time (US): *${payload.time_us}*
`);

    return res.json({ ok: true, orderId });
  } catch (e) {
    console.log("withdraw error:", e);
    return res.status(500).json({ error: "server error" });
  }
});


// ================== BUYSELL API ==================
app.post("/api/order/buysell", async (req, res) => {
  try {
    const data = req.body;
    const ts = now();
    const orderId = data.orderId || genOrderId("BS");

    const payload = {
      ...data,
      orderId,
      timestamp: ts,
      time_us: usTime(ts),
      status: "pending"
    };

    // save
    await db.ref("orders/buysell/" + orderId).set(payload);

    // telegram notify
    await sendTG(TG.trade, 
`📊 *BuySell Order*
User: ${data.userid}
Order: \`${orderId}\`

Type: *${data.tradeType || data.type}*
Amount: *${data.amount}* ${data.amountCurrency || "-"}

Coin: *${data.coin}*
TP: *${data.tp || "None"}*
SL: *${data.sl || "None"}*

Time (US): *${payload.time_us}*
`);

    return res.json({ ok: true, orderId });
  } catch (e) {
    console.log("buysell error:", e);
    return res.status(500).json({ error: "server error" });
  }
});


// ================== RECHARGE LIST ==================
app.get("/api/order/recharge/list", async (req, res) => {
  const snap = await db.ref("orders/recharge").once("value");
  res.json(snap.val() || []);
});

// ================== WITHDRAW LIST ==================
app.get("/api/order/withdraw/list", async (req, res) => {
  const snap = await db.ref("orders/withdraw").once("value");
  res.json(snap.val() || []);
});

// ================== BUYSELL LIST ==================
app.get("/api/order/buysell/list", async (req, res) => {
  const snap = await db.ref("orders/buysell").once("value");
  res.json(snap.val() || []);
});

// ================== BUYSELL API END ==================
// ================== ADMIN LOGIN ==================
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ ok: true, token: "admin-ok" });
  }
  return res.status(403).json({ error: "Invalid admin credentials" });
});


// ================== LIST USERS ==================
app.get("/api/admin/list-users", async (req, res) => {
  try {
    const snap = await db.ref("users").once("value");
    const users = snap.val() || {};

    const list = Object.keys(users).map(uid => ({
      userid: uid,
      balance: users[uid].balance || 0,
      created: users[uid].created || "",
      updated: users[uid].updated || ""
    }));

    return res.json({ ok: true, users: list });
  } catch (err) {
    console.error("list-users error:", err);
    res.status(500).json({ error: "server error" });
  }
});


// ================== ADMIN ORDER ACTIONS ==================
async function updateOrderAndNotify(path, orderId, newStatus, tgInfo) {
  const ref = db.ref(`${path}/${orderId}`);
  const snap = await ref.once("value");
  if (!snap.exists()) throw new Error("Order not found");

  const order = snap.val();
  await ref.update({ status: newStatus });

  // Telegram notify
  await sendTG(tgInfo, 
`⚠️ *Order Status Updated*
Order: \`${orderId}\`
User: ${order.userid}
Status: *${newStatus.toUpperCase()}*
Time (US): ${usTime(now())}
`);

  return true;
}

// CONFIRM
app.post("/api/admin/order/confirm", async (req, res) => {
  try {
    const { type, orderId } = req.body;

    const tgType =
      type === "recharge" ? TG.recharge :
      type === "withdraw" ? TG.withdraw :
      TG.trade;

    await updateOrderAndNotify(`orders/${type}`, orderId, "confirmed", tgType);

    res.json({ ok: true });
  } catch (e) {
    console.error("confirm error", e);
    res.status(500).json({ error: "server error" });
  }
});

// CANCEL
app.post("/api/admin/order/cancel", async (req, res) => {
  try {
    const { type, orderId } = req.body;

    const tgType =
      type === "recharge" ? TG.recharge :
      type === "withdraw" ? TG.withdraw :
      TG.trade;

    await updateOrderAndNotify(`orders/${type}`, orderId, "cancelled", tgType);

    res.json({ ok: true });
  } catch (e) {
    console.error("cancel error", e);
    res.status(500).json({ error: "server error" });
  }
});


// LOCK
app.post("/api/admin/order/lock", async (req, res) => {
  try {
    const { type, orderId } = req.body;

    const tgType =
      type === "recharge" ? TG.recharge :
      type === "withdraw" ? TG.withdraw :
      TG.trade;

    await updateOrderAndNotify(`orders/${type}`, orderId, "locked", tgType);

    res.json({ ok: true });
  } catch (e) {
    console.error("lock error", e);
    res.status(500).json({ error: "server error" });
  }
});

// UNLOCK
app.post("/api/admin/order/unlock", async (req, res) => {
  try {
    const { type, orderId } = req.body;

    const tgType =
      type === "recharge" ? TG.recharge :
      type === "withdraw" ? TG.withdraw :
      TG.trade;

    await updateOrderAndNotify(`orders/${type}`, orderId, "unlocked", tgType);

    res.json({ ok: true });
  } catch (e) {
    console.error("unlock error", e);
    res.status(500).json({ error: "server error" });
  }
});


// ============= STRIKINGLY USER SYNC =============
app.post("/api/users/sync", async (req, res) => {
  try {
    const { userid } = req.body;
    if (!userid) return res.json({ ok: false });

    const ts = now();
    const ref = db.ref("users/" + userid);

    await ref.update({
      userid,
      updated: usTime(ts),
      created: (await ref.child("created").once("value")).val() || usTime(ts),
      balance: (await ref.child("balance").once("value")).val() || 0
    });

    return res.json({ ok: true });
  } catch (err) {
    console.log("sync error:", err);
    return res.json({ ok: false });
  }
});


// ============= GET BALANCE =============
app.get("/api/user/balance", async (req, res) => {
  try {
    const userid = req.headers["x-user-id"];
    if (!userid) return res.status(400).json({ error: "userid missing" });

    const snap = await db.ref("users/" + userid + "/balance").once("value");
    res.json({ ok: true, balance: snap.val() || 0 });
  } catch (e) {
    res.status(500).json({ error: "server error" });
  }
});


// ============= UPDATE BALANCE =============
app.post("/api/user/balance/update", async (req, res) => {
  try {
    const { userid, balance } = req.body;
    await db.ref("users/" + userid).update({ balance });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "server error" });
  }
});
// ================== 订单列表（管理后台获取全部订单） ==================
app.get("/api/admin/orders", async (req, res) => {
  try {
    const rechargeSnap = await db.ref("orders/recharge").once("value");
    const withdrawSnap = await db.ref("orders/withdraw").once("value");
    const tradeSnap = await db.ref("orders/buysell").once("value");

    res.json({
      ok: true,
      recharge: rechargeSnap.val() || {},
      withdraw: withdrawSnap.val() || {},
      buysell: tradeSnap.val() || {}
    });

  } catch (err) {
    console.error("orders fetch error:", err);
    res.status(500).json({ error: "server error" });
  }
});


// ================== HEALTH CHECK ==================
app.get("/", (_req, res) => {
  res.send("NEXBIT Backend Running");
});


// ================== ERROR HANDLING ==================
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err.stack);
  res.status(500).json({ error: "Internal server error" });
});


// ================== START SERVER ==================
app.listen(PORT, () => {
  console.log(`🚀 NEXBIT backend running on port ${PORT}`);
});
