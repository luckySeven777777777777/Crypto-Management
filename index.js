import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set, update, child } from "firebase/database";

const app = express();
app.use(cors());
app.use(express.json());

// ----------------------
// Firebase RTDB 连接
// ----------------------
const firebaseConfig = {
  databaseURL: "https://cryptonexbitsafe-default-rtdb.firebaseio.com"
};

const fbApp = initializeApp(firebaseConfig);
const db = getDatabase(fbApp);

// ----------------------
// 获取所有用户 （后台会员管理用）
// ----------------------
app.get("/api/admin/users", async (req, res) => {
  try {
    const snapshot = await get(ref(db, "users"));
    if (!snapshot.exists()) return res.json([]);

    const obj = snapshot.val();
    const arr = Object.keys(obj).map(uid => ({
      userid: uid,
      wallet: obj[uid].wallet || "",
      level: obj[uid].level || "",
      lastActivity: obj[uid].lastActivity || "",
      balance: obj[uid].balance || 0
    }));

    res.json(arr);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed" });
  }
});

// ----------------------
// 修改余额（后台 → 用户余额）
// ----------------------
app.post("/api/admin/balance", async (req, res) => {
  try {
    const { user, amount } = req.body;

    if (!user) return res.json({ success: false });

    await update(ref(db, `users/${user}`), { balance: amount });

    res.json({ success: true, balance: amount });
  } catch (e) {
    console.error(e);
    res.json({ success: false });
  }
});

// ----------------------
// Strikingly 前台获取用户余额
// ----------------------
app.get("/api/user/balance", async (req, res) => {
  try {
    const userid = req.query.userid;
    if (!userid) return res.json({ balance: 0 });

    const snapshot = await get(ref(db, `users/${userid}/balance`));
    res.json({ balance: snapshot.exists() ? snapshot.val() : 0 });
  } catch (e) {
    res.json({ balance: 0 });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Server running on " + PORT));
