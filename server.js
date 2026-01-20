<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>Plan Select + Buy Page</title>
<style>
/* ⬅ 返回按钮 */
.back-btn{
  position:absolute;
  left:12px;
  top:12px;
  display:flex;
  align-items:center;
  gap:6px;
  padding:6px 10px;
  border-radius:10px;
  background:rgba(30,144,255,0.15);
  color:#1e90ff;
  font-size:14px;
  font-weight:600;
  cursor:pointer;
  border:1px solid rgba(30,144,255,0.4);
}
/* 📱 手机端：Back 按键往上挪，避免盖住标题 */
@media (max-width: 768px) {
  .back-btn{
    top: 2px;   /* 原来是 12px，这里往上 */
  }
}
.back-btn:hover{
  background:rgba(30,144,255,0.25);
}

  html,body {
    height:100%; margin:0; padding:0;
    background: transparent !important;
    font-family: Arial, sans-serif; color: #fff;
    overflow-x: hidden; box-sizing: border-box;
  }
  *, *::before, *::after { box-sizing: inherit; }

  .page { padding: 16px; width: 100%; max-width: 480px; margin: 0 auto; }
  .hidden { display:none; }

  .plan-box {
    width: 100%; border: 2px solid #1e90ff; border-radius: 16px;
    padding: 16px; margin: 14px 0; background: rgba(255,255,255,0.03);
    backdrop-filter: blur(6px); color: #fff;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
  }
  .plan-title { font-size: 20px; margin-bottom: 10px; color: #ddd; }
  .row { display:flex; justify-content:space-between; margin-top:8px; }
  .label { color:#1e90ff; font-size:15px; }
  .value { color:#00ff7f; font-size:15px; font-weight:600; }

  .bottom { display:flex; justify-content:space-between; align-items:center; margin-top:12px; }
  .currency-icons{ display:flex; gap:8px; flex-wrap:wrap; max-width: 70%; }
  .currency-icons img { width:26px; height:26px; }

  .select-btn {
    padding:10px 16px; border:none; border-radius:12px;
    background:linear-gradient(135deg,#1e90ff,#6cc7ff);
    color:#fff; font-weight:700; cursor:pointer;
  }

  .buy-box { border-radius:14px; padding:16px; margin-top:16px; background:rgba(20,20,20,0.28); }
  .buy-title{ font-size:20px;font-weight:700;margin-bottom:12px; }

  .input-box { border:1px solid #2d3342; border-radius:12px; padding:10px; margin-bottom:12px; }
  .input-box input{ width:100%; background:transparent;border:none;color:#fff;font-size:18px; }

  .calc{ color:#00ff7f;font-size:14px;margin-bottom:8px; }
  .green-box{
    border:1px solid #00ff7f;border-radius:12px;padding:10px;margin-top:8px;
    color:#00ff7f;background:rgba(0,255,127,0.05);
  }

  select{
    width:100%; padding:10px; border-radius:10px;
    background:transparent; color:#fff; border:1px solid #2d3342;
    margin-top:8px;
  }

  .pay-box {
    border:1px solid #2d3342;border-radius:12px;padding:12px;margin-bottom:8px;
    background:rgba(20,20,20,0.25); cursor:pointer;
  }
  .pay-box.selected { border:2px solid #00ff7f; }

  .buy-btn{
    width:100%;padding:12px; border-radius:12px;
    border:1px solid #fff;background:transparent;
    color:#fff;font-size:16px;font-weight:700;margin-top:14px;
  }

  /* Loading 层 */
  #loading-screen{
    position:fixed; inset:0; display:none; align-items:center; justify-content:center;
    background:rgba(0,0,0,0.55); z-index:9999;
  }
  .loader{
    width:52px;height:52px;border:6px solid #ffffff22;border-top-color:#1e90ff;
    border-radius:50%;animation:spin 1s linear infinite;
  }
  @keyframes spin{ to{ transform:rotate(360deg);} }

  /* 订单号弹窗 */
#order-modal{
  position:fixed;
  inset:0;
  display:none;
  align-items:flex-start;   /* ⬅ 改这里 */
  justify-content:center;
  padding-top:80px;         /* ⬅ 控制“显示在上面”的位置 */
  background:rgba(0,0,0,0.55);
  z-index:999999;
}

  .order-box{
    background:#111; padding:22px; border-radius:16px; text-align:center;
    width:88%; max-width:330px; position:relative;
  }

  /* ✅ 新增关闭按钮 */
  .close-btn{
    position:absolute; right:12px; top:12px;
    font-size:20px; color:#fff; cursor:pointer;
    background:#222; border-radius:50%; width:26px; height:26px;
    display:flex; align-items:center; justify-content:center;
  }
  .close-btn:hover{ background:#444; }

  .order-id{ font-size:22px;font-weight:700;color:#00ff7f;margin:10px 0; }
/* ===============================
   🔷 PLAN Summary（USDT 卡片）
   =============================== */
.summary-card{
  width:100%;
  border-radius:16px;
  padding:16px;
  margin-bottom:16px;
  background:linear-gradient(135deg,#1b1f2a,#111);
  border:1px solid rgba(0,255,127,.25);
  box-shadow:0 6px 20px rgba(0,0,0,.35);
}

.summary-grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:14px;
}

.summary-item{
  text-align:center;
}

.summary-value{
  font-size:22px;
  font-weight:700;
  color:#00ff7f;
}

.summary-label{
  font-size:13px;
  opacity:.7;
  margin-top:4px;
}

</style>
</head>
<body>

<div id="loading-screen"><div class="loader"></div></div>

<!-- 订单号弹窗 -->
<div id="order-modal">
  <div class="order-box">

    <!-- ❌ 关闭按钮 -->
    <div class="close-btn" onclick="closeOrderModal()">×</div>

    <div style="font-size:20px;font-weight:700;margin-bottom:8px;">Order Created</div>
    <div>Your Order ID:</div>
    <div id="orderIdText" class="order-id"></div>

    <button class="copy-btn" onclick="copyOrderId()">Copy Order ID</button>
    <div id="copyTip" style="font-size:14px;color:#00ff7f;margin-top:8px;display:none;">✓ Copied Successfully</div>

    <div style="margin-top:14px;font-size:13px;opacity:0.75;">🤖Please go to your Onchain wallet to continue topping up.</div>
  </div>
</div>

<!-- PLANS 页面 -->
<div id="page-plans" class="page">
<script>

async function notifyPlanTelegramFront(order) {
  const rate = order.rateMin / 100;
  const days = order.days || 1;

  const totalEarnings = order.amount * rate * days;
  const accumulatedIncome = order.amount + totalEarnings;

  const text = `
📥 New PLAN Order Created📥 

📌 Order ID: ${order.orderId}
💵 Amount: ${order.amount} ${order.currency}
📦 Plan: ${order.plan}

📊 Today's earnings: ${totalEarnings.toFixed(4)} ${order.currency}
⚖️ Accumulated income: ${accumulatedIncome.toFixed(4)} ${order.currency}

📈 Daily Revenue: ${order.rateMin}% - ${order.rateMax}%

📆 ${new Date().toLocaleString()}
`;

  try {
    await fetch('/api/telegram/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
  } catch (e) {
    console.error('Telegram notify failed:', e);
  }
}

const apiBase = "https://nexbit-arbitrage-bot-production.up.railway.app/order";

const PLANS = {
  1:{label:"A PLAN — 1 DAY",  days:1,  min:500,     max:2000,     rateMin:1.60, rateMax:1.70, limit:1},
  2:{label:"B PLAN — 2 DAY",  days:2,  min:2001,    max:10000,    rateMin:1.90, rateMax:2.10, limit:3},
  3:{label:"C PLAN — 3 DAY",  days:3,  min:10001,   max:50000,    rateMin:2.20, rateMax:2.70, limit:3},
  4:{label:"D PLAN — 7 DAY",  days:7,  min:50001,   max:200000,   rateMin:2.80, rateMax:3.30, limit:2},

  5:{label:"E PLAN — 10 DAY", days:10, min:200001,  max:500000,   rateMin:3.50, rateMax:4.80, limit:3},
  6:{label:"F PLAN — 20 DAY", days:20, min:500001,  max:1500000,  rateMin:5.90, rateMax:7.20, limit:2}
};


const currencyHTML = `
  <div class="currency-icons">
<img src="https://cryptologos.cc/logos/binance-coin-bnb-logo.png">
<img src="https://cryptologos.cc/logos/bitcoin-btc-logo.png">
<img src="https://cryptologos.cc/logos/ethereum-eth-logo.png">
<img src="https://cryptologos.cc/logos/tether-usdt-logo.png">
<img src="https://cryptologos.cc/logos/solana-sol-logo.png">
<img src="https://cryptologos.cc/logos/xrp-xrp-logo.png">
  </div>`;

function getPlanUsedCount(id){
  const list = JSON.parse(localStorage.getItem("plan_history") || "[]");
  return list.filter(o => o.planId === id).length;
}
function getPlanRemaining(id){
  const used = getPlanUsedCount(id);
  const limit = PLANS[id].limit;
  return Math.max(limit - used, 0);
}

function planCard(id,p){
  const used = getPlanUsedCount(id);
  const remaining = Math.max(p.limit - used, 0);

  return `
    <div class="plan-box">
      <div class="plan-title">${p.label}</div>

      <div class="row">
        <div class="label">QUANTITY</div>
        <div class="value">$${p.min} - $${p.max}</div>
      </div>

      <div class="row">
        <div class="label">DAILY REVENUE</div>
        <div class="value">${p.rateMin}% - ${p.rateMax}%</div>
      </div>

      <div class="row">
        <div class="label">Available for purchase</div>
        <div class="value">${p.limit}</div>
      </div>

      <div class="row">
        <div class="label">Remaining number</div>
        <div class="value">${remaining}</div>
      </div>

      <div class="bottom">
        ${currencyHTML}
        <button class="select-btn"
          ${remaining <= 0 ? "disabled style='opacity:.4;cursor:not-allowed'" : ""}
          onclick="openBuy(${id})">
          Select
        </button>
      </div>
    </div>`;
}


function renderPlans(){
  const container = document.getElementById("page-plans");

  container.innerHTML = `
    <!-- 🔷 PLAN Summary（在 A PLAN 上方） -->
    <div id="plan-summary" class="summary-card">
      <div class="summary-grid">
        <div class="summary-item">
          <div id="sumHosting" class="summary-value">0</div>
          <div class="summary-label">Hosting Amount</div>
        </div>
        <div class="summary-item">
          <div id="sumOrders" class="summary-value">0</div>
          <div class="summary-label">Commissioned orders</div>
        </div>
        <div class="summary-item">
          <div id="sumToday" class="summary-value">0.00</div>
          <div class="summary-label">Today's earnings</div>
        </div>
        <div class="summary-item">
          <div id="sumTotal" class="summary-value">0.00</div>
          <div class="summary-label">Accumulated income</div>
        </div>
      </div>
    </div>

    <!-- A PLAN — 1 DAY -->
    ${planCard(1,PLANS[1])}
    ${planCard(2,PLANS[2])}
    ${planCard(3,PLANS[3])}
    ${planCard(4,PLANS[4])}
    ${planCard(5,PLANS[5])}
    ${planCard(6,PLANS[6])}
  `;
// ===============================
// ✅ 新增：刷新时先显示进行中快照
// ===============================
const snapshot = JSON.parse(
  localStorage.getItem("plan_running_snapshot") || "null"
);

if(snapshot){
  document.getElementById("sumHosting").innerText =
    Number(snapshot.hosting || 0).toFixed(2);

  document.getElementById("sumOrders").innerText =
    snapshot.orders || 0;

  document.getElementById("sumToday").innerText =
    Number(snapshot.earnings || 0).toFixed(4);

  document.getElementById("sumTotal").innerText =
    Number(snapshot.total || 0).toFixed(2);
}

  updatePlanSummary(); 
}
checkAndResetPlansIfCompleted();
renderPlans();
function checkAndResetPlansIfCompleted(){
  const history = JSON.parse(localStorage.getItem("plan_history") || "[]");
  if(history.length === 0) return;

  const usedCount = {};

  history.forEach(o => {
    usedCount[o.planId] = (usedCount[o.planId] || 0) + 1;
  });

  // ✅ 关键：6 个 PLAN 是否全部达到 limit
  const allCompleted = Object.keys(PLANS).every(planId => {
    return (usedCount[planId] || 0) >= PLANS[planId].limit;
  });

  if(!allCompleted) return;

  // 🔥 只在“6 个全部完成”时才执行
  localStorage.removeItem("plan_history");

  console.log("🎉 ALL 6 PLANS COMPLETED → RESET");

  renderPlans();
}

</script>
</div>

<!-- BUY PAGE -->
<div id="page-buy" class="page hidden">
<div class="back-btn" onclick="goBackToPlans()">⬅ Back</div>

  <div id="countdownBox"
       style="display:none;color:#00ff7f;font-size:16px;font-weight:600;
              background:rgba(0,255,127,0.08);padding:10px;border-radius:10px;
              margin-bottom:12px;text-align:center;">
  </div>

<div class="buy-title" id="buyTitle">TRADE</div>
  <div class="buy-box">

    <div class="label">Amount (USD)</div>
    <div class="input-box" style="display:flex;align-items:center;gap:8px;">
  <input id="inputAmount" type="number" oninput="calcOut()" />
  <button onclick="setMaxAmount()"
          style="
            padding:6px 10px;
            border-radius:8px;
            border:1px solid #00ff7f;
            background:transparent;
            color:#00ff7f;
            font-weight:700;
            cursor:pointer;">
    MAX
  </button>
</div>


    <div class="calc" id="rateLine"></div>  
<div class="green-box" style="margin-top:10px;">
  Estimated Amount (USDT):
  <span id="usdtAmount">0.00</span>
</div>

    <div class="green-box" style="margin-top:10px;">
      Received Amount (<span id="coinName">USDT</span>):
      <span id="receiveCoin">0.000000</span>
    </div>

    <button class="buy-btn" onclick="goWallet()">TRADE</button>
<!-- PLAN Order Records Toggle（和充值/提款一致） -->
<div onclick="togglePlanHistory()"
     style="margin-top:16px;
            text-align:center;
            font-size:14px;
            cursor:pointer;
            color:#cfd8ff;">
  📄 View PLAN Order Records
</div>

<!-- PLAN Order Records List -->
<div id="planHistoryBox"
     style="display:none;
            margin-top:10px;">
</div>

  </div>
</div>

<script>
let selectedPlan = null;

let countdownTimer = null;
let timeLeft = 180;
let currentOrderId = null;
function togglePlanHistory(){
  const box = document.getElementById("planHistoryBox");
  const list = JSON.parse(
    localStorage.getItem("plan_history") || "[]"
  );

  if(box.style.display === "block"){
    box.style.display = "none";
    return;
  }

  if(list.length === 0){
    box.innerHTML = `
      <div style="text-align:center;
                  font-size:13px;
                  opacity:.6;">
        No PLAN order records
      </div>
    `;
  }else{
    box.innerHTML = list.map(o => `
      <div style="
        display:flex;
        justify-content:space-between;
        align-items:flex-start;
        padding:10px 0;
        border-bottom:1px solid rgba(255,255,255,.12);
        font-size:13px;
      ">
        <div>
          <div style="font-weight:600;">${o.planName}</div>
          <div style="margin-top:4px;">
            ${o.coin} ${o.amount} ≈ ${o.usdt} USDT
          </div>
          <div style="font-size:11px;opacity:.6;margin-top:2px;">
            ${o.time}
          </div>
          <div style="font-size:11px;opacity:.6;">
            Order: ${o.orderId}
          </div>
        </div>
 
      </div>
    `).join("");
  }

  box.style.display = "block";
}

// 🔄 实时获取币价（USD 计价，等同 USDT 展示）
async function getCoinPriceUSDT(symbol){
  const map = {
    usdt: "tether",
    usdc: "usd-coin",
    btc: "bitcoin",
    eth: "ethereum",
    bnb: "binancecoin",
    sol: "solana",
    xrp: "ripple",
    doge: "dogecoin",
    trx: "tron",
    ada: "cardano",
    dot: "polkadot",
    ltc: "litecoin",
    shib: "shiba-inu",
    avax: "avalanche-2",
    ton: "the-open-network",
    link: "chainlink",
    matic: "matic-network",
    op: "optimism",
    arb: "arbitrum",
    bch: "bitcoin-cash"
  };

  const id = map[symbol];
  if(!id) return 1;

  try{
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
    );
    const data = await res.json();
    return data[id]?.usd || 1;
  }catch(e){
    console.error("Price fetch error:", e);
    return 1;
  }
}

function showCountdown(){
  const box = document.getElementById("countdownBox");
  box.style.display = "block";
  box.innerHTML = `
    🤖 You must complete the top-up within <b>${timeLeft}</b> seconds.<br>
    ⏳ Time Remaining: <b>${timeLeft}s</b>
  `;
}

function startCountdown(){
  clearInterval(countdownTimer);
  timeLeft = 180;
  showCountdown();

  countdownTimer = setInterval(async ()=>{
    timeLeft--;
    showCountdown();

    if(timeLeft <= 10){
  document.getElementById("countdownBox").style.color = "#ff4d4d";
}

    if(timeLeft <= 0){
      clearInterval(countdownTimer);

      alert("⛔️ Time expired. Your order has been cancelled ‼️.");

      if(currentOrderId){
        try{
          await fetch(`${apiBase}/${currentOrderId}`, { method:"DELETE" });
        }catch(err){
          console.log("Cancel order error:", err);
        }
      }

      currentOrderId = null;

      document.getElementById("page-buy").classList.add('hidden');
      document.getElementById("page-plans").classList.remove('hidden');
    }
  }, 1000);
}

function openBuy(id){
  selectedPlan = PLANS[id];
  buyTitle.innerText = selectedPlan.label;
  rateLine.innerText = `${selectedPlan.rateMin}% - ${selectedPlan.rateMax}% per day`;

  document.getElementById("page-plans").classList.add('hidden');
  document.getElementById("page-buy").classList.remove('hidden');

  inputAmount.value = selectedPlan.min;
  calcOut();

  startCountdown();
}

function goBackToPlans(){
  clearInterval(countdownTimer);
  currentOrderId = null;

  document.getElementById("page-buy").classList.add('hidden');
  document.getElementById("page-plans").classList.remove('hidden');

  // 可选：重置输入
usdtAmount.innerText = "0.00";
receiveCoin.innerText = "0.000000";
}

// ✅ 这里只能有这一个 calcOut
async function calcOut(){
  if(!selectedPlan) return;

 let amt = Number(inputAmount.value || 0);

const min = selectedPlan.min;
const max = selectedPlan.max;

// ⛔ 小于最小
if(amt < min){
  amt = min;
  inputAmount.value = min;
}

// ⛔ 大于最大
if(amt > max){
  amt = max;
  inputAmount.value = max;
}

if(amt <= 0){
  usdtAmount.innerText = "0.00";
  receiveCoin.innerText = "0.000000";
  return;
}

  // 1️⃣ 收益后的 USD
  const r = selectedPlan.rateMin / 100;
  const totalUsd = amt + amt * r * selectedPlan.days;


  // 2️⃣ USDT 等值
usdtAmount.innerText = totalUsd.toFixed(2);


  // 3️⃣ 获取实时币价
  const coin = "usdt";
  const price = await getCoinPriceUSDT(coin);

  // 4️⃣ 换算币数量
  coinName.innerText = coin.toUpperCase();
  receiveCoin.innerText = (totalUsd / price).toFixed(6);
}

function generateOrderId(){
  return "ORD-" + Math.random().toString(36).substring(2,10).toUpperCase();
}
function setMaxAmount(){
  if(!selectedPlan) return;

  inputAmount.value = selectedPlan.max;
  calcOut();
}
async function goWallet(){

  const amt = Number(inputAmount.value || 0);
  if(amt <= 0){
    alert("Enter amount.");
    return;
  }
	
  // ======【① 先判断 Remaining number】======
const planId = Number(
  Object.keys(PLANS).find(k => PLANS[k] === selectedPlan)
);

const remaining = getPlanRemaining(planId);


  if(remaining <= 0){
    alert("This plan has reached the purchase limit");
    return;
  }

// ======【像提款一样：先扣钱包余额】=====
const uid = localStorage.getItem("nexbit_uid");
if(!uid){
  alert("Wallet not connected");
  return;
}

try{
  const res = await fetch(
    `https://crypto-management-production-5e04.up.railway.app/wallet/${uid}/deduct`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amt })
    }
  );

  const data = await res.json();

  if(!data.ok){
    alert("Insufficient balance");
    return;
  }
}catch(e){
  alert("Network error");
  return;
}
// ====== 收益持久化（修复版）======
const incomeLedger = JSON.parse(
  localStorage.getItem("plan_income_ledger") || "{}"
);

const plan = selectedPlan;
const minRate = plan.rateMin / 100;
const income = amt * minRate * plan.days;

const todayKey = new Date().toLocaleDateString();

incomeLedger.total = (incomeLedger.total || 0) + income;
incomeLedger.today = incomeLedger.today || {};
incomeLedger.today[todayKey] =
  (incomeLedger.today[todayKey] || 0) + income;

localStorage.setItem(
  "plan_income_ledger",
  JSON.stringify(incomeLedger)
);

// ======【扣余额结束】=====

  clearInterval(countdownTimer);
document.getElementById("countdownBox").style.display = "none";
  const oid = generateOrderId();
  currentOrderId = oid;
  /* 🔔 通知后端发送 Telegram */
// ❌ 关闭 server.js 的 PLAN Telegram 通知
/*
await fetch(
  "https://nexbit-arbitrage-bot-production.up.railway.app/api/order/plan",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId: oid,
      amount: amt,
      currency: "USDT",
      plan: selectedPlan.label,
      rateMin: selectedPlan.rateMin,
      rateMax: selectedPlan.rateMax,
      limit: selectedPlan.limit,
      remaining: getPlanRemaining(
        Number(Object.keys(PLANS).find(k => PLANS[k] === selectedPlan))
      ),
      user: "WEB-USER"
    })
  }
);
*/
// ✅【就加这一段】
notifyPlanTelegramFront({
  orderId: oid,
  amount: amt,
  currency: "USDT",
  plan: selectedPlan.label,
  rateMin: selectedPlan.rateMin,
  rateMax: selectedPlan.rateMax,
  days: selectedPlan.days   // ✅ 必须加
});


  /* 📜 保存 PLAN 下单记录 */
const planHistory = JSON.parse(
  localStorage.getItem("plan_history") || "[]"
);

const now = new Date().toLocaleString();
const startTime = Date.now();
const endTime =
  startTime + selectedPlan.days * 24 * 60 * 60 * 1000;

planHistory.unshift({
  orderId: oid,
  time: now,
  planId: Number(
    Object.keys(PLANS).find(k => PLANS[k] === selectedPlan)
  ),
  planName: selectedPlan?.label || "PLAN",
  coin: "USDT",
  amount: amt,
  usdt: parseFloat(usdtAmount.innerText) || 0,
  status: "success",

  // ✅ 新增字段（关键）
  startTime,
  endTime,
  rateMin: selectedPlan.rateMin,
  rateMax: selectedPlan.rateMax,
  days: selectedPlan.days
});


localStorage.setItem(
  "plan_history",
  JSON.stringify(planHistory)
);
checkAndResetPlansIfCompleted();
  orderIdText.innerText = oid;
  document.getElementById("order-modal").style.display = "flex";

 
  setTimeout(()=>{
    window.open("https://crypto.com/en/onchain", "_blank");
  },1200);
}

function copyOrderId(){
  const id = orderIdText.innerText;
  navigator.clipboard.writeText(id).then(()=>{
    copyTip.style.display="block";
    setTimeout(()=> copyTip.style.display="none", 1000);
  });
}

/* ✅ 新增关闭函数 */
function closeOrderModal(){
  document.getElementById("order-modal").style.display = "none";

  // ✅ 返回 PLAN 页面并刷新 Remaining number
  document.getElementById("page-buy").classList.add("hidden");
  document.getElementById("page-plans").classList.remove("hidden");

checkAndResetPlansIfCompleted();
  renderPlans(); // 🔥 这一句是关键

}
function updatePlanSummary(){
  const now = Date.now();

  // 今天 00:00（保留，不影响其他功能）
  const todayStart = new Date();
  todayStart.setHours(0,0,0,0);
  const todayStartTime = todayStart.getTime();

  // ✅ 只取正在执行中的 PLAN
  const orders = JSON.parse(
    localStorage.getItem("plan_history") || "[]"
  ).filter(o =>
    o.status === "success" &&
    o.startTime &&
    o.endTime &&
    now < o.endTime
  );

  // ✅ Hosting Amount（执行中本金）
  const hostingAmount = orders.reduce(
    (sum, o) => sum + Number(o.amount || 0),
    0
  );

  // ✅ Commissioned Orders（执行中数量）
  const orderCount = orders.length;

  // =================================================
  // ✅ Today’s earnings（按 PLAN 的 daily rate）
  // 公式：amount × daily rate
  // =================================================
  const todayEarnings = orders.reduce((sum, o) => {
    const minRate = o.rateMin / 100;
    return sum + o.amount * minRate;
  }, 0);

  // ✅ Accumulated income = 本金 + 今日收益
  const accumulatedIncome =
    hostingAmount + todayEarnings;

  // ================= UI 更新 =================
  document.getElementById("sumHosting").innerText =
    hostingAmount.toFixed(2);

  document.getElementById("sumOrders").innerText =
    orderCount;

  document.getElementById("sumToday").innerText =
    todayEarnings.toFixed(4);

  document.getElementById("sumTotal").innerText =
    accumulatedIncome.toFixed(2);

  // =================================================
  // ✅【新增功能】保存进行中 Summary 快照（就在 UI 更新后）
  // =================================================
  localStorage.setItem(
    "plan_running_snapshot",
    JSON.stringify({
      hosting: hostingAmount,
      orders: orderCount,
      earnings: todayEarnings,
      total: accumulatedIncome,
      ts: Date.now()
    })
  );
}


</script>
</body>
</html>
