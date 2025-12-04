// ================== 必要模块 ==================
const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// ================== Firebase 初始化 ==================
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://cryptonexbitsafe-default-rtdb.firebaseio.com"
});

const db = admin.database();

// ================== Telegram ==================
const axios = require("axios");
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_ID = process.env.GROUP_ID;

// Telegram 发送消息
async function sendTelegramMessage(text) {
  try {
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        chat_id: GROUP_ID,
        text: text,
        parse_mode: "HTML"
      }
    );
  } catch (error) {
    console.error("Telegram 错误:", error.message);
  }
}

// ================== API: 获取用户余额 ==================
app.get("/balance", async (req, res) => {
  const userId = req.query.userid;
  if (!userId) return res.json({ error: "缺少 userid" });

  try {
    const snap = await db.ref(`users/${userId}/balance`).once("value");
    const balance = snap.val() || 0;

    return res.json({ userid: userId, balance });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "服务器错误" });
  }
});

// ================== API: 更新余额 ==================
app.post("/update", async (req, res) => {
  const { userid, amount } = req.body;

  if (!userid || amount === undefined)
    return res.json({ error: "缺少参数" });

  try {
    await db.ref(`users/${userid}/balance`).set(Number(amount));

    await sendTelegramMessage(
      `🔔 <b>余额更新</b>\n用户ID: <b>${userid}</b>\n新余额: <b>${amount}</b>`
    );

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "服务器错误" });
  }
});

// ================== API: 创建订单（提款/充值） ==================
app.post("/order", async (req, res) => {
  const { userid, type, amount } = req.body;

  if (!userid || !type || !amount)
    return res.json({ error: "缺少参数" });

  const orderId = Date.now().toString();

  try {
    await db.ref(`orders/${orderId}`).set({
      userid,
      type,
      amount,
      time: new Date().toISOString()
    });

    await sendTelegramMessage(
      `🧾 <b>新订单</b>\n类型: <b>${type}</b>\n金额: <b>${amount}</b>\n用户: <b>${userid}</b>\n订单号: <b>${orderId}</b>`
    );

    return res.json({ success: true, orderId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "服务器错误" });
  }
});

// ================== 后台统计 API ==================
app.get("/dashboard", async (req, res) => {
  try {
    const ordersSnap = await db.ref("orders").once("value");
    const orders = ordersSnap.val() || {};

    let todayDeposit = 0;
    let todayWithdraw = 0;
    let todayOrder = 0;

    const today = new Date().toISOString().slice(0, 10);

    Object.values(orders).forEach((o) => {
      if (o.time.slice(0, 10) === today) {
        todayOrder++;
        if (o.type === "deposit") todayDeposit += Number(o.amount);
        if (o.type === "withdraw") todayWithdraw += Number(o.amount);
      }
    });

    return res.json({
      todayDeposit,
      todayWithdraw,
      todayOrder
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "服务器错误" });
  }
});

// ================== 静态页面 ==================
app.use(express.static("public"));

// ================== 启动服务器 ==================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("服务器已启动，端口:", PORT);
});
