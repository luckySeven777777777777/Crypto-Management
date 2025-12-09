// public/js/table.js
// 简单表格渲染器 & helpers

window.renderRows = function(containerSelector, rowsHtml){
  const el = document.querySelector(containerSelector);
  if(!el) return;
  el.innerHTML = rowsHtml;
  // attach clickable ids (if exist)
  el.querySelectorAll('.order-id').forEach(div=>{
    div.style.cursor='pointer';
    div.onclick = async ()=>{
      const id = div.innerText.trim();
      // open detail modal if present
      if(window.openOrderDetail) {
        const j = await fetch('/api/transactions?fetchOrder=' + encodeURIComponent(id)).then(r=>r.json()).catch(()=>({ok:false}));
        if(j.ok && j.order) window.openOrderDetail(j.order);
        else window.openOrderDetail({ orderId: id });
      }
    };
  });
};

// helper to show loading/error
window.setTableLoading = function(selector, colspan, text='加载中...'){
  const el = document.querySelector(selector);
  if(el) el.innerHTML = `<tr><td colspan="${colspan}">${text}</td></tr>`;
};
