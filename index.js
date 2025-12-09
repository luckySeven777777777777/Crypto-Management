import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import admin from "firebase-admin";
import fetch from "node-fetch";

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

// ----------------------------------------
// 工具函数：生成唯一订单号
// ----------------------------------------
function generateOrderId() {
  return "T" + Date.now() + Math.floor(Math.random() * 10000);
}

// -----------------------------
// 用户余额查询 + 初始化
// -----------------------------
app.post("/api/balance", async (req, res) => {
  try {
    const { userid, wallet } = req.body;

    if (!userid) return res.json({ success: false });

    const userRef = db.collection("users").doc(userid);
    const snap = await userRef.get();

    if (!snap.exists) {
      await userRef.set({
        wallet: wallet || "",
        balance: 0,
        created: Date.now(),
        status: "active",
      });
    }

    const data = (await userRef.get()).data();
    return res.json({ success: true, balance: data.balance || 0 });
  } catch (e) {
    console.error("balance error", e);
    return res.json({ success: false });
  }
});

// -----------------------------
// 用户：交易下单（买入/卖出）
// -----------------------------
app.post("/api/trade", async (req, res) => {
  try {
    const { userid, action, symbol, amount, price } = req.body;

    if (!userid || !action || !symbol || !amount || !price) {
      return res.json({ success: false, msg: "Missing fields" });
    }

    const userRef = db.collection("users").doc(userid);

    // 事务防止重复提交
    await db.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);

      if (!userSnap.exists) throw "User not exists";

      const balance = userSnap.data().balance || 0;

      // 买入扣款
      if (action === "buy") {
        if (balance < amount) throw "Balance not enough";

        t.update(userRef, {
          balance: balance - amount,
          lastUpdate: Date.now(),
        });
      }

      // 卖出则增加余额
      if (action === "sell") {
        t.update(userRef, {
          balance: balance + amount,
          lastUpdate: Date.now(),
        });
      }

      // 写入交易记录
      const orderId = generateOrderId();
      const txRef = db.collection("transactions").doc(orderId);

      t.set(txRef, {
        userid,
        action,
        symbol,
        amount,
        price,
        time: Date.now(),
        status: "completed",
      });
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("trade error", err);
    return res.json({ success: false, msg: err });
  }
});

// -----------------------------
// 用户：订单列表（交易记录）
// -----------------------------
app.post("/api/orders", async (req, res) => {
  try {
    const { userid } = req.body;
    if (!userid) return res.json([]);

    const snap = await db
      .collection("transactions")
      .where("userid", "==", userid)
      .orderBy("time", "desc")
      .get();

    const list = [];
    snap.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));

    res.json(list);
  } catch (err) {
    console.error("orders error:", err);
    res.status(500).json([]);
  }
});

// -----------------------------
// 管理后台：获取所有用户
// -----------------------------
app.get("/api/admin/users", async (req, res) => {
  try {
    const list = [];
    const snap = await db.collection("users").get();

    snap.forEach((doc) => list.push({ userid: doc.id, ...doc.data() }));

    res.json(list);
  } catch (err) {
    console.error("admin users error:", err);
    res.status(500).json([]);
  }
});

// -----------------------------
// 管理后台：修改余额
// -----------------------------
app.post("/api/admin/balance", async (req, res) => {
  try {
    const { user, amount } = req.body;

    await db.collection("users").doc(user).set(
      {
        balance: Number(amount),
        lastUpdate: Date.now(),
      },
      { merge: true }
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("balance update error", err);
    return res.json({ success: false });
  }
});

// -----------------------------
// 后台：充值记录
// -----------------------------
app.get("/proxy/recharge", async (req, res) => {
  try {
    const records = [];
    const snap = await db.collection("recharge").orderBy("time", "desc").get();
    snap.forEach((doc) => records.push({ id: doc.id, ...doc.data() }));

    res.json(records);
  } catch (err) {
    console.error("recharge error", err);
    res.status(500).json([]);
  }
});

// -----------------------------
// 后台：提现记录
// -----------------------------
app.get("/proxy/withdraw", async (req, res) => {
  try {
    const records = [];
    const snap = await db.collection("withdraw").orderBy("time", "desc").get();
    snap.forEach((doc) => records.push({ id: doc.id, ...doc.data() }));

    res.json(records);
  } catch (err) {
    console.error("withdraw error", err);
    res.status(500).json([]);
  }
});

// -----------------------------
// 后台：交易记录
// -----------------------------
app.get("/proxy/transactions", async (req, res) => {
  try {
    const records = [];
    const snap = await db.collection("transactions").orderBy("time", "desc").get();
    snap.forEach((doc) => records.push({ id: doc.id, ...doc.data() }));

    res.json(records);
  } catch (err) {
    console.error("transactions error", err);
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
