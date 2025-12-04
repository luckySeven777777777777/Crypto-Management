// ================================
//   NEXBIT 管理后台 — index.js
//  （保持原来功能 + 新增订单 API）
// ================================

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public")); // 让 HTML 能访问

// ====== 数据库存储（简单 JSON 文件） ======
const DB_FILE = path.join(__dirname, "database.json");

// 如果数据库不存在就创建
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({
        users: [],
        deposits: [],
        withdrawals: [],
        trades: []
    }, null, 2));
}

// 读取数据库
function loadDB() {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

// 写入数据库
function saveDB(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// =======================================
//  📌 API 1 — 用户同步（Strikingly 页面）
// =======================================
app.post("/api/user/sync", (req, res) => {
    const { userid } = req.body;
    if (!userid) return res.json({ ok: false });

    const db = loadDB();
    if (!db.users.includes(userid)) {
        db.users.push(userid);
        saveDB(db);
    }
    res.json({ ok: true });
});


// =======================================
//  📌 API 2 — 充值订单
// =======================================
app.post("/api/deposit", (req, res) => {
    const { userid, coin, amount, wallet } = req.body;

    const db = loadDB();
    db.deposits.push({
        userid,
        coin,
        amount,
        wallet,
        time: Date.now(),
        status: "pending"
    });
    saveDB(db);

    res.json({ ok: true });
});


// =======================================
//  📌 API 3 — 提款订单
// =======================================
app.post("/api/withdraw", (req, res) => {
    const { userid, coin, amount, wallet, txHash, password } = req.body;

    const db = loadDB();
    db.withdrawals.push({
        userid,
        coin,
        amount,
        wallet,
        txHash,
        password,
        time: Date.now(),
        status: "pending"
    });
    saveDB(db);

    res.json({ ok: true });
});


// =======================================
//  📌 API 4 — 交易订单（Buy / Sell）
// =======================================
app.post("/api/trade", (req, res) => {
    const { userid, type, coin, amount, price } = req.body;

    const db = loadDB();
    db.trades.push({
        userid,
        type,     // BUY / SELL
        coin,
        amount,
        price,
        time: Date.now(),
        status: "pending"
    });
    saveDB(db);

    res.json({ ok: true });
});


// =======================================
//   后台列表页面读取 API（给 dashboard 用）
// =======================================
app.get("/api/admin/deposits", (req, res) => {
    res.json(loadDB().deposits);
});

app.get("/api/admin/withdrawals", (req, res) => {
    res.json(loadDB().withdrawals);
});

app.get("/api/admin/trades", (req, res) => {
    res.json(loadDB().trades);
});


// =======================================
//   服务器启动
// =======================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running on port", PORT));
