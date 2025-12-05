// nexbit-api.js - Final Version (Match server.js)

// ------------------ 配置 ------------------
const BASE_URL = "https://crypto-management-production-5e04.up.railway.app";

// GET 工具函数
async function apiGet(path) {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url);
    return res.json();
}

// POST 工具函数
async function apiPost(path, data) {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data || {})
    });
    return res.json();
}

// ------------------ 核心 API ------------------

// 1) 用户同步（Strikingly）
function apiSyncUser(userId) {
    return apiPost("/api/user/sync", { userId });
}

// 2) 获取余额
function apiGetBalance(userId) {
    return apiGet(`/api/balance?userId=${encodeURIComponent(userId)}`);
}

// 3) 修改余额（后台充值扣款）
function apiUpdateBalance(userId, amount) {
    return apiPost("/api/balance", { userId, amount });
}

// 4) 获取交易记录（后台）
function apiGetTransactions(params = {}) {
    const query = new URLSearchParams(params).toString();
    return apiGet(`/proxy/transactions?${query}`);
}

// 5) 充值
function apiRecharge(data) {
    return apiPost("/proxy/recharge", data);
}

// 6) 提款
function apiWithdraw(data) {
    return apiPost("/proxy/withdraw", data);
}

// 7) 读取后台设置
function apiGetSettings() {
    return apiGet("/api/settings");
}

// 8) 保存后台设置
function apiSaveSettings(data) {
    return apiPost("/api/settings", data);
}

// 9) 后台管理员登录
function apiAdminLogin(user, pass) {
    return apiPost("/api/admin/login", { user, pass });
}

// 10) 修改登录密码
function apiChangeLoginPassword(oldPassword, newPassword) {
    return apiPost("/api/change-login-password", { oldPassword, newPassword });
}

// 11) 修改提款密码
function apiChangeWithdrawPassword(oldPassword, newPassword) {
    return apiPost("/api/change-withdraw-password", { oldPassword, newPassword });
}
