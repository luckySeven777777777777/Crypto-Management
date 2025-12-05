/* ==================================================
   NEXBIT 通用 API 文件（全站通用，不修改 UI）
   用途：所有前端页面统一通过这里调用后台
   ================================================== */

const API_BASE = "https://crypto-management-production-5e04.up.railway.app";

/* -------------- 基础 GET 封装 -------------- */
async function nexGet(path) {
    try {
        const res = await fetch(API_BASE + path, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "X-User-Id": window.NEXBIT_USER_ID || ""
            }
        });
        return await res.json();
    } catch (err) {
        console.error("GET ERROR:", err);
        return { ok: false, error: "network error" };
    }
}

/* -------------- 基础 POST 封装 -------------- */
async function nexPost(path, data = {}) {
    try {
        const res = await fetch(API_BASE + path, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-User-Id": window.NEXBIT_USER_ID || ""
            },
            body: JSON.stringify(data)
        });
        return await res.json();
    } catch (err) {
        console.error("POST ERROR:", err);
        return { ok: false, error: "network error" };
    }
}

/* -------------- 获取用户余额 -------------- */
async function getNexBalance() {
    return await nexGet(`/api/balance?userid=${window.NEXBIT_USER_ID}`);
}

/* -------------- 充值 -------------- */
async function nexRecharge(data) {
    return await nexPost("/api/order/recharge", data);
}

/* -------------- 提款 -------------- */
async function nexWithdraw(data) {
    return await nexPost("/api/order/withdraw", data);
}

/* -------------- BuySell 交易 -------------- */
async function nexBuySell(data) {
    return await nexPost("/api/order/buysell", data);
}

/* -------------- （后续管理后台需要）订单操作 -------------- */
async function nexOrderAction(type, orderId, action) {
    return await nexPost("/api/admin/order/action", {
        type,
        orderId,
        action
    });
}
