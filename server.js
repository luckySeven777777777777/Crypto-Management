const express = require("express");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const dotenv = require("dotenv");
const cors = require("cors");

// 加载环境变量
dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));  // 允许所有跨域请求

// ========================== 初始化 Firebase ==========================

// 从 Railway 的环境变量加载 JSON
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();


// ========================== 充值 ==========================
app.post("/api/order/recharge", (req, res) => {
  const { userid, coin, amount, wallet } = req.body;

  const recharge = {
    userid,
    coin,
    amount,
    wallet,
    status: "处理中",
    timestamp: new Date().toISOString()
  };

  db.ref("transactions").push(recharge);

  const message = `🔔 *充值申请*\n\n用户: ${userid}\n金额: ${amount} ${coin}\n钱包地址: ${wallet}`;
  sendToTelegram(message, "recharge");

  res.json({ success: true, recharge });
});


// ========================== 提款 ==========================
app.post("/api/order/withdraw", (req, res) => {
  const { userid, coin, amount, wallet } = req.body;

  const withdraw = {
    userid,
    coin,
    amount,
    wallet,
    status: "处理中",
    timestamp: new Date().toISOString()
  };

  db.ref("transactions").push(withdraw);

  const message = `💸 *提款申请*\n\n用户: ${userid}\n金额: ${amount} ${coin}\n钱包地址: ${wallet}`;
  sendToTelegram(message, "withdraw");

  res.json({ success: true, withdraw });
});


// ========================== 交易 ==========================
app.post("/api/order/trade", (req, res) => {
  const { userid, coin, amount, tradeType } = req.body;

  const trade = {
    userid,
    coin,
    amount,
    tradeType,
    status: "处理中",
    timestamp: new Date().toISOString()
  };

  db.ref("transactions").push(trade);

  const message = `📘 *交易申请*\n\n用户: ${userid}\n金额: ${amount} ${coin}\n类型: ${tradeType}`;
  sendToTelegram(message, "trade");

  res.json({ success: true, trade });
});


// ========================== Telegram 通知 ==========================
async function sendToTelegram(msg, type) {
  let botToken, chatIds;

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
        text: msg,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ 成功交易", callback_data: "trade_success" },
              { text: "❌ 取消交易", callback_data: "trade_cancel" }
            ]
          ]
        }
      })
    });
  }
}


// ========================== 启动服务器 ==========================
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
