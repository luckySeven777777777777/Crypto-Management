/* =====================================================================
   NEXBIT — server.js (FINAL)
   后端：管理员系统 + 权限 + 订单一次处理 + 多管理员 + 余额
===================================================================== */

const express = require("express");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const app = express();
app.use(express.json());

const DB_FILE = path.join(__dirname, "db.json");
const JWT_SECRET = "NEXBIT_SECRET_KEY";

/* ------------------ 初始化数据库文件 ------------------ */
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ admins: {}, orders: {}, balances: {}, users: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

/* ==================================================================
   自动创建超级管理员（一次性）
   ID: 发财 / 密码: 970611
================================================================== */
function bootstrapSuperAdmin() {
  const db = loadDB();
  if (!db.admins["发财"]) {
    db.admins["发财"] = {
      id: "发财",
      password: "970611",
      roles: { isSuper: true, recharge: true, withdraw: true, buysell: true }
    };
    saveDB(db);
    console.log("已自动创建超级管理员：发财 / 970611");
  }
}
bootstrapSuperAdmin();

/* ==================================================================
   Middleware: 管理员认证
================================================================== */
function adminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.json({ ok: false, error: "未登录" });

  try {
    const token = auth.replace("Bearer ", "");
    const data = jwt.verify(token, JWT_SECRET);

    const db = loadDB();
    const admin = db.admins[data.id];
    if (!admin) return res.json({ ok: false, error: "管理员不存在" });

    req.admin = admin;
    next();

  } catch (e) {
    return res.json({ ok: false, error: "token 无效" });
  }
}

/* ==================================================================
   登录
================================================================== */
app.post("/api/admin/login", (req, res) => {
  const { id, password } = req.body;
  const db = loadDB();
  const a = db.admins[id];

  if (!a || a.password !== password) {
    return res.json({ ok: false, error: "账号或密码错误" });
  }

  const token = jwt.sign({ id }, JWT_SECRET, { expiresIn: "48h" });
  res.json({ ok: true, token });
});

/* ==================================================================
   获取当前管理员信息
================================================================== */
app.get("/api/admin/me", adminAuth, (req, res) => {
  const a = req.admin;
  res.json({ ok: true, id: a.id, roles: a.roles, isSuper: a.roles?.isSuper || false });
});

/* ==================================================================
   管理员列表（仅超管）
================================================================== */
app.get("/api/admin/list", adminAuth, (req, res) => {
  if (!req.admin.roles.isSuper) return res.json({ ok: false, error: "无权限" });
  const db = loadDB();
  const list = Object.values(db.admins).map(a => ({
    id: a.id,
    roles: a.roles
  }));
  res.json({ ok: true, admins: list });
});

/* ==================================================================
   创建管理员（仅超管）
================================================================== */
app.post("/api/admin/create", adminAuth, (req, res) => {
  if (!req.admin.roles.isSuper) return res.json({ ok: false, error: "无权限" });

  const { id, password } = req.body;
  if (!id || !password) return res.json({ ok: false, error: "参数缺失" });

  const db = loadDB();
  if (db.admins[id]) return res.json({ ok: false, error: "管理员已存在" });

  db.admins[id] = {
    id,
    password,
    roles: { recharge: false, withdraw: false, buysell: false, isSuper: false }
  };

  saveDB(db);
  res.json({ ok: true });
});

/* ==================================================================
   重命名管理员（仅超管）
================================================================== */
app.post("/api/admin/rename", adminAuth, (req, res) => {
  if (!req.admin.roles.isSuper) return res.json({ ok: false, error: "无权限" });

  const { oldId, newId } = req.body;
  const db = loadDB();

  if (!db.admins[oldId]) return res.json({ ok: false, error: "管理员不存在" });
  if (db.admins[newId]) return res.json({ ok: false, error: "新 ID 已存在" });

  db.admins[newId] = db.admins[oldId];
  db.admins[newId].id = newId;
  delete db.admins[oldId];

  saveDB(db);
  res.json({ ok: true });
});

/* ==================================================================
   修改管理员密码（仅超管）
================================================================== */
app.post("/api/admin/updatePassword", adminAuth, (req, res) => {
  if (!req.admin.roles.isSuper) return res.json({ ok: false, error: "无权限" });

  const { id, newPassword } = req.body;
  const db = loadDB();

  if (!db.admins[id]) return res.json({ ok: false, error: "管理员不存在" });

  db.admins[id].password = newPassword;
  saveDB(db);

  res.json({ ok: true });
});

/* ==================================================================
   修改管理员权限（仅超管）
================================================================== */
app.post("/api/admin/updateRoles", adminAuth, (req, res) => {
  if (!req.admin.roles.isSuper) return res.json({ ok: false, error: "无权限" });

  const { id, roles } = req.body;
  const db = loadDB();

  if (!db.admins[id]) return res.json({ ok: false, error: "管理员不存在" });

  db.admins[id].roles = {
    ...db.admins[id].roles,
    ...roles
  };

  saveDB(db);
  res.json({ ok: true });
});

/* ==================================================================
   删除管理员（仅超管）
================================================================== */
app.post("/api/admin/delete", adminAuth, (req, res) => {
  if (!req.admin.roles.isSuper) return res.json({ ok: false, error: "无权限" });

  const { id } = req.body;
  const db = loadDB();

  if (!db.admins[id]) return res.json({ ok: false, error: "管理员不存在" });

  delete db.admins[id];
  saveDB(db);

  res.json({ ok: true });
});

/* ==================================================================
   用户提交订单（充值/提款/buysell）
================================================================== */
function createOrder(type, data) {
  const db = loadDB();
  const id = `${type}_${Date.now()}`;
  data.orderId = id;
  data.type = type;
  data.status = "processing";
  data.actioned = false;
  data.createdAt = Date.now();

  if (!db.orders[type]) db.orders[type] = {};
  db.orders[type][id] = data;
  saveDB(db);

  return id;
}

app.post("/api/order/recharge", (req, res) => {
  const id = createOrder("recharge", req.body);
  res.json({ ok: true, orderId: id });
});
app.post("/api/order/withdraw", (req, res) => {
  const id = createOrder("withdraw", req.body);
  res.json({ ok: true, orderId: id });
});
app.post("/api/order/buysell", (req, res) => {
  const id = createOrder("buysell", req.body);
  res.json({ ok: true, orderId: id });
});

/* ==================================================================
   管理后台处理订单（一次处理逻辑）
================================================================== */
app.post("/api/transaction/update", adminAuth, (req, res) => {
  const { orderId, type, status } = req.body;
  const admin = req.admin;

  const db = loadDB();
  const order = db.orders[type]?.[orderId];

  if (!order) return res.json({ ok: false, error: "订单不存在" });

  // 订单已经被处理过
  if (order.actioned && !admin.roles.isSuper) {
    return res.json({ ok: false, error: "订单已处理，普通管理员不可重复处理" });
  }

  // 超管允许重复处理，但普通管理员禁止
  order.actioned = true;
  order.actionedAt = Date.now();
  order.actionedBy = admin.id;

  order.status = status;

  // 成功时修改余额
  if (status === "success") {
    const uid = order.userId;
    const amount = Number(order.amount || 0);

    if (!db.balances[uid]) db.balances[uid] = { balance: 0 };

    if (type === "recharge") db.balances[uid].balance += amount;
    if (type === "withdraw") db.balances[uid].balance -= amount;
    if (type === "buysell") db.balances[uid].balance += Number(order.profit || 0);

  }

  saveDB(db);
  res.json({ ok: true });
});

/* ==================================================================
   轮询余额
================================================================== */
app.get("/api/balance/:userid", (req, res) => {
  const db = loadDB();
  const uid = req.params.userid;
  res.json({ balance: db.balances[uid]?.balance || 0 });
});

/* ==================================================================
   重置会员提款密码
================================================================== */
app.post("/api/user/updateWithdrawPassword", adminAuth, (req, res) => {
  const { userId, password } = req.body;
  const db = loadDB();

  if (!db.users[userId]) db.users[userId] = {};

  db.users[userId].withdrawPassword = password;
  saveDB(db);

  res.json({ ok: true });
});

/* ==================================================================
   获取全部订单（后台）
================================================================== */
app.get("/api/transactions", adminAuth, (req, res) => {
  const db = loadDB();
  res.json({
    ok: true,
    recharge: db.orders.recharge || {},
    withdraw: db.orders.withdraw || {},
    buysell: db.orders.buysell || {},
    users: db.users || {},
    stats: {
      todayRecharge: 0,
      todayWithdraw: 0,
      todayOrders: 0,
      alerts: 0
    }
  });
});

/* ==================================================================
   SSE 推送（可选）
================================================================== */
app.get("/api/orders/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  // 简化处理：不发送数据（前端依然兼容）
});

/* ==================================================================
   启动
================================================================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running:", PORT));
