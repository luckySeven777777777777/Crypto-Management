// server.js
// Final: Full API compatible with dashboard-brand.html
// Requires: firebase.json (Firebase Admin service account) in same dir

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const path = require("path");
const crypto = require("crypto");

// --- Firebase init (requires ./firebase.json present) ---
const serviceAccount = require("./firebase.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// --- Express setup ---
const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- Serve static files (dashboard HTML) ---
app.use(express.static(__dirname));
app.get("/dashboard-brand.html", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard-brand.html"));
});

// --- Simple in-memory SSE clients list ---
let sseClients = [];

// Helper: add SSE client
function addSseClient(res) {
  const id = crypto.randomBytes(8).toString("hex");
  const client = { id, res };
  sseClients.push(client);
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

// --- Utils: Users & Orders management using Firestore ---
async function getUserDoc(uid) {
  const ref = db.collection("users").doc(String(uid));
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({ balance: 0, created: Date.now() });
    return { id: String(uid), data: { balance: 0 } };
  }
  return { id: snap.id, data: snap.data() };
}
async function setUserBalance(uid, value) {
  const ref = db.collection("users").doc(String(uid));
  await ref.set({ balance: Number(value), updated: Date.now() }, { merge: true });
  return Number(value);
}
async function addUserBalance(uid, delta) {
  const u = await getUserDoc(uid);
  const newBal = Number(u.data.balance || 0) + Number(delta || 0);
  await setUserBalance(uid, newBal);
  return newBal;
}
async function deductUserBalance(uid, delta) {
  const u = await getUserDoc(uid);
  const cur = Number(u.data.balance || 0);
  const amount = Number(delta || 0);
  const newBal = cur - amount;
  if (newBal < 0) {
    // deny negative balance
    return { ok: false, balance: cur, error: "Insufficient balance" };
  }
  await setUserBalance(uid, newBal);
  return { ok: true, balance: newBal };
}

// Orders collection helpers
function ordersCollection() {
  return db.collection("orders");
}
async function createOrder(doc) {
  const ref = await ordersCollection().add(doc);
  const snap = await ref.get();
  return { id: ref.id, data: snap.data() };
}
async function getOrderById(id) {
  const ref = ordersCollection().doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return { id: snap.id, data: snap.data() };
}
async function updateOrder(id, patch) {
  const ref = ordersCollection().doc(id);
  await ref.set(patch, { merge: true });
  const snap = await ref.get();
  return { id: snap.id, data: snap.data() };
}
async function queryOrders(filter = {}) {
  // return arrays grouped by type for compatibility with dashboard
  const snap = await ordersCollection().orderBy("created", "desc").limit(500).get();
  const recharge = [], withdraw = [], buysell = [];
  snap.forEach(d => {
    const o = { orderId: d.id, ...d.data() };
    if (o.type === "recharge") recharge.push(o);
    else if (o.type === "withdraw") withdraw.push(o);
    else if (o.type === "buysell") buysell.push(o);
    else {
      // unknown => put into buysell
      buysell.push(o);
    }
  });
  return { recharge, withdraw, buysell };
}

// Admin helpers (simple token-based auth)
async function createAdmin(id, password) {
  const ref = db.collection("admins").doc(String(id));
  const hashed = crypto.createHash("sha256").update(password).digest("hex");
  await ref.set({ id: String(id), passwordHash: hashed, created: Date.now() });
  return { ok: true };
}
async function verifyAdmin(id, password) {
  const ref = db.collection("admins").doc(String(id));
  const snap = await ref.get();
  if (!snap.exists) return false;
  const stored = snap.data();
  const hashed = crypto.createHash("sha256").update(password).digest("hex");
  return stored.passwordHash === hashed;
}
// create initial admin if none exist
async function ensureDefaultAdmin() {
  const aSnap = await db.collection("admins").limit(1).get();
  if (aSnap.empty) {
    // create a default admin for first-time convenience
    const id = "admin";
    const pw = "970611"; // you can change this later via API
    await createAdmin(id, pw);
    console.log("Default admin created: id=admin pw=970611 (please change)");
  }
}
ensureDefaultAdmin();

// token generation (simple)
function genToken() {
  return crypto.randomBytes(24).toString("hex");
}
const tokens = {}; // token -> adminId (in-memory). Acceptable for small admin panel; restart clears tokens.

// Middleware: admin auth optional
async function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth) return res.status(401).json({ ok: false, error: "no auth" });
  const parts = auth.split(" ");
  if (parts.length !== 2) return res.status(401).json({ ok: false, error: "bad auth" });
  const token = parts[1];
  if (!tokens[token]) return res.status(401).json({ ok: false, error: "invalid token" });
  req.adminId = tokens[token];
  next();
}

// --- SSE endpoint for orders stream ---
// dashboard will connect to /api/orders/stream
app.get("/api/orders/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders && res.flushHeaders();

  const id = addSseClient(res);
  // send a welcome event
  try {
    res.write(`event: welcome\n`);
    res.write(`data: ${JSON.stringify({ ok: true, now: Date.now() })}\n\n`);
  } catch (e) {}

  // keep connection alive with comments
  const interval = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch (e) {}
  }, 20000);

  req.on("close", () => {
    clearInterval(interval);
    removeSseClient(id);
  });
});

// --- /api/balance/:uid ---
app.get("/api/balance/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;
    const u = await getUserDoc(uid);
    return res.json({ ok: true, balance: Number(u.data.balance || 0) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// --- Create orders (client-facing) ---
app.post("/api/order/recharge", async (req, res) => {
  try {
    const { userId, amount, currency } = req.body;
    if (!userId || !amount) return res.json({ ok: false, error: "missing params" });
    const doc = {
      userId: String(userId),
      amount: Number(amount),
      currency: currency || "USD",
      type: "recharge",
      status: "pending",
      created: Date.now()
    };
    const o = await createOrder(doc);
    broadcastSse("order_created", { order: { orderId: o.id, ...o.data } });
    return res.json({ ok: true, orderId: o.id });
  } catch (e) {
    return res.json({ ok: false, error: String(e) });
  }
});
app.post("/api/order/withdraw", async (req, res) => {
  try {
    const { userId, amount, currency } = req.body;
    if (!userId || !amount) return res.json({ ok: false, error: "missing params" });
    const doc = {
      userId: String(userId),
      amount: Number(amount),
      currency: currency || "USD",
      type: "withdraw",
      status: "pending",
      created: Date.now()
    };
    const o = await createOrder(doc);
    broadcastSse("order_created", { order: { orderId: o.id, ...o.data } });
    return res.json({ ok: true, orderId: o.id });
  } catch (e) {
    return res.json({ ok: false, error: String(e) });
  }
});
app.post("/api/order/buysell", async (req, res) => {
  try {
    const { userId, amount, side, coin } = req.body;
    if (!userId || !amount) return res.json({ ok: false, error: "missing params" });
    const doc = {
      userId: String(userId),
      amount: Number(amount),
      side: side || "buy",
      coin: coin || "USDT",
      type: "buysell",
      status: "success",
      created: Date.now()
    };
    // auto-deduct immediately
    const deducted = await deductUserBalance(userId, Number(amount));
    // If insufficient, mark as failed
    if (deducted && deducted.ok === false) {
      doc.status = "failed";
      doc.reason = "insufficient";
      const o = await createOrder(doc);
      broadcastSse("order_created", { order: { orderId: o.id, ...o.data } });
      return res.json({ ok: false, error: "insufficient balance" });
    }
    // create order record with success
    const o = await createOrder(doc);
    broadcastSse("order_created", { order: { orderId: o.id, ...o.data } });
    broadcastSse("balance", { userId: String(userId), balance: Number((await getUserDoc(userId)).data.balance || 0) });
    return res.json({ ok: true });
  } catch (e) {
    return res.json({ ok: false, error: String(e) });
  }
});

// --- Admin: create admin (for initial setup) ---
app.post("/api/admin/create", async (req, res) => {
  try {
    const { id, password } = req.body;
    if (!id || !password) return res.json({ ok: false, error: "missing" });
    await createAdmin(id, password);
    return res.json({ ok: true });
  } catch (e) {
    return res.json({ ok: false, error: String(e) });
  }
});

// --- Admin: login ---
app.post("/api/admin/login", async (req, res) => {
  try {
    const { id, password } = req.body;
    if (!id || !password) return res.json({ ok: false, error: "missing" });
    const ok = await verifyAdmin(id, password);
    if (!ok) return res.json({ ok: false, error: "invalid" });
    const token = genToken();
    tokens[token] = id;
    // keep token for 24h in memory (if process restarts, tokens reset)
    setTimeout(() => { delete tokens[token]; }, 24 * 3600 * 1000);
    return res.json({ ok: true, token, admin: id });
  } catch (e) {
    return res.json({ ok: false, error: String(e) });
  }
});

// --- Admin: list endpoints for dashboard (protected) ---
app.get("/api/admin/listRecharge", requireAdmin, async (req, res) => {
  try {
    const { recharge } = await queryOrders();
    return res.json({ ok: true, list: recharge });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});
app.get("/api/admin/listWithdraw", requireAdmin, async (req, res) => {
  try {
    const { withdraw } = await queryOrders();
    return res.json({ ok: true, list: withdraw });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});
app.get("/api/admin/listBs", requireAdmin, async (req, res) => {
  try {
    const { buysell } = await queryOrders();
    return res.json({ ok: true, list: buysell });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});

// --- Admin: dashboard stats ---
app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
  try {
    const all = await queryOrders();
    const usersSnap = await db.collection("users").get();
    const totalUsers = usersSnap.size;
    const totalBalance = (await Promise.all(usersSnap.docs.map(async d => Number(d.data().balance || 0)))).reduce((a,b) => a+b, 0);
    const todayOrders = (all.recharge.concat(all.withdraw, all.buysell)).filter(o => {
      const t = o.created || 0;
      const today = new Date(); today.setHours(0,0,0,0);
      return t >= today.getTime();
    }).length;
    const pendingWithdraw = (all.withdraw || []).filter(o => o.status === "pending").length;
    return res.json({ ok: true, totalUsers, totalBalance, todayOrders, pendingWithdraw, stats: { todayOrders } });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});

// --- Admin: order detail ---
app.get("/api/admin/orderDetail", requireAdmin, async (req, res) => {
  try {
    const { orderId } = req.query;
    if (!orderId) return res.json({ ok: false, error: "missing" });
    const o = await getOrderById(orderId);
    if (!o) return res.json({ ok: false, error: "not found" });
    // fetch order events from a subcollection if exists
    const eventsSnap = await ordersCollection().doc(orderId).collection("events").orderBy("time", "asc").get().catch(()=>null);
    const orderEvents = [];
    if (eventsSnap) eventsSnap.forEach(d => orderEvents.push(d.data()));
    return res.json({ ok: true, order: { orderId: o.id, ...o.data }, orderEvents });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});

// --- Admin: list members ---
app.get("/api/admin/listMembers", requireAdmin, async (req, res) => {
  try {
    const q = req.query.q || "";
    let snap = await db.collection("users").get();
    let members = snap.docs.map(d => ({ userId: d.id, wallet: d.data().wallet || null, last_active: d.data().updated || d.data().created || null, balance: Number(d.data().balance || 0) }));
    if (q) members = members.filter(m => m.userId.includes(q) || (m.wallet && m.wallet.includes(q)));
    return res.json({ ok: true, members });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});

// --- Generic transactions endpoint (used by dashboard) ---
app.get("/api/transactions", async (req, res) => {
  try {
    const all = await queryOrders();
    // also include users map
    const usersSnap = await db.collection("users").get();
    const users = {};
    usersSnap.forEach(d => {
      users[d.id] = { wallet: d.data().wallet || null, balance: Number(d.data().balance || 0), updated: d.data().updated || d.data().created || null };
    });
    // produce stats if needed
    const stats = {
      todayRecharge: (all.recharge || []).filter(o => (o.created||0) >= (new Date().setHours(0,0,0,0))).length,
      todayWithdraw: (all.withdraw || []).filter(o => (o.created||0) >= (new Date().setHours(0,0,0,0))).length,
      todayOrders: (all.recharge.length + all.withdraw.length + all.buysell.length)
    };
    return res.json({ ok: true, ...all, users, stats });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});

// --- Update transaction (single endpoint accepted by some UIs) ---
app.post("/api/transaction/update", requireAdmin, async (req, res) => {
  try {
    const { orderId, type, status, note } = req.body;
    if (!orderId) return res.json({ ok: false, error: "missing orderId" });
    const o = await getOrderById(orderId);
    if (!o) return res.json({ ok: false, error: "not found" });

    // update status
    await updateOrder(orderId, { status, note: note || null, updated: Date.now() });

    // handle status side-effects
    if (status === "success") {
      if (o.data.type === "recharge") {
        await addUserBalance(o.data.userId, o.data.amount);
        broadcastSse("balance", { userId: o.data.userId, balance: Number((await getUserDoc(o.data.userId)).data.balance || 0) });
      } else if (o.data.type === "withdraw") {
        // deduct on approve
        const ded = await deductUserBalance(o.data.userId, o.data.amount);
        if (ded.ok === false) {
          // mark as failed
          await updateOrder(orderId, { status: "failed", reason: "insufficient" });
          return res.json({ ok: false, error: "insufficient" });
        } else {
          broadcastSse("balance", { userId: o.data.userId, balance: Number((await getUserDoc(o.data.userId)).data.balance || 0) });
        }
      }
    }

    broadcastSse("order_updated", { orderId, status });
    return res.json({ ok: true });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});

// --- Admin updateOrderStatus (alternative endpoint) ---
app.post("/api/admin/updateOrderStatus", requireAdmin, async (req, res) => {
  try {
    const { orderId, action, type } = req.body;
    if (!orderId) return res.json({ ok: false, error: "missing" });
    const o = await getOrderById(orderId);
    if (!o) return res.json({ ok: false, error: "not found" });

    // action: success/failed/locked/unlock etc.
    let status = action === "success" ? "success" : action === "failed" ? "failed" : action === "locked" ? "locked" : action === "processing" ? "processing" : action;
    await updateOrder(orderId, { status, updated: Date.now(), note: action });

    // side effects: if success and recharge/withdraw
    if (status === "success") {
      if (o.data.type === "recharge") {
        await addUserBalance(o.data.userId, o.data.amount);
      } else if (o.data.type === "withdraw") {
        const ded = await deductUserBalance(o.data.userId, o.data.amount);
        if (ded.ok === false) {
          await updateOrder(orderId, { status: "failed", reason: "insufficient" });
          return res.json({ ok: false, error: "insufficient balance" });
        }
      }
      broadcastSse("balance", { userId: o.data.userId, balance: Number((await getUserDoc(o.data.userId)).data.balance || 0) });
    }

    broadcastSse("order_updated", { orderId, status });
    return res.json({ ok: true });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});

// --- Generic admin endpoints fallback compatibility (some UIs expect these) ---
app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
  try {
    const all = await queryOrders();
    const usersSnap = await db.collection("users").get();
    const totalUsers = usersSnap.size;
    const totalBalance = (await Promise.all(usersSnap.docs.map(async d => Number(d.data().balance || 0)))).reduce((a,b) => a+b, 0);
    return res.json({ ok: true, totalUsers, totalBalance, todayOrders: (all.recharge.length + all.withdraw.length + all.buysell.length), pendingWithdraw: (all.withdraw||[]).filter(x=>x.status==='pending').length });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});

// fallback GET /api/transactions?fetchOrder=ID support
app.get("/api/transactions", async (req, res) => {
  try {
    if (req.query.fetchOrder) {
      const o = await getOrderById(req.query.fetchOrder);
      if (!o) return res.json({ ok: false, error: "not found" });
      // fetch events
      const eventsSnap = await ordersCollection().doc(o.id).collection("events").orderBy("time", "asc").get().catch(()=>null);
      const orderEvents = [];
      if (eventsSnap) eventsSnap.forEach(d => orderEvents.push(d.data()));
      return res.json({ ok: true, order: { orderId: o.id, ...o.data }, orderEvents });
    }
    // otherwise handled earlier by same route - but keep compatibility
    const all = await queryOrders();
    return res.json({ ok: true, ...all });
  } catch (e) { return res.json({ ok: false, error: String(e) }); }
});

// --- Simple health route ---
app.get("/api/health", (req, res) => res.json({ ok: true, now: Date.now() }));

// --- Start server (single PORT) ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
