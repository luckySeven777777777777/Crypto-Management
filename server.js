<!DOCTYPE html>

<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NEXBIT 管理后台登录</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      height: 100vh;
      background: linear-gradient(135deg, #0f2027, #203a43, #2c5364);
      font-family: Arial, Helvetica, sans-serif;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .login-box {
      width: 360px;
      background: rgba(0,0,0,0.65);
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.6);
    }
    .logo {
      text-align: center;
      font-size: 26px;
      font-weight: 700;
      margin-bottom: 6px;
      letter-spacing: 1px;
    }
    .sub {
      text-align: center;
      font-size: 13px;
      color: #9aa4ad;
      margin-bottom: 28px;
    }
    label {
      font-size: 13px;
      color: #cfd8dc;
      display: block;
      margin-bottom: 6px;
    }
    input {
      width: 100%;
      padding: 12px;
      border-radius: 8px;
      border: none;
      outline: none;
      background: #111;
      color: #fff;
      margin-bottom: 18px;
      font-size: 14px;
    }
    input::placeholder { color: #666; }
    button {
      width: 100%;
      padding: 12px;
      border-radius: 8px;
      border: none;
      background: linear-gradient(135deg, #1e88e5, #1565c0);
      color: #fff;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover { opacity: 0.9; }
    .error {
      margin-top: 12px;
      font-size: 13px;
      color: #ff5252;
      text-align: center;
      display: none;
    }
    .footer {
      margin-top: 26px;
      font-size: 11px;
      text-align: center;
      color: #777;
    }
  </style>
</head>
<body>
  <div class="login-box">
    <div class="logo">NEXBIT ADMIN</div>
    <div class="sub">Management Control Panel</div>

```
<label>用户名</label>
<input id="username" placeholder="Admin / Agent" />

<label>密码</label>
<input id="password" type="password" placeholder="••••••••" />

<div id="captchaBox" style="margin-bottom:18px;">
  <label style="display:flex; justify-content:space-between; align-items:center;">
    <span>验证码</span>
    <span id="captchaQuestion" style="cursor:pointer; color:#64b5f6; font-size:13px;" onclick="refreshCaptcha()">点击刷新</span>
  </label>
  <input id="captchaAnswer" placeholder="输入计算结果" style="margin-bottom:0;" />
</div>

<button id="loginBtn">登录</button>

<div id="error" class="error">登录失败</div>

<div class="footer">© NEXBIT System</div>
```

  </div>

<script>
  let captchaId = null;

  async function refreshCaptcha() {
    const el = document.getElementById('captchaQuestion');
    el.innerText = '加载中...';
    try {
      const res = await fetch('/api/admin/captcha');
      const data = await res.json();
      if (data.ok) {
        captchaId = data.id;
        el.innerText = data.question;
      } else {
        el.innerText = '刷新失败，点击重试';
      }
    } catch (e) {
      el.innerText = '刷新失败，点击重试';
    }
  }

  refreshCaptcha();

  document.getElementById('loginBtn').onclick = async () => {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    const captchaAnswer = document.getElementById('captchaAnswer').value.trim();
    const err = document.getElementById('error');

    if (!username || !password) {
      err.innerText = '请输入用户名和密码';
      err.style.display = 'block';
      return;
    }
    if (!captchaAnswer) {
      err.innerText = '请输入验证码答案';
      err.style.display = 'block';
      return;
    }

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: username,
          password,
          captchaId,
          captchaAnswer
        })
      });

      const data = await res.json();

      if (data.ok) {
        // ✅ 已绑定2FA
        if (data.require2FA) {
          err.style.display = 'none';
          // 交给 dashboard-brand.html 的2FA流程处理
          localStorage.setItem('tempToken', data.tempToken);
          localStorage.setItem('admin_user', data.user || username);
          location.href = 'dashboard-brand.html?2fa=1';
          return;
        }
        localStorage.setItem('nexbit_admin_token', data.token);
        localStorage.setItem('admin_user', data.user || username);
        location.href = 'dashboard-brand.html';
      } else {
        // 验证码错误时刷新
        if (data.error && data.error.includes('验证码')) {
          refreshCaptcha();
          document.getElementById('captchaAnswer').value = '';
        }
        err.innerText = data.error || '登录失败';
        err.style.display = 'block';
      }
    } catch (e) {
      err.innerText = '服务器连接失败';
      err.style.display = 'block';
    }
  };
</script>

</body>
</html>
