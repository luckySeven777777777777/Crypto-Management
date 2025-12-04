import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import admin from "firebase-admin";
import path from "path";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public")); // 让 dashboard-brand.html 可以访问

// ---------------- FIREBASE ----------------
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// -------- CREATE ORDER (Recharge) ----------
app.post("/api/order/recharge", async (req, res) => {
  try {
    const { userid, coin, amount, wallet, time, status } = req.body;

    await db.collection("recharge_orders").add({
      userid, coin, amount, wallet,
      time: time || Date.now(),
      status: status || "处理中"
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// -------- CREATE ORDER (Withdraw) ----------
app.post("/api/order/withdraw", async (req, res) => {
  try {
    const { userid, coin, amount, wallet, txHash, password, time, status } = req.body;

    await db.collection("withdraw_orders").add({
      userid, coin, amount, wallet,
      txHash: txHash || "",
      password: password || "",
      time: time || Date.now(),
      status: status || "处理中"
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// -------- CREATE ORDER (Buy / Sell) ----------
app.post("/api/order/trade", async (req, res) => {
  try {
    const { userid, type, coin, amount, price, time, status } = req.body;

    await db.collection("trade_orders").add({
      userid, type, coin, amount, price,
      time: time || Date.now(),
      status: status || "处理中"
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// -------- FETCH ALL ORDERS FOR DASHBOARD ----------
app.get("/api/orders/all", async (req, res) => {
  try {
    let recharge = await db.collection("recharge_orders").get();
    let withdraw = await db.collection("withdraw_orders").get();
    let trade = await db.collection("trade_orders").get();

    let all = [];

    recharge.forEach(doc => all.push({ id: doc.id, type: "充值", ...doc.data() }));
    withdraw.forEach(doc => all.push({ id: doc.id, type: "提款", ...doc.data() }));
    trade.forEach(doc => all.push({ id: doc.id, type: "交易", ...doc.data() }));

    all.sort((a, b) => b.time - a.time);

    res.json(all);

  } catch (err) {
    res.status(500).json([]);
  }
});

// --------------- RUN SERVER -----------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
