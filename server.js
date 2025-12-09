/* ================================================================
   NEXBIT — FINAL SERVER.JS
   静态目录 + 管理员系统 + 权限 + 订单一次性处理 + 余额系统
================================================================ */

const express = require("express");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

/* ================================================================
   🔥 关键修复：让 public 目录能被访问（你之前 404 的根本原因）
================================================================ */
app.use(express.static(path.join(__dirname, "public")));

/* ================================================================
   DB 文件
================================================================ */
const DB_FILE = path.join(__dirname, "db.json");
const JWT_SECRET = "NEXBIT_SECRET_KEY";

/* 初始化 DB 文件 */
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(
        { admins: {}, orders: {}, balances: {}, users: {} },
        null,
        2
      )
    );
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

/* ================================================================
   🔥 自动创建超级管理员（一次）
   ID: 发财
   PW: 970611
================================================================ */
function bootstrapSuperAdmin() {
  const db = loadDB();
  if (!db.admins["发财"]) {
    db.admins["发财"] = {
      id: "发财",
      password: "970611",
      roles: {
        isSuper: true,
        recharge: true,
        withdraw: true,
        buysell: true,
      },
    };
    saveDB(db);
    console.log("已自动创建超级管理员：发财 / 970611");
  }
}
bootstrapSuperAdmin();

/* ================================================================
   Middleware: 管理员认证
================================================================ */
function adminAuth(req, res, next) {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.json({ ok: false, error: "未登录" });

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

/* ================================================================
   登录接口
================================================================ */
app.post("/api/admin/login", (req, res) => {
  const { id, password } = req.body;
  const db = loadDB();
  const a = db.admins[id];

  if (!a || a.password !== password)
    return res.json({ ok: false, error: "账号或密码错误" });

  const token = jwt.sign({ id }, JWT_SECRET, { expiresIn: "48h" });
  res.json({ ok: true, token });
});

/* ================================================================
   获取自己的资料
================================================================ */
app.get("/api/admin/me", adminAuth, (req, res) => {
  const a = req.admin;
  res.json({
    ok: true,
    id: a.id,
    roles: a.roles,
    isSuper: a.roles?.isSuper === true,
  });
});

/* ================================================================
   管理员管理（仅超管）
================================================================ */
app.get("/api/admin/list", adminAuth, (req, res) => {
  if (!req.admin.roles.isSuper)
    return res.json({ ok: false, error: "无权限" });

  const db = loadDB();
  res.json({
    ok: true,
    admins: Object.values(db.admins),
  });
});

/* 创建管理员 */
app.post("/api/admin/create", adminAuth, (req, res) => {
  if (!req.admin.roles.isSuper)
    return res.json({ ok: false, error: "无权限" });

  const { id, password } = req.body;
  const db = loadDB();

  if (db.admins[id]) return res.json({ ok: false, error: "管理员已存在" });

  db.admins[id] = {
    id,
    password,
    roles: {
      isSuper: false,
      recharge: false,
      withdraw: false,
      buysell: false,
    },
  };

  saveDB(db);
  res.json({ ok: true });
});

/* 修改管理员 ID */
app.post("/api/admin/rename", adminAuth, (req, res) => {
  if (!req.admin.roles.isSuper)
    return res.json({ ok: false, error: "无权限" });

  const { oldId, newId } = req.body;
  const db = loadDB();

  if (!db.admins[oldId]) return res.json({ ok: false, error: "不存在" });
  if (db.admins[newId]) return res.json({ ok: false, error: "新账号已存在" });

  db.admins[newId] = db.admins[oldId];
  db.admins[newId].id = newId;
  delete db.admins[oldId];

  saveDB(db);
  res.json({ ok: true });
});

/* 修改管理员密码 */
app.post("/api/admin/updatePassword", adminAuth, (req, res) => {
  if (!req.admin.roles.isSuper)
    return res.json({ ok: false, error: "无权限" });

  const { id, newPassword } = req.body;
  const db = loadDB();

  if (!db.admins[id]) return res.json({ ok: false, error: "不存在" });

  db.admins[id].password = newPassword;
  saveDB(db);

  res.json({ ok: true });
});

/* 修改管理员权限 */
app.post("/api/admin/updateRoles", adminAuth, (req, res) => {
  if (!req.admin.roles.isSuper)
    return res.json({ ok: false, error: "无权限" });

  const { id, roles } = req.body;
  const db = loadDB();

  if (!db.admins[id]) return res.json({ ok: false, error: "不存在" });

  db.admins[id].roles = {
    ...db.admins[id].roles,
    ...roles,
  };

  saveDB(db);
  res.json({ ok: true });
});

/* 删除管理员 */
app.post("/api/admin/delete", adminAuth, (req, res) => {
  if (!req.admin.roles.isSuper)
    return res.json({ ok: false, error: "无权限" });

  const { id } = req.body;
  const db = loadDB();

  if (!db.admins[id]) return res.json({ ok: false, error: "不存在" });

  delete db.admins[id];
  saveDB(db);

  res.json({ ok: true });
});

/* ================================================================
   订单系统（充值、提款、买卖）
================================================================ */
function createOrder(type, data) {
  const db = loadDB();
  const orderId = `${type}_${Date.now()}`;
  data.orderId = orderId;
  data.createdAt = Date.now();
  data.actioned = false;
  data.status = "pending";
  data.type = type;

  if (!db.orders[type]) db.orders[type] = {};
  db.orders[type][orderId] = data;

  saveDB(db);
  return orderId;
}

app.post("/api/order/recharge", (req, res) => {
  res.json({ ok: true, orderId: createOrder("recharge", req.body) });
});
app.post("/api/order/withdraw", (req, res) => {
  res.json({ ok: true, orderId: createOrder("withdraw", req.body) });
});
app.post("/api/order/buysell", (req, res) => {
  res.json({ ok: true, orderId: createOrder("buysell", req.body) });
});

/* ================================================================
   后台处理订单（一次性逻辑 + 超管 override）
================================================================ */
app.post("/api/transaction/update", adminAuth, (req, res) => {
  const { orderId, type, status } = req.body;
  const admin = req.admin;

  const db = loadDB();
  const order = db.orders[type]?.[orderId];
  if (!order) return res.json({ ok: false, error: "订单不存在" });

  /* 已处理但不是超管 → 拒绝 */
  if (order.actioned && !admin.roles.isSuper) {
    return res.json({ ok: false, error: "订单已处理，普通管理员不可重复处理" });
  }

  order.status = status;
  order.actioned = true;
  order.actionedAt = Date.now();
  order.actionedBy = admin.id;

  /* 修改余额（成功时） */
  if (status === "success") {
    const uid = order.userId;
    if (!db.balances[uid]) db.balances[uid] = { balance: 0 };

    if (type === "recharge") db.balances[uid].balance += Number(order.amount);
    if (type === "withdraw") db.balances[uid].balance -= Number(order.amount);
    if (type === "buysell") db.balances[uid].balance += Number(order.profit || 0);
  }

  saveDB(db);
  res.json({ ok: true });
});

/* ================================================================
   Strikingly 轮询查询余额（前端每 5 秒访问）
================================================================ */
app.get("/api/balance/:userid", (req, res) => {
  const db = loadDB();
  const uid = req.params.userid;
  res.json({ balance: db.balances[uid]?.balance || 0 });
});

/* ================================================================
   获取所有订单（后台）
================================================================ */
app.get("/api/transactions", adminAuth, (req, res) => {
  const db = loadDB();
  res.json({
    ok: true,
    recharge: db.orders.recharge || {},
    withdraw: db.orders.withdraw || {},
    buysell: db.orders.buysell || {},
    users: db.users || {},
  });
});

/* SSE（可选，不发送数据） */
app.get("/api/orders/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
});

/* ================================================================
   启动服务器
================================================================ */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running:", PORT));
