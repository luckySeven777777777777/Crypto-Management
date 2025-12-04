// 后端文件 server.js

const express = require("express");
const fs = require("fs");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static("public"));

// === Load DB ===
const DB_FILE = "database.json";
function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({
            admins: [{ username: "admin", passwordHash: "admin" }],
            users: [],
            settings: {},
            transactions: [],
            balances: {}   
        }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ========================== AUTH ==========================
app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    const db = loadDB();
    const admin = db.admins.find(a => a.username === username && a.passwordHash === password);
    if (!admin) {
        return res.json({ success: false, message: "登录失败" });
    }
    return res.json({ success: true });
});

// ========================== USER SYNC ==========================
app.post("/api/user/sync", (req, res) => {
  const { userid } = req.body;
  const db = loadDB();
  
  if (!db.users.find(u => u.userid === userid)) {
    db.users.push({ userid, balance: 0 });
    saveDB(db);
  }
  
  res.json({ success: true, message: `User ${userid} synced` });
});

// ========================== TRADE (BUY/SELL) ==========================
app.post("/api/order/trade", (req, res) => {
  const { userid, type, coin, amount, price, orderId } = req.body;
  const db = loadDB();
  
  const transaction = {
    type,
    userid,
    coin,
    amount,
    price,
    orderId,
    status: "处理中",
    timestamp: new Date().toISOString()
  };
  
  db.transactions.push(transaction);
  saveDB(db);

  res.json({ success: true, transaction });
});

// ========================== RECHARGE ==========================
app.post("/api/order/recharge", (req, res) => {
  const { userid, coin, amount, wallet, status } = req.body;
  const db = loadDB();

  const recharge = {
    userid,
    coin,
    amount,
    wallet,
    status: status || "处理中",
    timestamp: new Date().toISOString()
  };

  db.transactions.push(recharge);
  saveDB(db);

  res.json({ success: true, recharge });
});

// ========================== WITHDRAWAL ==========================
app.post("/api/order/withdraw", (req, res) => {
  const { userid, coin, amount, wallet, txHash, password, status } = req.body;
  const db = loadDB();

  const withdrawal = {
    userid,
    coin,
    amount,
    wallet,
    txHash,
    password,
    status: status || "处理中",
    timestamp: new Date().toISOString()
  };

  db.transactions.push(withdrawal);
  saveDB(db);

  res.json({ success: true, withdrawal });
});

// ========================== Serve Frontend ==========================
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard-brand.html"));
});

// ========================== LISTEN ==========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
