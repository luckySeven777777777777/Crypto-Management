// ==================
//  必要模块
// ==================
import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import bodyParser from "body-parser";
import { v4 as uuidv4 } from "uuid";

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

// ==================
//  工具函数
// ==================
async function getUser(uid) {
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();
  return snap.exists ? snap.data() : null;
}

async function setBalance(uid, amount) {
  await db.collection("users").doc(uid).update({ balance: amount });
}

async function addHistory(uid, type, amount, note = "") {
  await db.collection("history").add({
    uid,
    type,
    amount,
    note,
    time: Date.now(),
  });
}

// ==================
//  前端接口（Strikingly）
// ==================

// 查询余额
app.get("/api/balance/:uid", async (req, res) => {
  const { uid } = req.params;
  const u = await getUser(uid);
  if (!u) return res.json({ balance: 0 });
  res.json({ balance: u.balance || 0 });
});

// 买卖扣费
app.post("/api/buysell", async (req, res) => {
  const { uid, amount } = req.body;

  const u = await getUser(uid);
  if (!u) return res.json({ status: false, msg: "User not found" });

  const newBalance = u.balance - amount;
  if (newBalance < 0) return res.json({ status: false, msg: "Insufficient" });

  await setBalance(uid, newBalance);

  // 记录订单
  await db.collection("bs").add({
    uid,
    amount,
    status: "completed",
    time: Date.now(),
  });

  res.json({ status: true, balance: newBalance });
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

  const ref = db.collection(type).doc(id);
  const snap = await ref.get();

  if (!snap.exists) return res.json({ status: false });

  res.json({ status: true, data: snap.data() });
});

// 更新订单状态（充值/提款审核）
app.post("/api/admin/updateOrderStatus", async (req, res) => {
  const { id, type, status } = req.body;

  const ref = db.collection(type).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return res.json({ status: false });

  const order = snap.data();

  // 充值
  if (type === "recharge" && status === "approve") {
    const u = await getUser(order.uid);
    const newBalance = (u.balance || 0) + order.amount;
    await setBalance(order.uid, newBalance);
  }

  // 提款
  if (type === "withdraw" && status === "approve") {
    const u = await getUser(order.uid);
    const newBalance = (u.balance || 0) - order.amount;
    await setBalance(order.uid, newBalance);
  }

  await ref.update({ status });
  res.json({ status: true });
});

// Dashboard 数据
app.get("/api/admin/dashboard", async (req, res) => {
  const users = await db.collection("users").get();
  const recharge = await db.collection("recharge").get();
  const withdraw = await db.collection("withdraw").get();
  const buysell = await db.collection("bs").get();

  res.json({
    totalUsers: users.size,
    totalRecharge: recharge.size,
    totalWithdraw: withdraw.size,
    totalBs: buysell.size,
  });
});

// SSE 推送（实时刷新后台）
app.get("/api/orders/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");

  const unsubscribe = db.collection("recharge").onSnapshot(() => {
    res.write(`data: update\n\n`);
  });

  req.on("close", () => unsubscribe());
});

// ==================
//  启动
// ==================
app.listen(3000, () => console.log("Server running."));
