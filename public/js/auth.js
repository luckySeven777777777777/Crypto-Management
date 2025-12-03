// public/js/auth.js - client-side helpers
function saveToken(token) {
  try { localStorage.setItem("admin_token", token); } catch (e) {}
}
function getToken() {
  try { return localStorage.getItem("admin_token"); } catch (e) { return null; }
}
function clearToken() {
  try { localStorage.removeItem("admin_token"); } catch (e) {}
}
function ensureLoggedIn() {
  const t = getToken();
  if (!t) {
    window.location.href = "/login.html";
    return false;
  }
  return t;
}
async function apiRequest(url, options = {}) {
  const headers = options.headers || {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`; // placeholder
  options.headers = headers;
  options.credentials = 'include';
  const res = await fetch(url, options);
  if (!res.ok) {
    if (res.status === 401) {
      clearToken();
      window.location.href = "/login.html";
    }
    const txt = await res.text();
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return res.json();
}
