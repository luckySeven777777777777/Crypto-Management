// orders.js

async function loadOrderDetail() {
    const params = new URLSearchParams(location.search);
    const orderId = params.get("orderId");

    if (!orderId) {
        document.getElementById("orderInfo").innerHTML =
            "<p>No orderId.</p>";
        return;
    }

    document.getElementById("orderIdTitle").innerText = orderId;

    const res = await fetch(`/api/transactions?fetchOrder=${orderId}`);
    const data = await res.json();

    if (!data.ok) {
        document.getElementById("orderInfo").innerHTML =
            `<p>Order not found.</p>`;
        return;
    }

    const o = data.order;
    const events = data.orderEvents || [];

    document.getElementById("orderInfo").innerHTML = `
        <p><b>Order ID:</b> ${o.orderId}</p>
        <p><b>User:</b> ${o.userId}</p>
        <p><b>Amount:</b> ${o.amount}</p>
        <p><b>Coin:</b> ${o.coin || "-"}</p>
        <p><b>Status:</b> ${o.status}</p>
        <p><b>Note:</b> ${o.note || "-"}</p>
    `;

    const tbody = document.querySelector("#orderEvents tbody");
    tbody.innerHTML = "";

    events.forEach(e => {
        tbody.innerHTML += `
            <tr>
                <td>${formatTime(e.time)}</td>
                <td>${e.admin || "-"}</td>
                <td>${e.status}</td>
                <td>${e.note || "-"}</td>
            </tr>
        `;
    });
}

document.addEventListener("DOMContentLoaded", loadOrderDetail);
