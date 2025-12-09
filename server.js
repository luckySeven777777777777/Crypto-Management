// server.js - RTDB backend with admin management (professional permissions)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: '*', methods:['GET','POST','OPTIONS'], allowedHeaders:['Content-Type','Authorization'] }));
app.use(express.json());
app.use(express.urlencoded({ extended:true }));
app.use(express.static(path.join(__dirname,'public')));

// Initialize Firebase Admin (Realtime Database)
let db = null;
try {
  const admin = require('firebase-admin');
  if (process.env.FIREBASE_SERVICE_ACCOUNT && process.env.FIREBASE_DATABASE_URL) {
    const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(svc),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    db = admin.database();
    console.log('✅ Firebase RTDB connected');
  } else {
    console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT or FIREBASE_DATABASE_URL missing. Admin features disabled.');
  }
} catch(e){
  console.warn('❌ Firebase admin init failed:', e.message);
}

// utility
function now(){ return Date.now(); }
function safeNumber(v, fallback=0){ const n = Number(v); return Number.isFinite(n)?n:fallback; }

// ----------------- Admin auth & helpers -----------------
async function hashPassword(p){ return await bcrypt.hash(p,10); }
async function comparePassword(p, h){ return await bcrypt.compare(p, h); }

async function createAdminRecord(id, password, isSuper=false, perms={recharge:false,withdraw:false,buySell:false}, createdBy='system'){
  if(!db) throw new Error('no-db');
  const hashed = await hashPassword(password);
  const token = uuidv4();
  const created = now();
  const rec = { id, passwordHash: hashed, isSuper: !!isSuper, permissions: perms, created, createdBy };
  await db.ref(`admins/${id}`).set(rec);
  await db.ref(`admins_by_token/${token}`).set({ id, created, createdBy });
  return { id, token };
}

async function getAdminById(id){
  if(!db) return null;
  const snap = await db.ref(`admins/${id}`).once('value');
  return snap.exists()?snap.val():null;
}

async function getAdminByToken(token){
  if(!db || !token) return null;
  const snap = await db.ref(`admins_by_token/${token}`).once('value');
  if(!snap.exists()) return null;
  const rec = snap.val();
  const aid = rec.id;
  return await getAdminById(aid);
}

function requireAuth(req){
  const auth = (req.headers.authorization||'').trim();
  if(!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  return token;
}

async function isValidToken(token){
  if(!db || !token) return false;
  const snap = await db.ref(`admins_by_token/${token}`).once('value');
  if(!snap.exists()) return false;
  const rec = snap.val();
  // optional expiry omitted
  return true;
}

// bootstrap: create initial super admin '发财' if not exists
(async function bootstrapAdmin(){
  try{
    if(!db) return;
    const superId = process.env.INIT_SUPER_ADMIN_ID || '发财';
    const superPw = process.env.INIT_SUPER_ADMIN_PW || '970611';
    const snap = await db.ref(`admins/${superId}`).once('value');
    if(!snap.exists()){
      console.log('Bootstrapping super admin:', superId);
      await createAdminRecord(superId, superPw, true, { recharge:true, withdraw:true, buySell:true }, 'system');
      console.log('Super admin created:', superId);
    } else {
      console.log('Super admin exists:', superId);
    }
  }catch(e){
    console.warn('bootstrap failed', e.message);
  }
})();

// ----------------- Admin API -----------------

// Create admin (only super admin)
app.post('/api/admin/create', async (req, res) => {
  try{
    if(!db) return res.status(500).json({ ok:false, error:'no-db' });
    const token = requireAuth(req);
    const byAdmin = token ? await getAdminByToken(token) : null;
    if(!byAdmin || !byAdmin.isSuper) return res.status(403).json({ ok:false, error:'forbidden' });

    const { id, password, permissions } = req.body;
    if(!id || !password) return res.status(400).json({ ok:false, error:'missing id/password' });

    const perms = Object.assign({ recharge:false, withdraw:false, buySell:false }, permissions||{});
    const rec = await createAdminRecord(id, password, false, perms, byAdmin.id);
    return res.json({ ok:true, id: rec.id, token: rec.token });
  }catch(e){ console.error('admin.create err', e); res.status(500).json({ ok:false, error: e.message }); }
});

// List admins (requires admin token)
app.get('/api/admin/list', async (req, res) => {
  try{
    if(!db) return res.status(500).json({ ok:false, error:'no-db' });
    const token = requireAuth(req);
    if(!token || !(await isValidToken(token))) return res.status(403).json({ ok:false, error:'forbidden' });
    const snap = await db.ref('admins').once('value');
    const obj = snap.val() || {};
    // remove passwordHash before returning
    const safe = {};
    Object.keys(obj).forEach(k=>{
      const v = obj[k];
      safe[k] = { id:v.id, isSuper:!!v.isSuper, permissions:v.permissions || {}, created:v.created, createdBy:v.createdBy || null };
    });
    return res.json({ ok:true, admins: safe });
  }catch(e){ console.error('admin.list err', e); res.status(500).json({ ok:false, error: e.message }); }
});

// Delete admin (super only)
app.post('/api/admin/delete', async (req, res) => {
  try{
    if(!db) return res.status(500).json({ ok:false, error:'no-db' });
    const token = requireAuth(req);
    const byAdmin = token ? await getAdminByToken(token) : null;
    if(!byAdmin || !byAdmin.isSuper) return res.status(403).json({ ok:false, error:'forbidden' });

    const { id } = req.body;
    if(!id) return res.status(400).json({ ok:false, error:'missing id' });
    if(id === byAdmin.id) return res.status(400).json({ ok:false, error:'cannot delete self' });

    await db.ref(`admins/${id}`).remove();
    // remove any tokens
    const tokensSnap = await db.ref('admins_by_token').orderByChild('id').equalTo(id).once('value');
    const tokens = tokensSnap.val() || {};
    Object.keys(tokens).forEach(k=> db.ref(`admins_by_token/${k}`).remove());
    return res.json({ ok:true });
  }catch(e){ console.error('admin.delete err', e); res.status(500).json({ ok:false, error: e.message }); }
});

// Update permissions (super only)
app.post('/api/admin/updatePermissions', async (req, res) => {
  try{
    if(!db) return res.status(500).json({ ok:false, error:'no-db' });
    const token = requireAuth(req);
    const byAdmin = token ? await getAdminByToken(token) : null;
    if(!byAdmin || !byAdmin.isSuper) return res.status(403).json({ ok:false, error:'forbidden' });

    const { id, permissions } = req.body;
    if(!id || !permissions) return res.status(400).json({ ok:false, error:'missing id/permissions' });

    const adminSnap = await db.ref(`admins/${id}`).once('value');
    if(!adminSnap.exists()) return res.status(404).json({ ok:false, error:'notfound' });
    await db.ref(`admins/${id}/permissions`).set(permissions);
    return res.json({ ok:true });
  }catch(e){ console.error('admin.update err', e); res.status(500).json({ ok:false, error: e.message }); }
});

// Admin login (returns token if ok)
app.post('/api/admin/login', async (req, res) => {
  try{
    if(!db) return res.status(500).json({ ok:false, error:'no-db' });
    const { id, password } = req.body;
    if(!id || !password) return res.status(400).json({ ok:false, error:'missing' });
    const snap = await db.ref(`admins/${id}`).once('value');
    if(!snap.exists()) return res.status(404).json({ ok:false, error:'notfound' });
    const rec = snap.val();
    const ok = await comparePassword(password, rec.passwordHash || '');
    if(!ok) return res.status(401).json({ ok:false, error:'invalid' });
    // generate a new token record
    const token = uuidv4();
    await db.ref(`admins_by_token/${token}`).set({ id, created: now(), createdBy: rec.createdBy || 'system' });
    return res.json({ ok:true, token, id, isSuper: !!rec.isSuper, permissions: rec.permissions || {} });
  }catch(e){ console.error('admin.login err', e); res.status(500).json({ ok:false, error: e.message }); }
});

// ----------------- Keep existing transaction endpoints minimally (proxy to RTDB) -----------------

app.get('/api/transactions', async (req, res) => {
  try{
    if(!db) return res.json({ ok:true, recharge:[], withdraw:[], buysell:[], users:{}, stats:{} });

    const rechargeSnap = await db.ref('orders/recharge').once('value');
    const withdrawSnap = await db.ref('orders/withdraw').once('value');
    const buysellSnap  = await db.ref('orders/buysell').once('value');
    const usersSnap    = await db.ref('users').once('value');

    const recharge = Object.values(rechargeSnap.val() || {}).sort((a,b)=> (b.timestamp||0)-(a.timestamp||0));
    const withdraw = Object.values(withdrawSnap.val() || {}).sort((a,b)=> (b.timestamp||0)-(a.timestamp||0));
    const buysell  = Object.values(buysellSnap.val() || {}).sort((a,b)=> (b.timestamp||0)-(a.timestamp||0));
    const users    = usersSnap.val() || {};

    return res.json({ ok:true, recharge, withdraw, buysell, users, stats:{
      todayRecharge: recharge.length, todayWithdraw: withdraw.length, todayOrders: recharge.length+withdraw.length+buysell.length, alerts:0
    }});
  }catch(e){ console.error('transactions err', e); res.status(500).json({ ok:false, error: e.message }); }
});

// SSE orders stream (simple)
app.get('/api/orders/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control':'no-cache', 'Connection':'keep-alive' });
  res.flushHeaders();
  const keepAlive = setInterval(()=>{ try{ res.write(':\n\n'); }catch(e){} }, 15000);
  const clientId = uuidv4();
  const send = (data) => { try{ res.write(`data: ${JSON.stringify(data)}\n\n`); }catch(e){} };
  // naive implementation: listen to changes via polling every 5s (since we can't attach db listeners reliably here)
  const iv = setInterval(async ()=>{
    // no-op placeholder: real implementation should use db.ref(...).on('child_changed')
  }, 5000);
  req.on('close', ()=>{ clearInterval(iv); clearInterval(keepAlive); });
});

// Serve root
app.get('/', (req, res)=> res.send('NEXBIT backend running'));

// start
app.listen(PORT, ()=> console.log('Server listening on', PORT));
