// ==============================================
//  Crypto Management Server (Final Stable Version)
//  Compatible with Strikingly (No SSE Required)
// ==============================================

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");

const serviceAccount = require("./firebase.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const app = express();
app.use(cors());
app.use(bodyParser.json());


// ==============================================
//  Utils
// ==============================================

// Get user document
async function getUser(uid) {
  const doc = await db.collection("users").doc(uid).get();
  if (!doc.exists) {
    await db.collection("users").doc(uid).set({
      balance: 0,
      created: Date.now()
    });
    return { balance: 0 };
  }
  return doc.data();
}

// Set balance
async function setBalance(uid, amount) {
  return db.collection("users").doc(uid).update({
    balance: amount
  });
}

// Add balance
async function addBalance(uid, amount) {
  const u = await getUser(uid);
  const newBal = Number(u.balance) + Number(amount);
  await setBalance(uid, newBal);
  return newBal;
}

// Deduct balance
async function deductBalance(uid, amount) {
  const u = await getUser(uid);
  const newBal = Number(u.balance) - Number(amount);
  if (newBal < 0) return u.balance;
  await setBalance(uid, newBal);
  return newBal;
}


// ==============================================
//  API Routes
// ==============================================

// ---- Get Balance ----
app.get("/api/balance/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;
    const user = await getUser(uid);
    res.json({ balance: user.balance || 0 });
  } catch (e) {
    res.json({ balance: 0 });
  }
});

// ---- Create Order: Recharge ----
app.post("/api/order/recharge", async (req, res) => {
  try {
    const { userId, amount } = req.body;

    const order = {
      userId,
      amount: Number(amount),
      type: "recharge",
      status: "pending",
      created: Date.now()
    };

    const ref = await db.collection("orders").add(order);

    res.json({ ok: true, orderId: ref.id });
  } catch (e) {
    res.json({ ok: false, error: String(e) });
  }
});

// ---- Create Order: Withdraw ----
app.post("/api/order/withdraw", async (req, res) => {
  try {
    const { userId, amount } = req.body;

    const order = {
      userId,
      amount: Number(amount),
      type: "withdraw",
      status: "pending",
      created: Date.now()
    };

    const ref = await db.collection("orders").add(order);

    res.json({ ok: true, orderId: ref.id });
  } catch (e) {
    res.json({ ok: false, error: String(e) });
  }
});

// ---- Create Order: Buy/Sell ----
app.post("/api/order/buysell", async (req, res) => {
  try {
    const { userId, amount } = req.body;

    const order = {
      userId,
      amount: Number(amount),
      type: "buysell",
      status: "success",
      created: Date.now()
    };

    // buy/sell = immediate deduction
    await deductBalance(userId, Number(amount));

    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: String(e) });
  }
});


// ==============================================
//  Admin Routes
// ==============================================

// ---- Admin Approve ----
app.post("/api/admin/approve", async (req, res) => {
  try {
    const { orderId } = req.body;

    const ref = db.collection("orders").doc(orderId);
    const order = await ref.get();

    if (!order.exists) return res.json({ ok: false });

    const data = order.data();

    if (data.status !== "pending")
      return res.json({ ok: false, msg: "already processed" });

    await ref.update({ status: "success", updated: Date.now() });

    if (data.type === "recharge") {
      await addBalance(data.userId, data.amount);
    } else if (data.type === "withdraw") {
      await deductBalance(data.userId, data.amount);
    }

    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: String(e) });
  }
});

// ---- Admin Reject ----
app.post("/api/admin/reject", async (req, res) => {
  try {
    const { orderId } = req.body;

    const ref = db.collection("orders").doc(orderId);
    const order = await ref.get();

    if (!order.exists) return res.json({ ok: false });

    await ref.update({ status: "rejected", updated: Date.now() });

    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: String(e) });
  }
});


// ==============================================
//  Start Server (NO DUPLICATE PORT!)
// ==============================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
