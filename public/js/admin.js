(function(){
const API = '';
function el(id){ return document.getElementById(id); }
function authHeaders(){ const t = localStorage.getItem('nexbit_admin_token'); return t?{'Content-Type':'application/json','Authorization':'Bearer '+t}:{'Content-Type':'application/json'}; }

async function loadAdmins(){
  try{
    const r = await fetch('/api/admin/list', { headers: authHeaders() });
    const j = await r.json();
    const tbody = document.querySelector('#adminTable tbody');
    if(!j.ok){ tbody.innerHTML = '<tr><td colspan=5>无法获取（需要登录或权限）</td></tr>'; return; }
    const rows = Object.values(j.admins||{}).map(a=>`<tr>
      <td>${a.id}</td>
      <td>${a.isSuper}</td>
      <td>${JSON.stringify(a.permissions)}</td>
      <td>${new Date(a.created).toLocaleString()}</td>
      <td><button onclick="deleteAdmin('${a.id}')">删除</button></td>
    </tr>`).join('');
    tbody.innerHTML = rows || '<tr><td colspan=5>无管理员</td></tr>';
  }catch(e){ console.error(e); }
}

window.deleteAdmin = async function(id){
  if(!confirm('删除管理员 '+id+' ?')) return;
  const r = await fetch('/api/admin/delete',{method:'POST',headers:authHeaders(),body:JSON.stringify({id})});
  const j = await r.json();
  alert(j.ok? '已删除': ('错误: '+(j.error||'unknown')));
  loadAdmins();
}

document.getElementById('btnShowLogin').onclick = ()=>{ document.getElementById('loginBox').style.display='block'; }
document.getElementById('btnLogin').onclick = async ()=>{
  const id = el('adminId').value.trim(); const pw = el('adminPw').value;
  if(!id||!pw) return alert('请输入');
  try{
    const r = await fetch('/api/admin/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id,password:pw}) });
    const j = await r.json();
    if(j.ok && j.token){ localStorage.setItem('nexbit_admin_token', j.token); el('loginState').innerText = id; alert('登录成功'); loadAdmins(); } else alert('登录失败: '+(j.error||''));
  }catch(e){ alert('请求失败'); }
};

document.getElementById('btnCreate').onclick = async ()=>{
  const id = el('newId').value.trim(); const pw = el('newPw').value;
  const perms = { recharge: el('permRecharge').checked, withdraw: el('permWithdraw').checked, buySell: el('permBuySell').checked };
  if(!id||!pw) return alert('请输入id与密码');
  try{
    const r = await fetch('/api/admin/create', { method:'POST', headers: authHeaders(), body: JSON.stringify({ id, password: pw, permissions: perms }) });
    const j = await r.json();
    if(j.ok) { alert('创建成功'); loadAdmins(); } else alert('创建失败: '+(j.error||''));
  }catch(e){ alert('请求失败'); }
};

loadAdmins();
})();