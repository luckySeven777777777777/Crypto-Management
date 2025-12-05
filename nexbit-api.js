
// Unified API base
const API_BASE = "https://crypto-management-production-5e04.up.railway.app";

// Helper GET
async function apiGet(path) {
    const r = await fetch(API_BASE + path);
    return r.json();
}

// Helper POST
async function apiPost(path, data) {
    const r = await fetch(API_BASE + path, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify(data)
    });
    return r.json();
}

// ADMIN LOGIN
async function adminLogin(username, password) {
    return apiPost("/api/admin/login", { username, password });
}

// LIST USERS
async function loadUsers() {
    return apiGet("/api/admin/list-users");
}

// ORDERS SUMMARY
async function loadAllOrders() {
    return apiGet("/api/admin/orders");
}

// LIST BY TYPE
async function loadRecharge() {
    return apiGet("/api/order/recharge/list");
}
async function loadWithdraw() {
    return apiGet("/api/order/withdraw/list");
}
async function loadBuySell() {
    return apiGet("/api/order/buysell/list");
}

// ADMIN ACTION
async function adminOrderAction(type, orderId, action) {
    return apiPost("/api/admin/order/action", { type, orderId, action });
}

// USER BALANCE
async function getUserBalance(userid) {
    return apiGet("/api/balance?userid=" + userid);
}
