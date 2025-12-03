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
            balances: {}   // { username: balance }
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

// ========================== ADMIN CRUD ==========================
app.get("/api/admins", (req, res) => {
    const db = loadDB();
    res.json(db.admins);
});

app.post("/api/admins", (req, res) => {
    const { username, passwordHash } = req.body;
    const db = loadDB();

    if (db.admins.find(a => a.username === username)) {
        return res.json({ success: false, message: "用户已存在" });
    }

    db.admins.push({ username, passwordHash });
    saveDB(db);

    res.json({ success: true });
});

app.delete("/api/admins/:username", (req, res) => {
    const username = req.params.username;
    const db = loadDB();

    db.admins = db.admins.filter(a => a.username !== username);
    saveDB(db);

    res.json({ success: true });
});

// ========================== BALANCE ==========================
app.get("/api/balance/:user", (req, res) => {
    const user = req.params.user;
    const db = loadDB();

    res.json({ balance: db.balances[user] || 0 });
});

app.post("/api/balance/update", (req, res) => {
    const { user, amount } = req.body; // amount 可正(充值)可负(扣款)

    const db = loadDB();
    if (!db.balances[user]) db.balances[user] = 0;

    db.balances[user] += Number(amount);
    saveDB(db);

    res.json({ success: true, balance: db.balances[user] });
});

// ========================== TRANSACTIONS ==========================
app.get("/proxy/transactions", (req, res) => {
    const db = loadDB();
    res.json(db.transactions);
});

app.post("/proxy/recharge", (req, res) => {
    const { member, amount, currency } = req.body;
    const db = loadDB();

    db.transactions.push({
        type: "recharge",
        member,
        amount,
        currency,
        timestamp: new Date().toISOString()
    });

    saveDB(db);
    res.json({ success: true });
});

app.post("/proxy/withdraw", (req, res) => {
    const { member, amount, currency } = req.body;
    const db = loadDB();

    db.transactions.push({
        type: "withdraw",
        member,
        amount,
        currency,
        timestamp: new Date().toISOString()
    });

    saveDB(db);
    res.json({ success: true });
});

// ========================== Settings ==========================
app.get("/api/settings", (req, res) => {
    const db = loadDB();
    res.json(db.settings);
});

app.post("/api/settings", (req, res) => {
    const db = loadDB();
    db.settings = req.body;
    saveDB(db);

    res.json({ ok: true });
});

// ========================== Serve Frontend ==========================
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "dashboard-brand.html"));
});

// ========================== LISTEN ==========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
