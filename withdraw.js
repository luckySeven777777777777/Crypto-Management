// withdraw.js

async function loadWithdrawPage() {
    const tbody = document.querySelector("#tblWithdraw tbody");
    tbody.innerHTML = "<tr><td colspan='8'>Loading...</td></tr>";

    const list = await loadWithdraw();

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

document.addEventListener("DOMContentLoaded", loadWithdrawPage);

// 关键修复：避免覆盖其他文件的 SSE 监听
if (!window._withdrawEventAdded) {
    window._withdrawEventAdded = true;
    window.addEventListener("orderEvent", loadWithdrawPage);
}
