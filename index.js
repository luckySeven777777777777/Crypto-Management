// index.js (ES Module)
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import morgan from "morgan";
import admin from "firebase-admin";
import path from "path";
import { fileURLToPath } from "url";

/*
  IMPORTANT:
  Set environment variable FIREBASE_SERVICE_ACCOUNT to the full JSON credentials.
  In Railway you can add an ENV variable named FIREBASE_SERVICE_ACCOUNT containing the JSON object (as a single-line JSON string).
  Alternatively in Railway's "Variables" use the JSON editor mode (preferred).
*/

// ---------- init firebase admin safely ----------
function initFirebaseFromEnv() {
  if (admin.apps.length) return; // already inited

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.error("FIREBASE_SERVICE_ACCOUNT env missing");
    throw new Error("FIREBASE_SERVICE_ACCOUNT not set");
  }

  // Accept multiple formats:
  // 1) raw JSON string (proper JSON)
  // 2) JSON with \n sequences for private_key lines
  let svc;
  try {
    svc = JSON.parse(raw);
  } catch (e) {
    // try to replace newlines escape sequences
    try {
      const replaced = raw.replace(/\\n/g, "\n");
      svc = JSON.parse(replaced);
    } catch (e2) {
      console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT:", e2);
      throw e2;
    }
  }

  admin.initializeApp({
    credential: admin.credential.cert(svc),
    databaseURL: process.env.FIREBASE_DATABASE_URL || svc.databaseURL || "https://cryptonexbitsafe-default-rtdb.firebaseio.com"
  });
}
initFirebaseFromEnv();

const db = admin.database();
const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: "1mb" }));
app.use(morgan("dev"));

// serve static files from public
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// ---------- helpers ----------
function nowTs() {
  return Date.now();
}
function genOrderId(prefix = "ORD") {
  const ts = Date.now().toString(36);
  const rnd = Math.floor(Math.random() * 90000 + 10000).toString(36);
  return `${prefix}_${ts}_${rnd}`;
}

// ---------- API ----------

// health / test
app.get("/api/test", (req, res) => {
  res.json({ ok: true, ts: nowTs() });
});

// --------- User sync from Strikingly ---------
// body: { userid: "user_1234" }
app.post("/api/user/sync", async (req, res) => {
  try {
    const { userid } = req.body;
    if (!userid) return res.status(400).json({ success: false, error: "userid required" });

    const ref = db.ref(`users/${userid}`);
    const snapshot = await ref.once("value");
    if (!snapshot.exists()) {
      const userObj = {
        userid,
        createdAt: admin.database.ServerValue.TIMESTAMP,
        balance: 0,
        lastSeen: admin.database.ServerValue.TIMESTAMP
      };
      await ref.set(userObj);
      return res.json({ success: true, created: true, user: userObj });
    } else {
      await ref.update({ lastSeen: admin.database.ServerValue.TIMESTAMP });
      return res.json({ success: true, created: false, user: snapshot.val() });
    }
  } catch (err) {
    console.error("user/sync err:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// --------- Get all users (admin) ---------
app.get("/api/users", async (req, res) => {
  try {
    const snapshot = await db.ref("users").once("value");
    const data = snapshot.val() || {};
    // return as array
    const users = Object.keys(data).map(k => data[k]);
    res.json({ success: true, users });
  } catch (err) {
    console.error("GET /api/users err", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --------- Balance endpoints ---------
// POST /api/balance   { userid }
// returns { success, balance }
app.post("/api/balance", async (req, res) => {
  try {
    const { userid } = req.body;
    if (!userid) return res.status(400).json({ success: false, error: "userid required" });

    const snap = await db.ref(`users/${userid}`).once("value");
    if (!snap.exists()) return res.status(404).json({ success: false, error: "user not found" });

    const user = snap.val();
    const balance = Number(user.balance || 0);
    return res.json({ success: true, balance });
  } catch (err) {
    console.error("POST /api/balance err", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin update balance (add/set) - protected? (simple)
app.post("/api/balance/update", async (req, res) => {
  try {
    const { userid, change, action } = req.body;
    // action: "set" or "add"
    if (!userid) return res.status(400).json({ success: false, error: "userid required" });
    const ref = db.ref(`users/${userid}`);
    const snap = await ref.once("value");
    if (!snap.exists()) return res.status(404).json({ success: false, error: "user not found" });
    const user = snap.val();
    let newBalance = Number(user.balance || 0);
    if (action === "set") {
      newBalance = Number(change || 0);
    } else {
      newBalance = newBalance + Number(change || 0);
    }
    await ref.update({ balance: newBalance, lastUpdated: admin.database.ServerValue.TIMESTAMP });

    // add ledger record
    const ledgerRef = db.ref("ledger").push();
    await ledgerRef.set({ userid, type: "balance_update", change: Number(change || 0), balance: newBalance, ts: admin.database.ServerValue.TIMESTAMP });

    res.json({ success: true, balance: newBalance });
  } catch (err) {
    console.error("POST /api/balance/update err", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --------- Deposits ---------
// POST /api/deposits  { userid, amount, currency, walletAddress, meta }
// creates a deposit record (status: pending)
app.post("/api/deposits", async (req, res) => {
  try {
    const { userid, amount, currency = "USDT", walletAddress = "", meta = {} } = req.body;
    if (!userid || !amount) return res.status(400).json({ success: false, error: "userid & amount required" });

    const orderId = genOrderId("DEP");
    const rec = {
      orderId,
      userid,
      amount: Number(amount),
      currency,
      walletAddress,
      status: "pending",
      createdAt: admin.database.ServerValue.TIMESTAMP,
      meta
    };
    await db.ref(`deposits/${orderId}`).set(rec);
    res.json({ success: true, deposit: rec });
  } catch (err) {
    console.error("POST /api/deposits err", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/deposits  (list all)
app.get("/api/deposits", async (req, res) => {
  try {
    const snap = await db.ref("deposits").once("value");
    const data = snap.val() || {};
    res.json({ success: true, deposits: Object.values(data) });
  } catch (err) {
    console.error("GET /api/deposits err", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin confirm deposit (apply balance): POST /api/deposits/confirm { orderId }
app.post("/api/deposits/confirm", async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, error: "orderId required" });
    const ref = db.ref(`deposits/${orderId}`);
    const snap = await ref.once("value");
    if (!snap.exists()) return res.status(404).json({ success: false, error: "deposit not found" });
    const dep = snap.val();
    if (dep.status === "confirmed") return res.json({ success: true, message: "already confirmed" });

    // update user balance
    const userRef = db.ref(`users/${dep.userid}`);
    const userSnap = await userRef.once("value");
    if (!userSnap.exists()) return res.status(404).json({ success: false, error: "user not found" });
    const user = userSnap.val();
    const newBal = (Number(user.balance || 0) + Number(dep.amount));
    await userRef.update({ balance: newBal, lastUpdated: admin.database.ServerValue.TIMESTAMP });

    // mark deposit confirmed
    await ref.update({ status: "confirmed", confirmedAt: admin.database.ServerValue.TIMESTAMP });

    // ledger
    await db.ref("ledger").push().set({ type: "deposit", orderId, userid: dep.userid, amount: dep.amount, ts: admin.database.ServerValue.TIMESTAMP });

    res.json({ success: true, balance: newBal });
  } catch (err) {
    console.error("POST /api/deposits/confirm err", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --------- Withdraws ---------
// POST /api/withdraws { userid, amount, currency, walletAddress }
app.post("/api/withdraws", async (req, res) => {
  try {
    const { userid, amount, currency = "USDT", walletAddress } = req.body;
    if (!userid || !amount || !walletAddress) return res.status(400).json({ success: false, error: "userid/amount/walletAddress required" });

    const userRef = db.ref(`users/${userid}`);
    const userSnap = await userRef.once("value");
    if (!userSnap.exists()) return res.status(404).json({ success: false, error: "user not found" });
    const user = userSnap.val();
    const bal = Number(user.balance || 0);
    if (bal < Number(amount)) return res.status(400).json({ success: false, error: "insufficient balance" });

    const orderId = genOrderId("WD");
    const rec = {
      orderId,
      userid,
      amount: Number(amount),
      currency,
      walletAddress,
      status: "pending",
      createdAt: admin.database.ServerValue.TIMESTAMP
    };
    await db.ref(`withdraws/${orderId}`).set(rec);

    // optionally: deduct temporarily
    await userRef.update({ balance: bal - Number(amount), lastUpdated: admin.database.ServerValue.TIMESTAMP });

    await db.ref("ledger").push().set({ type: "withdraw_request", orderId, userid, amount: Number(amount), ts: admin.database.ServerValue.TIMESTAMP });

    res.json({ success: true, withdraw: rec, balance: bal - Number(amount) });
  } catch (err) {
    console.error("POST /api/withdraws err", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET withdraws
app.get("/api/withdraws", async (req, res) => {
  try {
    const snap = await db.ref("withdraws").once("value");
    const data = snap.val() || {};
    res.json({ success: true, withdraws: Object.values(data) });
  } catch (err) {
    console.error("GET /api/withdraws err", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin confirm withdraw completion (POST /api/withdraws/confirm { orderId })
// if confirmed, mark 'completed' (we already subtracted when request created)
app.post("/api/withdraws/confirm", async (req, res) => {
  try {
    const { orderId, success } = req.body;
    if (!orderId) return res.status(400).json({ success: false, error: "orderId required" });
    const wRef = db.ref(`withdraws/${orderId}`);
    const wSnap = await wRef.once("value");
    if (!wSnap.exists()) return res.status(404).json({ success: false, error: "withdraw not found" });
    const w = wSnap.val();
    if (success === false) {
      // rollback: add money back
      const userRef = db.ref(`users/${w.userid}`);
      const uSnap = await userRef.once("value");
      const curBal = Number((uSnap.val() || {}).balance || 0);
      await userRef.update({ balance: curBal + Number(w.amount), lastUpdated: admin.database.ServerValue.TIMESTAMP });
      await wRef.update({ status: "failed", resolvedAt: admin.database.ServerValue.TIMESTAMP });
      await db.ref("ledger").push().set({ type: "withdraw_failed", orderId, userid: w.userid, amount: w.amount, ts: admin.database.ServerValue.TIMESTAMP });
      return res.json({ success: true, rolledBack: true });
    } else {
      await wRef.update({ status: "completed", completedAt: admin.database.ServerValue.TIMESTAMP });
      await db.ref("ledger").push().set({ type: "withdraw_completed", orderId, userid: w.userid, amount: w.amount, ts: admin.database.ServerValue.TIMESTAMP });
      return res.json({ success: true, completed: true });
    }
  } catch (err) {
    console.error("POST /api/withdraws/confirm err", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- Misc: serve admin UI route (dashboard-brand.html) ----------
app.get("/dashboard-brand.html", (req, res) => {
  return res.sendFile(path.join(__dirname, "public", "dashboard-brand.html"));
});

// fallback static (so main site still works)
app.get("*", (req, res) => {
  // If request is for API, return 404
  if (req.path.startsWith("/api/")) return res.status(404).json({ success: false, error: "Not found" });
  // else serve index.html (for public site)
  const file = path.join(__dirname, "public", req.path === "/" ? "index.html" : req.path);
  res.sendFile(file, err => {
    if (err) {
      // fallback to index
      res.sendFile(path.join(__dirname, "public", "index.html"));
    }
  });
});

// start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
