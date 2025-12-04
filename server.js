// ======================== 基础模块 ========================
const express = require("express");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const dotenv = require("dotenv");
const cors = require("cors");
const path = require("path");

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

// ======================== Firebase 初始化 ========================
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();

// ======================== 静态文件（管理后台必须） ========================
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ======================== Balance API ========================
app.post("/api/balance", async (req, res) => {
  try {
    const { userid } = req.body;
    if (!userid) return res.status(400).json({ error: "Missing userid" });

    const snapshot = await db.ref(`balances/${userid}`).once("value");
    const balance = snapshot.val() || { usdt: 0 };

    res.json({ success: true, balance });
  } catch (err) {
    res.status(500).json({ error: "Server Error" });
  }
});

// ======================== 生成订单号 ========================
function generateOrderId() {
  return "OD" + Date.now();
}

// ======================== 充值 ========================
app.post("/api/order/recharge", async (req, res) => {
  const { userid, coin, amount, wallet } = req.body;
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
});

// ======================== 提款 ========================
app.post("/api/order/withdraw", async (req, res) => {
  const { userid, coin, amount, wallet } = req.body;
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
    `💸 *提款申请*\n用户: ${userid}\n金额: ${amount} ${coin}\n订单号: ${orderId}\n地址: ${wallet}`
  );

  res.json({ success: true, orderId });
});

// ======================== BuySell ========================
app.post("/api/order/trade", async (req, res) => {
  const { userid, coin, amount, tradeType } = req.body;
  const orderId = generateOrderId();

  const data = {
    userid,
    coin,
    amount,
    tradeType,
    orderId,
    type: "trade",
    status: "processing",
    timestamp: Date.now()
  };

  await db.ref("transactions").push(data);

  sendToTelegram("trade",
    `📘 *交易申请*\n用户: ${userid}\n类型: ${tradeType}\n金额: ${amount} ${coin}\n订单号: ${orderId}`
  );

  res.json({ success: true, orderId });
});

// ======================== Telegram 通知模块 ========================
async function sendToTelegram(type, message) {
  let botToken = "";
  let chatIds = [];

  if (type === "recharge") {
    botToken = process.env.RECHARGE_BOT_TOKEN;
    chatIds = [process.env.RECHARGE_GROUP_CHAT_ID, process.env.RECHARGE_USER_CHAT_ID];
  }

  if (type === "withdraw") {
    botToken = process.env.WITHDRAW_BOT_TOKEN;
    chatIds = [process.env.WITHDRAW_GROUP_CHAT_ID, process.env.WITHDRAW_USER_CHAT_ID];
  }

  if (type === "trade") {
    botToken = process.env.TRADE_BOT_TOKEN;
    chatIds = [process.env.TRADE_GROUP_CHAT_ID, process.env.TRADE_USER_CHAT_ID];
  }

  for (const chatId of chatIds) {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
      })
    });
  }
}

// ======================== 启动服务器 ========================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
