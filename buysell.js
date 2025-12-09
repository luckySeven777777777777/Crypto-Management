// buysell.js

async function loadBuySellPage() {
    const tbody = document.querySelector("#tblBuySell tbody");
    tbody.innerHTML = "<tr><td colspan='8'>Loading...</td></tr>";

    const list = await loadBuySell();

    tbody.innerHTML = "";

    list.forEach(o => {
        tbody.innerHTML += `
            <tr>
                <td>${o.orderId}</td>
                <td>${formatTime(o.time)}</td>
                <td>${o.type}</td>
                <td>${o.amount}</td>
                <td>${o.coin}</td>
                <td>${o.converted || "-"}</td>
                <td>${o.side}</td>
                <td>${o.status}</td>
            </tr>
        `;
    });
}

document.addEventListener("DOMContentLoaded", loadBuySellPage);

// 关键修复：避免覆盖其他 SSE 监听
if (!window._buysellEventAdded) {
    window._buysellEventAdded = true;
    window.addEventListener("orderEvent", loadBuySellPage);
}
