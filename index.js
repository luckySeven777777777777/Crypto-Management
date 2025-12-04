// index.js (CommonJS) — 放到你的后端根目录，替换现有 index.js
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const path = require("path");

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// ---------- FIREBASE 初始化（从环境变量中读取 JSON 字符串） -------------
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_KEY || "{}");
  if (Object.keys(serviceAccount).length > 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL || undefined
    });
  } else {
    console.warn("Firebase service account not provided in env; Firestore calls will fail if used.");
  }
} catch (e) {
  console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT:", e);
}

const db = admin.firestore ? admin.firestore() : null;

// ------------- 简单文件数据库 备用（当 Firebase 未配置时使用） -------------
const fs = require("fs");
const DB_FILE = path.join(__dirname, "local_db.json");
function ensureLocalDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ recharge: [], withdraw: [], trade: [], users: [] }, null, 2));
  }
}
ensureLocalDB();
function readLocalDB() { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
function writeLocalDB(obj) { fs.writeFileSync(DB_FILE, JSON.stringify(obj, null, 2)); }

// ---------- helper: save order to firestore or local ----------
async function saveOrder(collection, payload) {
  if (db) {
    await db.collection(collection).add(payload);
  } else {
    const dbObj = readLocalDB();
    dbObj[collection] = dbObj[collection] || [];
    dbObj[collection].push(payload);
    writeLocalDB(dbObj);
  }
}

// ---------- API: user sync ----------
app.post("/api/user/sync", async (req, res) => {
  const { userid } = req.body || {};
  if (!userid) return res.json({ success: false, error: "no userid" });
  try {
    if (db) {
      const ref = db.collection("users").doc(String(userid));
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set({ balance: 0, created: Date.now(), lastActive: Date.now() });
      } else {
        await ref.update({ lastActive: Date.now() });
      }
    } else {
      const local = readLocalDB();
      if (!local.users.includes(userid)) local.users.push(userid);
      writeLocalDB(local);
    }
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  }
});

// ---------- API: deposit ----------
app.post("/api/order/recharge", async (req, res) => {
  try {
    const { userid, coin, amount, wallet, time, status } = req.body || {};
    const payload = {
      userid: String(userid || ""),
      coin: String(coin || ""),
      amount: Number(amount || 0),
      wallet: String(wallet || ""),
      time: time || Date.now(),
      status: status || "处理中"
    };
    await saveOrder("recharge", payload);
    return res.json({ success: true });
  } catch (e) {
    console.error("recharge err", e);
    return res.status(500).json({ success: false });
  }
});

// ---------- API: withdraw ----------
app.post("/api/order/withdraw", async (req, res) => {
  try {
    const { userid, coin, amount, wallet, txHash, password, time, status } = req.body || {};
    const payload = {
      userid: String(userid || ""),
      coin: String(coin || ""),
      amount: Number(amount || 0),
      wallet: String(wallet || ""),
      txHash: String(txHash || ""),
      password: String(password || ""),
      time: time || Date.now(),
      status: status || "处理中"
    };
    await saveOrder("withdraw", payload);
    return res.json({ success: true });
  } catch (e) {
    console.error("withdraw err", e);
    return res.status(500).json({ success: false });
  }
});

// ---------- API: trade ----------
app.post("/api/order/trade", async (req, res) => {
  try {
    const { userid, type, coin, amount, price, time, status } = req.body || {};
    const payload = {
      userid: String(userid || ""),
      type: String(type || "").toUpperCase(),
      coin: String(coin || ""),
      amount: Number(amount || 0),
      price: Number(price || 0),
      time: time || Date.now(),
      status: status || "处理中"
    };
    await saveOrder("trade", payload);
    return res.json({ success: true });
  } catch (e) {
    console.error("trade err", e);
    return res.status(500).json({ success: false });
  }
});

// ---------- API: dashboard list (combined, with optional filters, paging, sorting) ----------
/*
 Query params:
  - type: ''|'recharge'|'withdraw'|'trade' (optional - if empty return all)
  - status: optional, filter by status
  - q: keyword search (userid / wallet / txHash)
  - sort: time_desc | time_asc
  - page: 1-based
  - per: items per page
*/
app.get("/api/orders/list", async (req, res) => {
  try {
    const qType = req.query.type || ""; // recharge/withdraw/trade or empty
    const qStatus = req.query.status || "";
    const q = (req.query.q || "").trim();
    const sort = req.query.sort || "time_desc";
    const page = Math.max(1, parseInt(req.query.page || "1"));
    const per = Math.max(1, parseInt(req.query.per || "20"));

    let all = [];

    if (db) {
      if (!qType || qType === "recharge") {
        const snap = await db.collection("recharge").get();
        snap.forEach(d => all.push({ id: d.id, category: "recharge", ...d.data() }));
      }
      if (!qType || qType === "withdraw") {
        const snap = await db.collection("withdraw").get();
        snap.forEach(d => all.push({ id: d.id, category: "withdraw", ...d.data() }));
      }
      if (!qType || qType === "trade") {
        const snap = await db.collection("trade").get();
        snap.forEach(d => all.push({ id: d.id, category: "trade", ...d.data() }));
      }
    } else {
      const local = readLocalDB();
      if (!qType || qType === "recharge") local.recharge.forEach((it, idx) => all.push({ id: `r_${idx}`, category: "recharge", ...it }));
      if (!qType || qType === "withdraw") local.withdraw.forEach((it, idx) => all.push({ id: `w_${idx}`, category: "withdraw", ...it }));
      if (!qType || qType === "trade") local.trade.forEach((it, idx) => all.push({ id: `t_${idx}`, category: "trade", ...it }));
    }

    // filtering
    if (qStatus) all = all.filter(i => (i.status || "").toLowerCase() === qStatus.toLowerCase());
    if (q) {
      const key = q.toLowerCase();
      all = all.filter(i => {
        return (String(i.userid || "").toLowerCase().includes(key)
          || String(i.wallet || "").toLowerCase().includes(key)
          || String(i.txHash || "").toLowerCase().includes(key)
          || (i.type && String(i.type).toLowerCase().includes(key)));
      });
    }

    // sort
    if (sort === "time_asc") all.sort((a,b)=> (a.time||0) - (b.time||0));
    else all.sort((a,b)=> (b.time||0) - (a.time||0));

    // pagination
    const total = all.length;
    const start = (page-1)*per;
    const pageItems = all.slice(start, start+per);

    res.json({ total, page, per, items: pageItems });
  } catch (e) {
    console.error("orders list err", e);
    res.status(500).json({ total:0, page:1, per:20, items:[] });
  }
});

// Simple root
app.get("/", (req, res) => res.send("Crypto Management API"));

// start
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running on port " + PORT));
