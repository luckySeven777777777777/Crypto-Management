Package: public_final
Contents:
- public/ (HTML files intended for admin backend)
- public/js/ (JavaScript files)
- server.js (backend server)
- package.json

Instructions:
1) Unzip to your project root.
2) Deploy server with: npm install && npm start
   (Ensure FIREBASE_SERVICE_ACCOUNT and FIREBASE_DATABASE_URL are set in env)
3) Serve static files from ./public (server.js already uses express.static('public')).
4) For Strikingly front-end, embed the single-file script extracted from public/js as needed.

Files included: buysell.html, recharge.html, withdraw.html, dashboard-brand.html, order-list.html, js/utils.js, js/userdata.js, js/forms.js, js/table.js, js/realtime.js, js/auth.js, js/nexbit-api.js, js/dashboard.js, js/buysell.js, js/recharge.js, js/withdraw.js, js/orders.js, server.js, package.json
