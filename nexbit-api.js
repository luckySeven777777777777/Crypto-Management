// ==========================================
// 🚀 Nexbit API – Railway Production Version
// ==========================================

// 你的 Railway 后端
const API_BASE = "https://crypto-management-production-5e04.up.railway.app";


// ------------------------------
// 基础 GET 封装
// ------------------------------
async function apiGet(path) {
    const res = await fetch(API_BASE + path);
    return res.json();
}


// ------------------------------
// 基础 POST 封装
// ------------------------------
async function apiPost(path, data) {
    const res = await fetch(API_BASE + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    });
    return res.json();
}



// ==========================================
// 🔐 1) 管理后台 – 登录
// ==========================================
async function adminLogin(username, password) {
    return apiPost("/api/admin/login", { username, password });
}



// ==========================================
// 👤 2) 管理后台 – 用户列表
// ==========================================
async function loadUsers() {
    return apiGet("/api/admin/list-users");
}



// ==========================================
// 📦 3) 管理后台 – 所有订单汇总
// ==========================================
async function loadAllOrders() {
    return apiGet("/api/admin/orders");
}



// ==========================================
// 💰 4) 管理后台 – 各类型订单列表
// ==========================================

// 充值列表
async function loadRecharge() {
    return apiGet("/api/order/recharge/list");
}

// 提款列表
async function loadWithdraw() {
    return apiGet("/api/order/withdraw/list");
}

// 买卖列表
async function loadBuySell() {
    return apiGet("/api/order/buysell/list");
}



// ==========================================
// 🛠️ 5) 管理后台 – 操作订单
// ==========================================
// type = recharge / withdraw / buysell
// action = approve / reject / complete 等
// orderId = 订单编号
async function adminOrderAction(type, orderId, action) {
    return apiPost("/api/admin/order/action", { type, orderId, action });
}



// ==========================================
// 🔄 6) 用户端 – 查询余额
// ==========================================
async function getUserBalance(userid) {
    return apiGet("/api/balance?userid=" + userid);
}



// ==========================================
// 🟢 7) 用户端 – 提交订单（你的前端会用到）
// ==========================================

// 创建提款订单
async function createWithdrawOrder(data) {
    return apiPost("/api/order/withdraw", data);
}

// 创建买卖订单
async function createBuySellOrder(data) {
    return apiPost("/api/order/buysell", data);
}

// 创建充值订单（如需）
async function createRechargeOrder(data) {
    return apiPost("/api/order/recharge", data);
}
