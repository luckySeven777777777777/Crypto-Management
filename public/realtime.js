// public/js/realtime.js
// SSE orders stream + simple binance price map

(function(){
  window.priceMap = {};
  const watched = ['BTCUSDT','ETHUSDT','LTCUSDT','BCHUSDT','XRPUSDT'];

  // Binance price stream (used by dashboard)
  function connectBinance(){
    try {
      const streams = watched.map(s=>s.toLowerCase()+'@trade').join('/');
      const sock = new WebSocket('wss://stream.binance.com:9443/stream?streams=' + streams);
      sock.onmessage = (ev)=>{
        try{
          const m = JSON.parse(ev.data);
          const d = m.data || m;
          const s = (d.s||'').toUpperCase();
          const p = Number(d.p || d.price || d.c || 0);
          if(s && p) { window.priceMap[s] = p; }
        }catch(e){}
      };
      sock.onclose = ()=> setTimeout(connectBinance,3000);
    } catch(e){}
  }
  connectBinance();

  // SSE order events
  let evt = null;
  function connectSSE(){
    try{
      if(evt) evt.close();
      evt = new EventSource('/api/orders/stream');
      evt.onmessage = (e) => {
        try {
          const obj = JSON.parse(e.data);
          // expose event globally for other modules
          if(window.onOrderEvent) window.onOrderEvent(obj);
        } catch(e){}
      };
      evt.onerror = ()=> { setTimeout(connectSSE,3000); };
    } catch(e){}
  }
  connectSSE();

  // Provide a helper used by buysell estimates (simple)
  window.refreshBuySellEstimates = function(){
    // simple fill: read priceMap and update any element with data-coin attribute
    document.querySelectorAll('[data-coin]').forEach(el=>{
      const coin = (el.getAttribute('data-coin') || '').toUpperCase();
      const price = window.priceMap[coin+'USDT'] || '--';
      el.innerText = price === '--' ? '--' : Number(price).toFixed(6);
    });
  };

  // also expose small helper to get price
  window.getPriceFor = (coin) => {
    if(!coin) return null;
    const p = window.priceMap[(coin+'USDT').toUpperCase()];
    return p || null;
  };

  // export
  window.__realtime = { connectBinance, connectSSE };

})();
