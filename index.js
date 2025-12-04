import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import admin from "firebase-admin";
import fetch from "node-fetch";

// -----------------------------------------------------
// 初始化 Firebase Admin（从 Railway ENV 读取 JSON）
// -----------------------------------------------------
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.firestore();
const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public")); // 静态文件

// -----------------------------------------------------
// 用户余额接口（前端用）
// -----------------------------------------------------
app.post("/api/balance", async (req, res) => {
  try {
    const { userid, wallet } = req.body;
    if (!userid) return res.json({ success: false });

    const userRef = db.collection("users").doc(userid);
    const snap = await userRef.get();

    if (!snap.exists) {
      await userRef.set({
        wallet: wallet || "",
        balance: 0,
        status: "active",
        created: Date.now(),
      });
    }

    const data = (await userRef.get()).data();
    return res.json({ success: true, balance: data.balance || 0 });
  } catch (err) {
    console.error("balance error:", err);
    return res.json({ success: false });
  }
});

// -----------------------------------------------------
// 管理后台：获取全部用户
// -----------------------------------------------------
app.get("/api/admin/users", async (req, res) => {
  try {
    const snapshot = await db.collection("users").get();

    const list = snapshot.docs.map((doc) => ({
      userid: doc.id,
      ...doc.data(),
    }));

    return res.json(list);
  } catch (err) {
    console.error("GET /api/admin/users error", err);
    return res.status(500).json({ error: "failed" });
  }
});

// -----------------------------------------------------
// 管理后台：修改用户余额
// -----------------------------------------------------
app.post("/api/admin/balance", async (req, res) => {
  try {
    const { user, amount } = req.body;

    if (!user) return res.json({ success: false, msg: "缺少用户 ID" });

    await db.collection("users").doc(user).set(
      {
        balance: Number(amount),
        lastUpdate: Date.now(),
      },
      { merge: true }
    );

    return res.json({ success: true, balance: Number(amount) });
  } catch (err) {
    console.error("POST /api/admin/balance error", err);
    return res.status(500).json({ success: false });
  }
});

// -----------------------------------------------------
// 管理后台：保存设置（目前可扩展）
// -----------------------------------------------------
app.post("/api/settings", async (req, res) => {
  try {
    const data = req.body;
    await db.collection("settings").doc("config").set(data, { merge: true });
    return res.json({ success: true });
  } catch (err) {
    console.error("settings error:", err);
    return res.status(500).json({ success: false });
  }
});

// -----------------------------------------------------
// 默认路由（防止 404）
// -----------------------------------------------------
app.get("/", (req, res) => {
  res.send("Crypto Management API is running.");
});

// -----------------------------------------------------
// 启动服务器
// -----------------------------------------------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
