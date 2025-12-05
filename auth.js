// public/js/auth.js
// 负责生成/保存 NEXBIT_USER_ID，和简单的 requireLogin (如需更复杂可扩展)

(function(){
  // 生成 4 位用户 ID (U + 4 digits)
  function genUserId() {
    return "U" + Math.floor(1000 + Math.random() * 9000);
  }

  if (!localStorage.getItem("NEXBIT_USER_ID")) {
    localStorage.setItem("NEXBIT_USER_ID", genUserId());
  }

  window.NEXBIT_USER_ID = localStorage.getItem("NEXBIT_USER_ID");

  // 简单 requireLogin：如果你页面需要强制登录，可在这里实现
  window.requireLogin = function() {
    // 目前仅确保全局 ID 存在（已在顶部处理）
    return !!window.NEXBIT_USER_ID;
  };

  // 在加载时自动执行一次（不要在 html 中重复调用）
  try { if (typeof requireLogin === 'function') requireLogin(); } catch(e){}

})();
