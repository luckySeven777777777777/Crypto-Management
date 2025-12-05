// =======================
// NEXBIT ADMIN API CLIENT
// =======================

const API_BASE = ""; 
// 留空表示走当前服务器的 /api、/proxy 路径
// 例如：https://your-railway-url.up.railway.app/api/login


// ======================= 登录 =======================

async function login(username, password) {
    const res = await fetch(API_BASE + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
    });
    return res.json();
}


// ======================= 管理员列表 =======================

async function getAdmins() {
    const res = await fetch(API_BASE + "/api/admins");
    return res.json();
}

async function addAdmin(username, passwordHash) {
    const res = await fetch(API_BASE + "/api/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, passwordHash })
    });
    return res.json();
}

async function deleteAdmin(username) {
    const res = await fetch(API_BASE + "/api/admins/" + username, {
        method: "DELETE"
    });
    return res.json();
}


// ======================= 用户余额 =======================

async function getBalance(user) {
    const res = await fetch(API_BASE + "/api/balance/" + user);
    return res.json();
}

async function updateBalance(user, amount) { 
    // amount 可以是正数（充值）或负数（扣款）
    const res = await fetch(API_BASE + "/api/balance/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, amount })
    });
    return res.json();
}


// ======================= 交易记录 =======================

async function getTransactions() {
    const res = await fetch(API_BASE + "/proxy/transactions");
    return res.json();
}

async function recharge(member, amount, currency) {
    const res = await fetch(API_BASE + "/proxy/recharge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member, amount, currency })
    });
    return res.json();
}

async function withdraw(member, amount, currency) {
    const res = await fetch(API_BASE + "/proxy/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member, amount, currency })
    });
    return res.json();
}


// ======================= 设置 Setting =======================

async function getSettings() {
    const res = await fetch(API_BASE + "/api/settings");
    return res.json();
}

async function saveSettings(obj) {
    const res = await fetch(API_BASE + "/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(obj)
    });
    return res.json();
}


// ======================= LOGOUT =======================

function logout() {
    window.location.href = "logout.html";
}
