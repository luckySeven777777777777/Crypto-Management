const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ==================
//  Firebase 初始化
// ==================
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString()
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ================ 工具函数 =====================

async function getUser(uid) {
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();
  return snap.exists ? snap.data() : null;
}

async function setBalance(uid, amount) {
  return db.collection("users").doc(uid).update({ balance: amount });
}

// ==================
//  前端接口（Strikingly）
// ==================

// 查询余额
app.get("/api/balance/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;
    const u = await getUser(uid);
    if (!u) return res.json({ balance: 0 });
    res.json({ balance: u.balance || 0 });
  } catch (e) {
    res.json({ balance: 0 });
  }
});

// 买卖扣费
app.post("/api/buysell", async (req, res) => {
  try {
    const { uid, amount } = req.body;

    const u = await getUser(uid);
    if (!u) return res.json({ status: false });

    const newBalance = (u.balance || 0) - amount;
    if (newBalance < 0)
      return res.json({ status: false, msg: "Insufficient balance" });

    await setBalance(uid, newBalance);

    await db.collection("bs").add({
      uid,
      amount,
      status: "completed",
      time: Date.now(),
    });

    res.json({ status: true, balance: newBalance });
  } catch (err) {
    res.json({ status: false });
  }
});

// ==================
//  管理后台接口
// ==================

// 登录后台
app.post("/api/admin/login", async (req, res) => {
  const { account, password } = req.body;

  const snap = await db
    .collection("admins")
    .where("account", "==", account)
    .where("password", "==", password)
    .get();

  if (snap.empty) return res.json({ status: false });

  res.json({ status: true });
});

// 充值列表
app.get("/api/admin/listRecharge", async (req, res) => {
  const snap = await db.collection("recharge").orderBy("time", "desc").get();
  res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
});

// 提款列表
app.get("/api/admin/listWithdraw", async (req, res) => {
  const snap = await db.collection("withdraw").orderBy("time", "desc").get();
  res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
});

// BuySell 列表
app.get("/api/admin/listBs", async (req, res) => {
  const snap = await db.collection("bs").orderBy("time", "desc").get();
  res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
});

// 订单详情
app.get("/api/admin/orderDetail/:id/:type", async (req, res) => {
  const { id, type } = req.params;

  const snap = await db.collection(type).doc(id).get();
  if (!snap.exists) return res.json({ status: false });

  res.json({ status: true, data: snap.data() });
});

// 更新订单状态（审核）
app.post("/api/admin/updateOrderStatus", async (req, res) => {
  const { id, type, status } = req.body;

  const ref = db.collection(type).doc(id);
  const snap = await ref.get();

  if (!snap.exists) return res.json({ status: false });

  const order = snap.data();

  // 充值审批
  if (type === "recharge" && status === "approve") {
    const u = await getUser(order.uid);
    await setBalance(order.uid, (u.balance || 0) + order.amount);
  }

  // 提款审批
  if (type === "withdraw" && status === "approve") {
    const u = await getUser(order.uid);
    await setBalance(order.uid, (u.balance || 0) - order.amount);
  }

  await ref.update({ status });
  res.json({ status: true });
});

// Dashboard 数据
app.get("/api/admin/dashboard", async (req, res) => {
  const users = await db.collection("users").get();
  const recharge = await db.collection("recharge").get();
  const withdraw = await db.collection("withdraw").get();
  const bs = await db.collection("bs").get();

  res.json({
    totalUsers: users.size,
    totalRecharge: recharge.size,
    totalWithdraw: withdraw.size,
    totalBs: bs.size,
  });
});

// SSE 实时推送
app.get("/api/orders/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");

  const unsub = db.collection("recharge").onSnapshot(() => {
    res.write(`data: update\n\n`);
  });

  req.on("close", () => unsub());
});

// ==================
//  启动
// ==================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
