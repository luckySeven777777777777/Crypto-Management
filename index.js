import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import admin from "firebase-admin";

// -----------------------------
// Firebase 初始化
// -----------------------------
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.firestore();
const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));


// -----------------------------------------------------
// 自动创建/更新用户
// -----------------------------------------------------
app.post("/api/user/sync", async (req, res) => {
  try {
    const { userid } = req.body;
    if (!userid) return res.json({ success: false });

    const ref = db.collection("users").doc(userid);
    const snap = await ref.get();

    if (!snap.exists) {
      await ref.set({
        balance: 0,
        wallet: "",
        status: "active",
        created: Date.now(),
        lastActive: Date.now()
      });
      return res.json({ success: true, created: true });
    }

    await ref.update({ lastActive: Date.now() });
    return res.json({ success: true, created: false });

  } catch (e) {
    console.error("sync error", e);
    return res.json({ success: false });
  }
});


// -----------------------------------------------------
// 用户余额
// -----------------------------------------------------
app.post("/api/balance", async (req, res) => {
  try {
    const { userid } = req.body;
    if (!userid) return res.json({ success: false });

    const ref = db.collection("users").doc(userid);
    const snap = await ref.get();

    if (!snap.exists) {
      await ref.set({
        balance: 0,
        created: Date.now()
      });
    }

    const data = (await ref.get()).data();
    return res.json({ success: true, balance: data.balance });

  } catch (err) {
    console.error("balance error", err);
    return res.json({ success: false });
  }
});


// =====================================================
// 📌 1. 充值订单 API
// =====================================================
app.post("/api/deposit", async (req, res) => {
  try {
    const { userid, coin, amount, wallet } = req.body;

    await db.collection("recharge").add({
      userid,
      coin,
      amount: Number(amount),
      wallet,
      time: Date.now(),
      status: "pending"
    });

    res.json({ success: true });

  } catch (err) {
    console.error("deposit error:", err);
    res.status(500).json({ success: false });
  }
});


// =====================================================
// 📌 2. 提款订单 API
// =====================================================
app.post("/api/withdraw", async (req, res) => {
  try {
    const { userid, coin, amount, wallet, txHash, password } = req.body;

    await db.collection("withdraw").add({
      userid,
      coin,
      amount: Number(amount),
      wallet,
      txHash,
      password,
      time: Date.now(),
      status: "pending"
    });

    res.json({ success: true });

  } catch (err) {
    console.error("withdraw error:", err);
    res.status(500).json({ success: false });
  }
});


// =====================================================
// 📌 3. 交易订单 API（Buy/Sell）
// =====================================================
app.post("/api/trade", async (req, res) => {
  try {
    const { userid, type, coin, amount, price } = req.body;

    await db.collection("transactions").add({
      userid,
      type,
      coin,
      amount: Number(amount),
      price: Number(price),
      time: Date.now(),
      status: "pending"
    });

    res.json({ success: true });

  } catch (err) {
    console.error("trade error:", err);
    res.status(500).json({ success: false });
  }
});


// -----------------------------
// 管理后台：读取用户列表
// -----------------------------
app.get("/api/admin/users", async (req, res) => {
  try {
    const list = [];
    const snap = await db.collection("users").get();
    snap.forEach((doc) => list.push({ userid: doc.id, ...doc.data() }));
    res.json(list);
  } catch (e) {
    res.status(500).json([]);
  }
});


// -----------------------------
// 管理后台：充值记录
// -----------------------------
app.get("/proxy/recharge", async (req, res) => {
  try {
    const list = [];
    const snap = await db.collection("recharge").orderBy("time", "desc").get();
    snap.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
    res.json(list);
  } catch (e) {
    res.status(500).json([]);
  }
});


// -----------------------------
// 管理后台：提现记录
// -----------------------------
app.get("/proxy/withdraw", async (req, res) => {
  try {
    const list = [];
    const snap = await db.collection("withdraw").orderBy("time", "desc").get();
    snap.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
    res.json(list);
  } catch (e) {
    res.status(500).json([]);
  }
});


// -----------------------------
// 管理后台：交易记录
// -----------------------------
app.get("/proxy/transactions", async (req, res) => {
  try {
    const list = [];
    const snap = await db.collection("transactions").orderBy("time", "desc").get();
    snap.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
    res.json(list);
  } catch (e) {
    res.status(500).json([]);
  }
});


// -----------------------------
// 默认
// -----------------------------
app.get("/", (_, res) => {
  res.send("Crypto API running.");
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running on", PORT));
