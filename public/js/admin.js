(function() {
  const API = '';
  function el(id) { return document.getElementById(id); }
  function authHeaders() {
    const t = localStorage.getItem('nexbit_admin_token');
    return t ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t } : { 'Content-Type': 'application/json' };
  }

  // 确保管理员已登录
  async function ensureLoggedIn() {
    if (getAdminToken()) return true;  // 如果有 token，则认为已经登录
    document.getElementById('loginBox').style.display = 'block';  // 显示登录框
    return false;
  }

  // 获取存储在 localStorage 中的 admin token
  function getAdminToken() {
    try {
      return localStorage.getItem('nexbit_admin_token');
    } catch (e) {
      return null;
    }
  }

  // 在页面加载时检查登录状态
  window.onload = async function() {
    const loggedIn = await ensureLoggedIn();
    if (loggedIn) {
      loadAdmins(); // 加载管理员列表
    }
  };

  // 加载管理员列表
  async function loadAdmins() {
    try {
      const r = await fetch('/api/admin/list', { headers: authHeaders() });
      const j = await r.json();
      const tbody = document.querySelector('#adminTable tbody');
      if (!j.ok) {
        tbody.innerHTML = '<tr><td colspan=5>无法获取（需要登录或权限）</td></tr>';
        return;
      }
      const rows = Object.values(j.admins || {}).map(a => `
        <tr>
          <td>${a.id}</td>
          <td>${a.isSuper}</td>
          <td>${JSON.stringify(a.permissions)}</td>
          <td>${new Date(a.created).toLocaleString()}</td>
          <td><button onclick="deleteAdmin('${a.id}')">删除</button></td>
        </tr>`).join('');
      tbody.innerHTML = rows || '<tr><td colspan=5>无管理员</td></tr>';
    } catch (e) { console.error(e); }
  }

  window.deleteAdmin = async function(id) {
    if (!confirm('删除管理员 ' + id + ' ?')) return;
    const r = await fetch('/api/admin/delete', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ id }) });
    const j = await r.json();
    alert(j.ok ? '已删除' : ('错误: ' + (j.error || 'unknown')));
    loadAdmins();
  }

  document.getElementById('btnShowLogin').onclick = () => { document.getElementById('loginBox').style.display = 'block'; }

  document.getElementById('btnLogin').onclick = async () => {
    const id = el('adminId').value.trim(); 
    const pw = el('adminPw').value;
    if (!id || !pw) return alert('请输入');
    try {
      const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, password: pw }) });
      const j = await r.json();
      if (j.ok && j.token) {
        localStorage.setItem('nexbit_admin_token', j.token); 
        el('loginState').innerText = id; 
        alert('登录成功'); 

      // 检查是否启用了 2FA
      const has2FA = await checkIf2FAEnabled(id);
      if (has2FA) {
        // 显示 2FA 输入框
        document.getElementById('adminLoginModal').style.display = 'none'; // 隐藏登录框
        document.getElementById('gaBox').style.display = 'block'; // 显示 2FA 输入框
        document.getElementById('gaAdminId').value = id; // 填充管理员 ID
        return; // 等待用户输入验证码
      }
        loadAdmins(); 
      } else alert('登录失败: ' + (j.error || ''));
    } catch (e) { alert('请求失败'); }
  };

  document.getElementById('btnCreate').onclick = async () => {
  const btnCreate = document.getElementById('btnCreate'); // 获取按钮元素
  btnCreate.disabled = true;  // 禁用按钮，防止重复点击

  const id = el('newId').value.trim(); 
  const pw = el('newPw').value;
  const perms = { 
    recharge: el('permRecharge').checked, 
    withdraw: el('permWithdraw').checked, 
    buySell: el('permBuySell').checked 
  };

  // 确保id和密码输入
  if (!id || !pw) {
    btnCreate.disabled = false; // 恢复按钮
    return alert('请输入id与密码');
  }

  try {
    // 发送创建管理员请求
    const r = await fetch('/api/admin/create', { 
      method: 'POST', 
      headers: authHeaders(), 
      body: JSON.stringify({ id, password: pw, permissions: perms }) 
    });

    // 解析响应
    const j = await r.json();

    if (j.ok) { 
      alert('创建成功'); 
      loadAdmins();  // 加载管理员列表
    } else {
      alert('创建失败: ' + (j.error || '未知错误'));
    }
  } catch (e) { 
    alert('请求失败'); 
  } finally {
    btnCreate.disabled = false; // 恢复按钮
  }
};

// 页面加载时，加载管理员列表
loadAdmins();
})();

