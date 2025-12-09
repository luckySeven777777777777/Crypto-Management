// dashboard.js
// 后台首页 Dashboard

async function loadDashboard() {
    try {
        const res = await fetch("/api/transactions");
        const data = await res.json();

        if (!data.ok) return;

        document.getElementById("statUsers").innerText =
            Object.keys(data.users).length;

        document.getElementById("statRecharge").innerText =
            data.recharge.length;

        document.getElementById("statWithdraw").innerText =
            data.withdraw.length;

        document.getElementById("statBuySell").innerText =
            data.buysell.length;

        document.getElementById("statOrders").innerText =
            data.stats.todayOrders;

    } catch (err) {
        console.error("dashboard load error:", err);
    }
}

document.addEventListener("DOMContentLoaded", loadDashboard);
