const express = require("express");
const admin = require("firebase-admin");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

// =============================================================
//  FIREBASE ADMIN – BASE64 安全加载（Railway 100% 可运行）
// =============================================================
if (!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    console.error("❌ ERROR: 缺少环境变量 FIREBASE_SERVICE_ACCOUNT_BASE64");
    process.exit(1);
}

let decodedJSON = "";
try {
    decodedJSON = Buffer.from(
        process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
        "base64"
    ).toString("utf-8");

    const serviceAccount = JSON.parse(decodedJSON);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });

    console.log("✅ Firebase Admin 初始化成功");
} catch (err) {
    console.error("❌ Firebase 初始化失败:", err);
    process.exit(1);
}

const db = admin.firestore();


// =============================================================
//  API SECTION
// =============================================================

// 获取余额（前端用）
app.get("/api/balance/:uid", async (req, res) => {
    try {
        const uid = req.params.uid;
        const userRef = db.collection("users").doc(uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.json({ balance: 0 });
        }

        return res.json({ balance: userDoc.data().balance || 0 });
    } catch (err) {
        console.error("balance error:", err);
        res.status(500).json({ error: "server error" });
    }
});

// 后台：充值审核
app.post("/api/admin/recharge/approve", async (req, res) => {
    try {
        const { id, uid, amount } = req.body;

        await db.collection("orders").doc(id).update({
            status: "success",
        });

        await db.collection("users").doc(uid).update({
            balance: admin.firestore.FieldValue.increment(amount),
        });

        return res.json({ ok: true });
    } catch (err) {
        console.error("approve error:", err);
        res.status(500).json({ error: "server error" });
    }
});

// 后台：提现审核
app.post("/api/admin/withdraw/approve", async (req, res) => {
    try {
        const { id, uid, amount } = req.body;

        await db.collection("orders").doc(id).update({
            status: "success",
        });

        await db.collection("users").doc(uid).update({
            balance: admin.firestore.FieldValue.increment(-amount),
        });

        return res.json({ ok: true });
    } catch (err) {
        console.error("withdraw approve error:", err);
        res.status(500).json({ error: "server error" });
    }
});

// BuySell 扣费
app.post("/api/buysell", async (req, res) => {
    try {
        const { uid, amount } = req.body;

        await db.collection("users").doc(uid).update({
            balance: admin.firestore.FieldValue.increment(-amount),
        });

        return res.json({ ok: true });
    } catch (err) {
        console.error("buysell error:", err);
        res.status(500).json({ error: "server error" });
    }
});

// =============================================================
//  START SERVER
// =============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
