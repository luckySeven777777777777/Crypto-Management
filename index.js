import express from "express";
import cors from "cors";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const app = express();
app.use(cors());
app.use(express.json());

// Firebase 初始化
initializeApp({
  credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
});

const db = getFirestore();

// 👉 获取余额（给前端用）
app.get("/balance", async (req, res) => {
  try {
    const userid = req.query.userid;
    if (!userid) return res.json({ balance: 0 });

    const doc = await db.collection("users").doc(userid).get();
    if (!doc.exists) return res.json({ balance: 0 });

    res.json({ balance: doc.data().balance || 0 });

  } catch (err) {
    console.log(err);
    res.json({ balance: 0 });
  }
});

// 👉 管理后台修改余额（加钱/扣钱）
app.post("/set-balance", async (req, res) => {
  try {
    const { userid, balance } = req.body;

    if (!userid) return res.json({ success: false });

    await db.collection("users").doc(userid).set(
      { balance: Number(balance) },
      { merge: true }
    );

    res.json({ success: true });

  } catch (err) {
    console.log(err);
    res.json({ success: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("API running on port " + PORT));
