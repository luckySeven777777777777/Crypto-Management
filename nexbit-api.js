// public/js/nexbit-api.js
// 与 server.js 完全匹配的前端 API 封装（覆盖原文件）
// 注意：BASE_URL 设为你的 Railway 部署域名

const BASE_URL = "https://crypto-management-production-5e04.up.railway.app";

async function apiGet(path) {
  const res = await fetch(`${BASE_URL}${path}`, { credentials: 'omit' });
  return res.json();
}

async function apiPost(path, data) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data || {})
  });
  return res.json();
}

// 高级接口
function apiSyncUser(userId) { return apiPost('/api/user/sync', { userId }); }
function apiGetBalance(userId) { return apiGet(`/api/balance?userId=${encodeURIComponent(userId)}`); }
function apiUpdateBalance(userId, amount) { return apiPost('/api/balance', { userId, amount }); }
function apiGetTransactions(params = {}) { const q = new URLSearchParams(params).toString(); return apiGet(`/proxy/transactions?${q}`); }
function apiRecharge(data) { return apiPost('/proxy/recharge', data); }
function apiWithdraw(data) { return apiPost('/proxy/withdraw', data); }
function apiUpdateTransactionStatus(transactionId, status) { return apiPost('/proxy/transaction/update', { transactionId, status }); }
function apiGetSettings() { return apiGet('/api/settings'); }
function apiSaveSettings(data) { return apiPost('/api/settings', data); }
function apiListUsers() { return apiGet('/api/list-users'); }
function apiAdminLogin(user, pass) { return apiPost('/api/admin/login', { user, pass }); }
