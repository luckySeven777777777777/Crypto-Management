// index.js (完整，覆盖现有)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import admin from "firebase-admin";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// init firebase admin
try {
  const svc = typeof process.env.FIREBASE_SERVICE_ACCOUNT === 'string'
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : process.env.FIREBASE_SERVICE_ACCOUNT;
  admin.initializeApp({ credential: admin.credential.cert(svc) });
} catch (e) {
  console.error("Firebase init failed. Check FIREBASE_SERVICE_ACCOUNT env.", e);
  process.exit(1);
}

const db = admin.firestore();
const app = express();
app.use(cors());
app.use(express.json());

// env defaults
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const GROUP_ID = process.env.GROUP_ID || "";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "1234";

// helpers
function safeNumber(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
async function sendTelegram(text){
  if(!BOT_TOKEN || !GROUP_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: GROUP_ID,
      text,
      parse_mode: "Markdown"
    });
  } catch(e){
    console.warn("Telegram send failed:", e.message || e);
  }
}

// ---------------- Public API: 前端 / Strikingly 使用 ----------------
// POST /api/balance  { userid }
app.post("/api/balance", async (req, res) => {
  try {
    const { userid } = req.body || {};
    if (!userid) return res.json({ success: false, message: "no userid", balance: 0 });

    const docRef = db.collection("users").doc(String(userid));
    const doc = await docRef.get();
    if (!doc.exists) {
      await docRef.set({ balance: 0, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return res.json({ success: true, balance: 0 });
    }
    const data = doc.data();
    return res.json({ success: true, balance: safeNumber(data.balance) });
  } catch (err) {
    console.error("/api/balance error", err);
    return res.json({ success: false, message: "server error", balance: 0 });
  }
});

// ---------------- Admin APIs ----------------
// simple login (no sessions; admins.html POSTs and redirects)
app.post("/api/admin/login", async (req, res) => {
  const { user, pass } = req.body || {};
  if (user === ADMIN_USER && pass === ADMIN_PASS) return res.json({ success: true });
  return res.json({ success: false });
});

// list users: GET /api/admin/users
app.get("/api/admin/users", async (req, res) => {
  try {
    const snap = await db.collection("users").get();
    const list = [];
    snap.forEach(doc => {
      const d = doc.data() || {};
      list.push({
        userid: doc.id,
        balance: safeNumber(d.balance || 0),
        wallet: d.wallet || "",
        level: d.level || "",
        lastActivity: d.lastActivity || null,
        createdAt: d.createdAt ? d.createdAt.toDate?.() : null
      });
    });
    list.sort((a,b)=>{
      const na=Number(a.userid), nb=Number(b.userid);
      if(!isNaN(na) && !isNaN(nb)) return na-nb;
      return a.userid > b.userid ? 1 : -1;
    });
    res.json(list);
  } catch (e) {
    console.error("/api/admin/users err", e);
    res.status(500).json([]);
  }
});

// create user
app.post("/api/admin/create", async (req, res) => {
  try {
    const { user, pass } = req.body || {};
    if (!user) return res.json({ success: false, message: "no user" });
    await db.collection("users").doc(String(user)).set({
      password: pass || "",
      balance: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await sendTelegram(`🆕 新用户已创建\n用户: ${user}`);
    return res.json({ success: true });
  } catch (e) {
    console.error("/api/admin/create err", e);
    return res.json({ success: false });
  }
});

// reset password
app.post("/api/admin/reset", async (req, res) => {
  try {
    const { user, pass } = req.body || {};
    if (!user) return res.json({ success: false, message: "no user" });
    await db.collection("users").doc(String(user)).set({ password: pass || "" }, { merge: true });
    await sendTelegram(`🔐 密码已重置\n用户: ${user}`);
    return res.json({ success: true });
  } catch (e) {
    console.error("/api/admin/reset err", e);
    return res.json({ success: false });
  }
});

// set absolute balance
app.post("/api/admin/balance", async (req, res) => {
  try {
    const { user, amount } = req.body || {};
    if (!user) return res.json({ success: false, message: "no user" });
    const ref = db.collection("users").doc(String(user));
    const snap = await ref.get();
    const current = (snap.exists && snap.data().balance) ? safeNumber(snap.data().balance) : 0;
    const newBal = safeNumber(amount);
    await ref.set({ balance: newBal, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await sendTelegram(`💰 余额已设置\n用户: ${user}\n新余额: ${newBal}`);
    return res.json({ success: true, balance: newBal });
  } catch (e) {
    console.error("/api/admin/balance err", e);
    return res.json({ success: false });
  }
});

// balance delta (optional)
app.post("/api/admin/balance/delta", async (req, res) => {
  try {
    const { user, delta } = req.body || {};
    if (!user) return res.json({ success: false, message: "no user" });
    const ref = db.collection("users").doc(String(user));
    const snap = await ref.get();
    const current = (snap.exists && snap.data().balance) ? safeNumber(snap.data().balance) : 0;
    const newBal = current + safeNumber(delta);
    await ref.set({ balance: newBal, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await sendTelegram(`💱 余额变动\n用户: ${user}\n变动: ${delta}\n当前余额: ${newBal}`);
    return res.json({ success: true, balance: newBal });
  } catch (e) {
    console.error(e);
    return res.json({ success: false });
  }
});

// settings endpoints
app.get("/api/admin/settings", async (req, res) => {
  try {
    const doc = await db.collection("meta").doc("settings").get();
    res.json(doc.exists ? doc.data() : {});
  } catch (e) { res.json({}); }
});
app.post("/api/admin/settings", async (req, res) => {
  try {
    await db.collection("meta").doc("settings").set(req.body || {}, { merge: true });
    res.json({ success: true });
  } catch (e) { res.json({ success: false }); }
});

// serve static in public
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req,res)=> {
  res.sendFile(path.join(__dirname, "public", "dashboard-brand.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log("API running on port", PORT));
