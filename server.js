// ==========================
//      Crypto Management
//   Fully Fixed server.js
// ==========================

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// ------------------------
// Serve Frontend
// ------------------------
app.use(express.static(path.join(__dirname, "public")));

// ------------------------
// Firebase Init
// ------------------------

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();

// ------------------------
// Helper functions
// ------------------------

function generateOrderId() {
  return "TX-" + Math.random().toString(36).substring(2, 10).toUpperCase();
}

function getUserId(req) {
  return req.headers["x-user-id"] || req.body.userid || "unknown";
}

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

    if (!token || !groupId) return;

    // 推送到群
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: groupId,
        text: text,
        parse_mode: "Markdown"
      })
    });

    // 推送到管理员
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: userId,
        text: text,
        parse_mode: "Markdown"
      })
    });

  } catch (err) {
    console.log("Telegram Error:", err);
  }
}

// -----------------------------------------------------------
//      ★★★★★ 关键新增 API：同步用户到 Firebase ★★★★★ 
// -----------------------------------------------------------

app.post("/api/user/sync", async (req, res) => {
  try {
    const userid = getUserId(req);

    const userRef = db.ref(`users/${userid}`);

    await userRef.update({
      userid,
      wallet: "",
      level: "normal",
      lastActive: Date.now(),
      balance: 0
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------
// User Balance API
// ------------------------

app.post("/api/balance", async (req, res) => {
  try {
    const userid = getUserId(req);

    const snapshot = await db.ref(`users/${userid}/balance`).once("value");
    const balance = snapshot.val() || 0;

    res.json({ success: true, balance });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------
// Recharge Order
// ------------------------

app.post("/api/order/recharge", async (req, res) => {
  try {
    const userid = getUserId(req);
    const { coin, amount, wallet } = req.body;

    const orderId = generateOrderId();

    const data = {
      userid,
      coin,
      amount,
      wallet,
      orderId,
      type: "recharge",
      status: "processing",
      timestamp: Date.now()
    };

    await db.ref("transactions").push(data);

    sendToTelegram("recharge",
      `🔔 *充值申请*\n用户: ${userid}\n金额: ${amount} ${coin}\n订单号: ${orderId}\n地址: ${wallet}`
    );

    res.json({ success: true, orderId });

  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------
// Withdraw Order
// ------------------------

app.post("/api/order/withdraw", async (req, res) => {
  try {
    const userid = getUserId(req);
    const { coin, amount, wallet } = req.body;

    const orderId = generateOrderId();

    const data = {
      userid,
      coin,
      amount,
      wallet,
      orderId,
      type: "withdraw",
      status: "processing",
      timestamp: Date.now()
    };

    await db.ref("transactions").push(data);

    sendToTelegram("withdraw",
      `📤 *提款申请*\n用户: ${userid}\n金额: ${amount} ${coin}\n订单号: ${orderId}`
    );

    res.json({ success: true, orderId });

  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------
// Buy/Sell Trade Order
// ------------------------

app.post("/api/order/buysell", async (req, res) => {
  try {
    const userid = getUserId(req);
    const { coin, amount, side } = req.body;

    const orderId = generateOrderId();

    const data = {
      userid,
      coin,
      amount,
      side,
      orderId,
      type: "trade",
      status: "processing",
      timestamp: Date.now()
    };

    await db.ref("transactions").push(data);

    sendToTelegram("trade",
      `💱 *买卖订单*\n用户: ${userid}\n方向: ${side}\n金额: ${amount} ${coin}\n订单号: ${orderId}`
    );

    res.json({ success: true, orderId });

  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// -----------------------------------------------------------
//      ★★★★★ 管理后台 API ★★★★★
// -----------------------------------------------------------

// 获取所有用户
app.get("/api/admin/users", async (req, res) => {
  try {
    const users = (await db.ref("users").once("value")).val() || {};
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// 获取所有交易
app.get("/api/admin/transactions", async (req, res) => {
  try {
    const tx = (await db.ref("transactions").once("value")).val() || {};
    res.json({ success: true, transactions: tx });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------
// RUN SERVER
// ------------------------

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
