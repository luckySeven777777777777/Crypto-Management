// public/js/utils.js
// 通用工具函数

window.$ = (sel) => document.querySelector(sel);
window.$all = (sel) => Array.from(document.querySelectorAll(sel));

window.formatTimeUS = function(ts){
  try {
    const d = ts ? new Date(ts) : new Date();
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit'
    }).format(d);
  } catch(e){ return new Date(ts||Date.now()).toLocaleString(); }
};

window.objToSortedArray = function(objOrNull){
  if(!objOrNull) return [];
  try {
    const arr = Object.values(objOrNull);
    return arr.sort((a,b) => (b.timestamp || b.time || 0) - (a.timestamp || a.time || 0));
  } catch(e){ return []; }
};

// safeFetch with JSON parse + error handling
window.safeFetchJson = async function(url, opts){
  const res = await fetch(url, opts);
  const text = await res.text();
  try { return { ok: true, status: res.status, data: JSON.parse(text) }; }
  catch(e){ return { ok: false, status: res.status, dataText: text }; }
};
