// public/js/userdata.js
// 负责 userid 管理 & 与后端 /api/users/sync 同步

(function(){
  const KEY = 'NEXBIT_USER_ID';
  function genUserId(){ return 'U' + Math.floor(1000 + Math.random()*9000); }

  if(!localStorage.getItem(KEY)) localStorage.setItem(KEY, genUserId());
  window.NEXBIT_USER_ID = localStorage.getItem(KEY);

  window.syncUser = async function(userid){
    const uid = userid || window.NEXBIT_USER_ID;
    if(!uid) return { ok:false, error:'no-uid' };
    try {
      const res = await fetch('/api/users/sync', {
        method:'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ userid: uid })
      });
      const j = await res.json();
      return j;
    } catch(e){
      return { ok:false, error: e.message || 'network' };
    }
  };

  // auto sync on load (non-blocking)
  window.addEventListener('load', ()=>{ syncUser().catch(()=>{}); });

})();
