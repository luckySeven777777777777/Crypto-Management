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

// 初始化 Firebase
const serviceAccount = require("./path/to/serviceAccountKey.json");  // 替换为您的 Firebase 服务账号文件路径

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://cryptonexbitsafe-default-rtdb.firebaseio.com"  // 替换为您的 Firebase 数据库 URL
});

const db = admin.database();

// ========================== 充值 ==========================
app.post("/api/order/recharge", (req, res) => {
  const { userid, coin, amount, wallet } = req.body;
  console.log(`Recharge request received for ${userid}, ${coin}, ${amount}, ${wallet}`);

  const recharge = {
    userid,
    coin,
    amount,
    wallet,
    status: "处理中",
    timestamp: new Date().toISOString()
  };

  // 保存充值记录到 Firebase
  const transactionsRef = db.ref("transactions");
  transactionsRef.push(recharge);

  // 发送充值通知
  const message = `New Recharge Request:\nAmount: ${amount} ${coin}\nWallet: ${wallet}`;
  sendToTelegram(message, "recharge");

  res.json({ success: true, recharge });
});

// ========================== 提款 ==========================
app.post("/api/order/withdraw", (req, res) => {
  const { userid, coin, amount, wallet, password } = req.body;
  console.log(`Withdrawal request received for ${userid}, ${coin}, ${amount}, ${wallet}`);

  const withdraw = {
    userid,
    coin,
    amount,
    wallet,
    status: "处理中",
    timestamp: new Date().toISOString()
  };

  // 保存提款记录到 Firebase
  const transactionsRef = db.ref("transactions");
  transactionsRef.push(withdraw);

  // 发送提款通知
  const message = `New Withdrawal Request:\nAmount: ${amount} ${coin}\nWallet: ${wallet}`;
  sendToTelegram(message, "withdraw");

  res.json({ success: true, withdraw });
});

// ========================== 交易 ==========================
app.post("/api/order/trade", (req, res) => {
  const { userid, coin, amount, tradeType } = req.body;
  console.log(`Trade request received for ${userid}, ${coin}, ${amount}, ${tradeType}`);

  const trade = {
    userid,
    coin,
    amount,
    tradeType,
    status: "处理中",
    timestamp: new Date().toISOString()
  };

  // 保存交易记录到 Firebase
  const transactionsRef = db.ref("transactions");
  transactionsRef.push(trade);

  // 发送交易通知
  const message = `New Trade Request:\nAmount: ${amount} ${coin}\nType: ${tradeType}`;
  sendToTelegram(message, "trade");

  res.json({ success: true, trade });
});

// ========================== Telegram 通知 ==========================
async function sendToTelegram(msg, operationType) {
  let botToken, chatIds;

  // 根据操作类型选择相应的 Bot Token 和 Chat ID
  if (operationType === "recharge") {
    botToken = process.env.RECHARGE_BOT_TOKEN;
    chatIds = [process.env.RECHARGE_GROUP_CHAT_ID, process.env.RECHARGE_USER_CHAT_ID];
  } else if (operationType === "withdraw") {
    botToken = process.env.WITHDRAW_BOT_TOKEN;
    chatIds = [process.env.WITHDRAW_GROUP_CHAT_ID, process.env.WITHDRAW_USER_CHAT_ID];
  } else if (operationType === "trade") {
    botToken = process.env.TRADE_BOT_TOKEN;
    chatIds = [process.env.TRADE_GROUP_CHAT_ID, process.env.TRADE_USER_CHAT_ID];
  }

  // 发送通知
  for (const chatId of chatIds) {
    try {
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
    } catch (e) {
      console.error("Telegram notification error", e);
    }
  }
}

// 启动服务器
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
