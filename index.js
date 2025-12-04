import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set, update } from "firebase/database";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// ------------------------------------
// 让 Railway 正确访问 HTML/CSS/JS 文件
// ------------------------------------
app.use(express.static(__dirname));

// ----------------------
// Firebase RTDB 连接
// ----------------------
const firebaseConfig = {
  databaseURL: "https://cryptonexbitsafe-default-rtdb.firebaseio.com"
};

const fbApp = initializeApp(firebaseConfig);
const db = getDatabase(fbApp);

// ==================================================
// ★ 1) Strikingly 自动同步用户（前台无需登录）
// ==================================================
app.post("/api/user/sync", async (req, res) => {
  try {
    const { userid } = req.body;
    if (!userid) return res.json({ success: false });

    const userRef = ref(db, "users/" + userid);
    const snapshot = await get(userRef);

    if (!snapshot.exists()) {
      await set(userRef, {
        balance: 0,
        level: "普通会员",
        wallet: "",
        createdAt: Date.now(),
        lastActivity: Date.now()
      });
    } else {
      await update(userRef, { lastActivity: Date.now() });
    }

    res.json({ success: true });
  } catch (e) {
    console.error("SYNC ERROR:", e);
    res.json({ success: false });
  }
});


// ==================================================
// ★ 2) 后台获取所有用户列表
// ==================================================
app.get("/api/admin/users", async (req, res) => {
  try {
    const snapshot = await get(ref(db, "users"));
    if (!snapshot.exists()) return res.json([]);

    const data = snapshot.val();
    const users = Object.keys(data).map(uid => ({
      userid: uid,
      wallet: data[uid].wallet || "",
      level: data[uid].level || "",
      lastActivity: data[uid].lastActivity || "",
      balance: data[uid].balance ?? 0
    }));

    res.json(users);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed" });
  }
});


// ==================================================
// ★ 3) 后台修改余额
// ==================================================
app.post("/api/admin/balance", async (req, res) => {
  try {
    const { user, amount } = req.body;
    if (!user) return res.json({ success: false });

    await update(ref(db, `users/${user}`), { balance: Number(amount) });

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.json({ success: false });
  }
});


// ==================================================
// ★ 4) Strikingly 前台读取余额
// ==================================================
app.get("/api/user/balance", async (req, res) => {
  try {
    const userid = req.query.userid;
    if (!userid) return res.json({ balance: 0 });

    const snapshot = await get(ref(db, `users/${userid}/balance`));
    res.json({ balance: snapshot.exists() ? snapshot.val() : 0 });
  } catch {
    res.json({ balance: 0 });
  }
});


// ==================================================
// ★ 5) 让 /dashboard-brand.html 正常打开
// ==================================================
app.get("/dashboard-brand.html", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard-brand.html"));
});

app.get("/admins.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admins.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});


// ==================================================
// 启动服务
// ==================================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server Running on", PORT));
