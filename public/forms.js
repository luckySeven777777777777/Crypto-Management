// public/js/forms.js
// 通用表单提交：buy/sell/recharge/withdraw （使用 fetch）

window.submitBuySell = async function(payload){
  try{
    const res = await fetch('/api/order/buysell', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const j = await res.json();
    return j;
  }catch(e){ return { ok:false, error: e.message }; }
};

window.submitRecharge = async function(payload){
  try{
    const res = await fetch('/api/order/recharge', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    return await res.json();
  }catch(e){ return { ok:false, error: e.message }; }
};

window.submitWithdraw = async function(payload){
  try{
    const res = await fetch('/api/order/withdraw', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    return await res.json();
  }catch(e){ return { ok:false, error: e.message }; }
};

// handy admin action wrapper
window.adminTxAction = async function(type, orderId, status, token){
  try {
    const res = await fetch('/api/transaction/update', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization': (token ? 'Bearer ' + token : '') },
      body: JSON.stringify({ type, orderId, status })
    });
    return await res.json();
  } catch(e){ return { ok:false, error: e.message }; }
};
