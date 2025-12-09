// recharge.js

async function loadRechargePage() {
    const tbody = document.querySelector("#tblRecharge tbody");
    tbody.innerHTML = "<tr><td colspan='8'>Loading...</td></tr>";

    const list = await loadRecharge(); // 来自 nexbit-api.js

    tbody.innerHTML = "";

    list.forEach(o => {
        tbody.innerHTML += `
            <tr>
                <td><a href="order-list.html?orderId=${o.orderId}">${o.orderId}</a></td>
                <td>${formatTime(o.time)}</td>
                <td>${o.amount}</td>
                <td>${o.coin || "-"}</td>
                <td>${o.wallet || "-"}</td>
                <td>${o.ip || "-"}</td>
                <td>${o.status}</td>
                <td>${o.note || "-"}</td>
            </tr>
        `;
    });
}

document.addEventListener("DOMContentLoaded", loadRechargePage);

// SSE 自动刷新
window.onOrderEvent = function () {
    loadRechargePage();
};
