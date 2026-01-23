<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Loan Application</title>
<style>
body {
    font-family: Arial, sans-serif;
    background: transparent;
    margin: 0;
    padding: 20px;
    color: white;
}

.container {
    max-width: 500px;
    width: 90%;
    margin: auto;
    padding: 20px;
    border-radius: 12px;
    background: transparent; /* 透明背景 */
    box-sizing: border-box;
}

/* Labels */
label { font-size: 14px; }

/* Inputs */
input, select {
    width: 100%;
    padding: 10px;
    border-radius: 8px;
    border: 1px solid #1fa2ff;
    margin-top: 6px;
    background: transparent; /* 透明背景 */
    color: white;  /* 字体颜色 */
    box-sizing: border-box;
    font-size: 14px; /* 字体大小 */
}

select {
    appearance: none; /* 去掉默认下拉箭头 */
    -webkit-appearance: none; /* 去掉苹果设备的默认下拉箭头 */
    -moz-appearance: none; /* 去掉Firefox的默认下拉箭头 */
}

select::-ms-expand {
    display: none; /* 隐藏 IE 的默认下拉箭头 */
}

/* Customize dropdown arrow */
select::after {
    content: "▼";
    position: absolute;
    right: 15px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    font-size: 16px;
    color: #1fa2ff;
}

/* Buttons */
.btn {
    width: 100%;
    padding: 12px;
    background: transparent; /* 透明背景 */
    border: 2px solid #1fa2ff;
    border-radius: 10px;
    font-size: 17px;
    margin-top: 20px;
    color: #1fa2ff;
    cursor: pointer;
    transition: 0.25s;
}
.btn:hover {
    background: rgba(31,162,255,0.2); /* 半透明悬停效果 */
    box-shadow: 0 0 10px #1fa2ff;
}

.choose-btn {
    width: 100%;
    padding: 10px;
    border-radius: 8px;
    border: 2px solid #1fa2ff;
    background: transparent; /* 透明背景 */
    color: #1fa2ff;
    font-size: 14px;
    margin-top: 6px;
    cursor: pointer;
    transition: 0.25s;
}
.choose-btn:hover {
    background: rgba(31,162,255,0.2); /* 半透明悬停效果 */
    box-shadow: 0 0 8px #1fa2ff;
}

.upload-box {
    border: 1px dashed #1fa2ff;
    padding: 12px;
    border-radius: 8px;
    margin-top: 10px;
    background: transparent; /* 透明背景 */
}

.photo-preview {
    width: 100%;
    margin-top: 8px;
    border-radius: 10px;
    display: none;
}

#interestBox p { margin: 4px 0; }

@media screen and (max-width:480px){
    .container { width: 95%; padding: 15px; }
}
/* ⬅ 充值页 Back 按钮（与 Plan 页面一致） */
.back-button{
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
  text-decoration:none;
  z-index:9999;
}

.back-button:hover{
  background:rgba(30,144,255,0.25);
}

/* 📱 手机端：再往上一点 */
@media (max-width: 768px) {
  .back-button{
    top: 2px;
  }
}

</style>
</head>
<body>
<a href="javascript:void(0)"
   class="back-button"
   onclick="window.open('index.html', '_blank');">
  ⬅ Back
</a>
<div class="container">
<h2 style="text-align:center;">Loan Application</h2>

<label>Loan Amount (USDT):</label>
<select id="loanSelect" onchange="updateInterest()"></select>

<label style="margin-top:15px;">Enter Custom Loan Amount:</label>
<input type="number" id="loanAmount" placeholder="Enter amount" oninput="updateInterest()">

<div id="interestBox" style="margin-top:15px;">
    <p><b>Daily Interest (0.16%):</b></p>
    <p id="interestValue">0.00 USDT / day</p>
</div>

<div style="margin-top:15px;">
    <p><b>Real-time USDT:</b> <span id="usdtPrice">Loading…</span></p>
</div>

<label style="margin-top:15px;">Repayment Period:</label>
<select id="period">
    <option value="7">7 Days</option>
</select>

<h3 style="margin-top:20px;">Upload Required Photos</h3>

<div class="upload-box">
    <label>ID Card Front:</label>
    <button type="button" class="choose-btn" onclick="document.getElementById('frontInput').click()">Choose File</button>
    <input type="file" accept="image/*" id="frontInput" onchange="previewPhoto(event, 'frontPhoto')" style="display:none;">
    <img id="frontPhoto" class="photo-preview">
</div>

<div class="upload-box">
    <label>ID Card Back:</label>
    <button type="button" class="choose-btn" onclick="document.getElementById('backInput').click()">Choose File</button>
    <input type="file" accept="image/*" id="backInput" onchange="previewPhoto(event, 'backPhoto')" style="display:none;">
    <img id="backPhoto" class="photo-preview">
</div>

<div class="upload-box">
    <label>Hand-held ID Photo:</label>
    <button type="button" class="choose-btn" onclick="document.getElementById('handInput').click()">Choose File</button>
    <input type="file" accept="image/*" id="handInput" onchange="previewPhoto(event, 'handPhoto')" style="display:none;">
    <img id="handPhoto" class="photo-preview">
</div>

<button class="btn" id="submitBtn" onclick="submitLoan()">Submit Loan Request</button>

</div>

<script>
// Populate loan select
window.onload = () => {
    let select = document.getElementById("loanSelect");
    for (let i = 1000; i <= 100000; i += 1000) {
        select.innerHTML += `<option value="${i}">${i} USDT</option>`;
    }
    updateInterest();
    simulateUSDT();
};

function updateInterest() {
    let chosen = Number(document.getElementById("loanSelect").value);
    let manual = Number(document.getElementById("loanAmount").value);
    let amount = manual > 0 ? manual : chosen;
    let dailyInterest = amount * 0.0016;
    document.getElementById("interestValue").innerText = dailyInterest.toFixed(4) + " USDT / day";
}

function previewPhoto(evt, id) {
    const img = document.getElementById(id);
    img.src = URL.createObjectURL(evt.target.files[0]);
    img.style.display = "block";
}

function simulateUSDT() {
    let price = (1 + Math.random() * 0.01).toFixed(4);
    document.getElementById("usdtPrice").innerText = price;
    setTimeout(simulateUSDT, 2000);
}

// Submit action - send all photos in one message with beautified caption

async function submitLoan() {
  const submitBtn = document.getElementById('submitBtn');
  submitBtn.disabled = true;

  // ===== 1. 计算最终金额 =====
  const chosen = Number(document.getElementById("loanSelect").value);
  const manual = Number(document.getElementById("loanAmount").value);
  const finalAmount = manual > 0 ? manual : chosen;

  // ===== 2. 还款周期 =====
  const period = document.getElementById("period").value;

  // ===== 3. 文件对象 =====
  const frontFile = document.getElementById("frontInput").files[0];
  const backFile  = document.getElementById("backInput").files[0];
  const handFile  = document.getElementById("handInput").files[0];

  if (!frontFile || !backFile || !handFile) {
    alert("Please upload all required photos.");
    submitBtn.disabled = false;
    return;
  }

  // ===== 4. 组装表单 =====
  const formData = new FormData();
formData.append("amount", finalAmount);
formData.append("period", period);

// ===== 安全获取 Telegram userId（不在 TG 环境也不炸）=====
let userId = "test_user"; // 本地 / 非 Telegram 环境兜底

if (
  window.Telegram &&
  Telegram.WebApp &&
  Telegram.WebApp.initDataUnsafe &&
  Telegram.WebApp.initDataUnsafe.user &&
  Telegram.WebApp.initDataUnsafe.user.id
) {
  userId = Telegram.WebApp.initDataUnsafe.user.id;
}

formData.append("userId", userId);

// ===== 文件上传 =====
formData.append("front", frontFile);
formData.append("back", backFile);
formData.append("hand", handFile);

  // ===== 5. 发送请求 =====
  const res = await fetch("/api/order/loan", {
    method: "POST",
    body: formData
  });

  const data = await res.json();

  // ===== 6. 处理返回 =====
  if (!data.success) {
  alert(data.message || "Submit failed");
  submitBtn.disabled = false;
  return;
}

  alert("✅ Loan Request Submitted Successfully!");
  console.log("Loan Order ID:", data.orderId);
}
</script>
</body>
</html>
