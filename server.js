// server.js
// Final API server for dashboard-brand.html (env-var Firebase service account)
// Assumptions:
//  - recharge collection name is "recharge" (user confirmed).
//  - withdraw collection name is "withdraw" (if different, change below).
//  - buysell collection name is "buysell" (if different, change below).
//  - users collection name is "users" (user profile with balance field).
//
// Env:
//  - FIREBASE_SERVICE_ACCOUNT (one-line JSON string, private_key \\n escaped) OR place firebase.json file next to server.js
//
// Run: node server.js

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

// --- Try to mitigate server time drift (Railway sometimes has clock issues) ---
process.env.TZ = "UTC";
try {
  execSync("ntpdate -u time.google.com", { stdio: "ignore" });
  console.log("Time sync attempted");
} catch (e) {
  // ignore; may not have permission, but we attempted
  console.log("Time sync not available in container (ignored).");
}

// --- Init Firebase Admin using env or file ---
let serviceAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log("Using FIREBASE_SERVICE_ACCOUNT from env.");
  } else {
    // fallback to local file if present
    serviceAccount = require("./firebase.json");
    console.log("Using local firebase.json file.");
  }
} catch (e) {
  console.error("FATAL: Firebase service account not found or invalid. Set FIREBASE_SERVICE_ACCOUNT env or upload firebase.json");
  console.error(e);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- Serve static admin HTML (your UI) ---
app.use(express.static(__dirname));
app.get("/dashboard-brand.html", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard-brand.html"));
});

// --- SSE clients list ---
let sseClients = [];
function addSseClient(res) {
  const id = crypto.randomBytes(8).toString("hex");
  sseClients.push({ id, res });
  return id;
}
function removeSseClient(id) {
  sseClients = sseClients.filter(c => c.id !== id);
}
function broadcastSse(event, payload) {
  const data = JSON.stringify(payload || {});
  sseClients.forEach(c => {
    try {
      c.res.write(`event: ${event}\n`);
      c.res.write(`data: ${data}\n\n`);
    } catch (e) {
      // ignore
    }
  });
}

// --- Collections (ASSUMPTIONS) ---
const COL_RECHARGE = "recharge"; // you confirmed this
const COL_WITHDRAW = "withdraw"; // ASSUMPTION: change if different
const COL_BUYSELL = "buysell";   // ASSUMPTION: change if different
const COL_USERS = "users";       // ASSUMPTION: change if different

// --- Admin token store (in-memory) ---
const tokens = {}; // token -> adminId
async function createAdmin(id, password) {
  const ref = db.collection("admins").doc(String(id));
  const snap = await ref.get();
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  if (!snap.exists) {
    await ref.set({ id: String(id), passwordHash: hash, created: Date.now() });
    return { ok: true };
  } else {
    // update password if exists
    await ref.set({ passwordHash: hash }, { merge: true });
    return { ok: true };
  }
}
async function verifyAdmin(id, password) {
  const ref = db.collection("admins").doc(String(id));
  const snap = await ref.get();
  if (!snap.exists) return false;
  const data = snap.data();
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  return data.passwordHash === hash;
}
async function ensureDefaultAdmin() {
  const snap = await db.collection("admins").limit(1).get();
  if (snap.empty) {
    await createAdmin("admin", "970611");
    console.log("Default admin created: id=admin pw=970611 (change ASAP)");
  }
}
ensureDefaultAdmin();

// --- Helper: user balance operations ---
async function getUser(uid) {
  const doc = db.collection(COL_USERS).doc(String(uid));
  const snap = await doc.get();
  if (!snap.exists) {
    // create default
    await doc.set({ balance: 0, created: Date.now() });
    return { id: String(uid), data: { balance: 0 } };
  }
  return { id: snap.id, data: snap.data() };
}
async function setUserBalance(uid, newBal) {
  const ref = db.collection(COL_USERS).doc(String(uid));
  await ref.set({ balance: Number(newBal), updated: Date.now() }, { merge: true });
  return Number(newBal);
}
async function addUserBalance(uid, delta) {
  const u = await getUser(uid);
  const newBal = Number(u.data.balance || 0) + Number(delta || 0);
  await setUserBalance(uid, newBal);
  return newBal;
}
async function deductUserBalance(uid, delta) {
  const u = await getUser(uid);
  const cur = Number(u.data.balance || 0);
  const amount = Number(delta || 0);
  if (cur - amount < 0) return { ok: false, error: "insufficient", balance: cur };
  const newBal = cur - amount;
  await setUserBalance(uid, newBal);
  return { ok: true, balance: newBal };
}

// --- Helper: create order doc in collection ---
async function createOrderInCollection(collName, payload) {
  const ref = await db.collection(collName).add(payload);
  const snap = await ref.get();
  return { id: ref.id, data: snap.data() };
}

// --- SSE endpoint ---
app.get("/api/orders/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  try { res.flushHeaders && res.flushHeaders(); } catch(e) {}
  const id = addSseClient(res);
  // welcome
  res.write(`event: welcome\n`);
  res.write(`data: ${JSON.stringify({ ok: true, now: Date.now() })}\n\n`);
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat\n\n`); } catch(e) {}
  }, 20000);
  req.on("close", () => {
    clearInterval(heartbeat);
    removeSseClient(id);
  });
});

// --- Balance endpoint (for Strikingly) ---
app.get("/api/balance/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;
    const u = await getUser(uid);
    return res.json({ ok: true, balance: Number(u.data.balance || 0) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// --- Create orders (client endpoints) ---
// Recharge (client-submitted deposit request)
app.post("/api/order/recharge", async (req, res) => {
  try {
    const { userId, amount, currency } = req.body;
    if (!userId || !amount) return res.json({ ok: false, error: "missing params" });
    const doc = {
      userId: String(userId),
      amount: Number(amount),
      currency: currency || "USD",
      status: "pending",
      created: Date.now(),
      type: "recharge"
    };
    const o = await createOrderInCollection(COL_RECHARGE, doc);
    broadcastSse("order_created", { collection: COL_RECHARGE, order: { orderId: o.id, ...o.data } });
    return res.json({ ok: true, orderId: o.id });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});

// Withdraw (client-submitted withdraw request)
app.post("/api/order/withdraw", async (req, res) => {
  try {
    const { userId, amount, currency } = req.body;
    if (!userId || !amount) return res.json({ ok: false, error: "missing params" });
    const doc = {
      userId: String(userId),
      amount: Number(amount),
      currency: currency || "USD",
      status: "pending",
      created: Date.now(),
      type: "withdraw"
    };
    const o = await createOrderInCollection(COL_WITHDRAW, doc);
    broadcastSse("order_created", { collection: COL_WITHDRAW, order: { orderId: o.id, ...o.data } });
    return res.json({ ok: true, orderId: o.id });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});

// BuySell (client-submitted trade) - automatically deduct immediately
app.post("/api/order/buysell", async (req, res) => {
  try {
    const { userId, amount, side, coin } = req.body;
    if (!userId || !amount) return res.json({ ok: false, error: "missing params" });
    const doc = {
      userId: String(userId),
      amount: Number(amount),
      side: side || "buy",
      coin: coin || "USDT",
      status: "processing",
      created: Date.now(),
      type: "buysell"
    };
    // attempt deduct
    const deduct = await deductUserBalance(userId, Number(amount));
    if (!deduct.ok) {
      doc.status = "failed";
      doc.reason = deduct.error || "insufficient";
      const o = await createOrderInCollection(COL_BUYSELL, doc);
      broadcastSse("order_created", { collection: COL_BUYSELL, order: { orderId: o.id, ...o.data } });
      return res.json({ ok: false, error: "insufficient balance" });
    }
    // succeeded
    doc.status = "success";
    const o = await createOrderInCollection(COL_BUYSELL, doc);
    broadcastSse("order_created", { collection: COL_BUYSELL, order: { orderId: o.id, ...o.data } });
    broadcastSse("balance", { userId: String(userId), balance: Number((await getUser(userId)).data.balance || 0) });
    return res.json({ ok: true });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});

// --- Admin create/login ---
app.post("/api/admin/create", async (req, res) => {
  try {
    const { id, password } = req.body;
    if (!id || !password) return res.json({ ok: false, error: "missing" });
    await createAdmin(id, password);
    return res.json({ ok: true });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});

app.post("/api/admin/login", async (req, res) => {
  try {
    const { id, password } = req.body;
    if (!id || !password) return res.json({ ok: false, error: "missing" });
    const ok = await verifyAdmin(id, password);
    if (!ok) return res.json({ ok: false, error: "invalid" });
    const token = crypto.randomBytes(24).toString("hex");
    tokens[token] = id;
    // expire token in 24h
    setTimeout(() => { delete tokens[token]; }, 24 * 3600 * 1000);
    return res.json({ ok: true, token, admin: id });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});

// --- requireAdmin middleware ---
function requireAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || req.headers.Authorization;
    if (!auth) return res.status(401).json({ ok: false, error: "no auth" });
    const parts = auth.split(" ");
    if (parts.length !== 2) return res.status(401).json({ ok: false, error: "bad auth" });
    const token = parts[1];
    if (!tokens[token]) return res.status(401).json({ ok: false, error: "invalid token" });
    req.adminId = tokens[token];
    next();
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}

// --- Admin listing endpoints used by dashboard (protected) ---
app.get("/api/admin/listRecharge", requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection(COL_RECHARGE).orderBy("created", "desc").limit(500).get();
    const list = [];
    snap.forEach(d => list.push({ orderId: d.id, ...d.data() }));
    return res.json({ ok: true, list });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});
app.get("/api/admin/listWithdraw", requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection(COL_WITHDRAW).orderBy("created", "desc").limit(500).get();
    const list = [];
    snap.forEach(d => list.push({ orderId: d.id, ...d.data() }));
    return res.json({ ok: true, list });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});
app.get("/api/admin/listBs", requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection(COL_BUYSELL).orderBy("created", "desc").limit(500).get();
    const list = [];
    snap.forEach(d => list.push({ orderId: d.id, ...d.data() }));
    return res.json({ ok: true, list });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});

// --- Admin dashboard stats ---
app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
  try {
    const [rSnap, wSnap, bSnap, usersSnap] = await Promise.all([
      db.collection(COL_RECHARGE).get(),
      db.collection(COL_WITHDRAW).get(),
      db.collection(COL_BUYSELL).get(),
      db.collection(COL_USERS).get()
    ]);
    const totalUsers = usersSnap.size;
    const totalBalance = (await Promise.all(usersSnap.docs.map(async d => Number(d.data().balance || 0)))).reduce((a,b) => a+b, 0);
    return res.json({ ok: true, totalUsers, totalBalance, rechargeCount: rSnap.size, withdrawCount: wSnap.size, buysellCount: bSnap.size });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});

// --- Admin order detail ---
app.get("/api/admin/orderDetail", requireAdmin, async (req, res) => {
  try {
    const orderId = req.query.orderId;
    const type = req.query.type; // 'recharge' | 'withdraw' | 'buysell' expected
    if (!orderId || !type) return res.json({ ok: false, error: "missing params" });
    const snap = await db.collection(type).doc(orderId).get();
    if (!snap.exists) return res.json({ ok: false, error: "not found" });
    return res.json({ ok: true, order: { orderId: snap.id, ...snap.data() } });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});

// --- Admin update order status (approve/reject/lock/unlock) ---
app.post("/api/admin/updateOrderStatus", requireAdmin, async (req, res) => {
  try {
    const { orderId, type, action } = req.body;
    if (!orderId || !type || !action) return res.json({ ok: false, error: "missing params" });
    const docRef = db.collection(type).doc(orderId);
    const snap = await docRef.get();
    if (!snap.exists) return res.json({ ok: false, error: "not found" });
    const order = snap.data();

    // compute new status
    let newStatus = order.status || "processing";
    if (action === "approve" || action === "success") newStatus = "success";
    if (action === "reject" || action === "failed") newStatus = "failed";
    if (action === "lock") newStatus = "locked";
    if (action === "unlock") newStatus = "processing";

    // apply side effects for success
    if (newStatus === "success") {
      if (type === COL_RECHARGE) {
        // add money to user
        await addUserBalance(order.userId, order.amount);
      } else if (type === COL_WITHDRAW) {
        // deduct money
        const deduct = await deductUserBalance(order.userId, order.amount);
        if (!deduct.ok) {
          // fail if insufficient
          await docRef.set({ status: "failed", reason: "insufficient" }, { merge: true });
          broadcastSse("order_updated", { orderId, type, status: "failed" });
          return res.json({ ok: false, error: "insufficient balance" });
        }
      } else if (type === COL_BUYSELL) {
        // buysell usually already deducted at creation; if not, try deduct
        // we avoid double-deduct here
      }
    }

    // update order status and add audit event
    await docRef.set({ status: newStatus, updated: Date.now(), lastAction: action }, { merge: true });
    // optional: append to events subcollection
    try {
      await docRef.collection("events").add({ action, admin: req.adminId, time: Date.now() });
    } catch (e) {}

    // broadcast SSE
    broadcastSse("order_updated", { orderId, type, status: newStatus });
    // broadcast new balance if applicable
    if (order.userId) {
      const u = await getUser(order.userId);
      broadcastSse("balance", { userId: String(order.userId), balance: Number(u.data.balance || 0) });
    }

    return res.json({ ok: true, status: newStatus });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});

// --- Generic aggregated transactions endpoint for dashboard (not protected) ---
app.get("/api/transactions", async (req, res) => {
  try {
    // allow optional fetchOrder param
    if (req.query.fetchOrder) {
      const orderId = req.query.fetchOrder;
      // search in all collections
      const types = [COL_RECHARGE, COL_WITHDRAW, COL_BUYSELL];
      for (let t of types) {
        const s = await db.collection(t).doc(orderId).get().catch(()=>null);
        if (s && s.exists) return res.json({ ok: true, order: { orderId: s.id, type: t, ...s.data() } });
      }
      return res.json({ ok: false, error: "not found" });
    }

    // otherwise return grouped lists
    const [rSnap, wSnap, bSnap, usersSnap] = await Promise.all([
      db.collection(COL_RECHARGE).orderBy("created", "desc").limit(500).get(),
      db.collection(COL_WITHDRAW).orderBy("created", "desc").limit(500).get(),
      db.collection(COL_BUYSELL).orderBy("created", "desc").limit(500).get(),
      db.collection(COL_USERS).get()
    ]);
    const recharge = [], withdraw = [], buysell = [];
    rSnap.forEach(d => recharge.push({ orderId: d.id, ...d.data() }));
    wSnap.forEach(d => withdraw.push({ orderId: d.id, ...d.data() }));
    bSnap.forEach(d => buysell.push({ orderId: d.id, ...d.data() }));
    const users = {};
    usersSnap.forEach(d => users[d.id] = { wallet: d.data().wallet || null, balance: Number(d.data().balance || 0), updated: d.data().updated || d.data().created || null });
    return res.json({ ok: true, recharge, withdraw, buysell, users });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});

// --- Health ---
app.get("/api/health", (req, res) => res.json({ ok: true, now: Date.now() }));

// --- Start server ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
