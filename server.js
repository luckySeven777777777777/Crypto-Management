// ===== ✅【唯一正确位置】统一标记 processed =====
if (isApproved || isRejected) {
  await ref.update({ processed: true });
}

    // ===== 再广播订单更新 =====
    const newSnap = await ref.once('value');
    const latestOrder = { ...newSnap.val(), orderId };

    broadcastSSE({
      type: 'update',
      typeName: type,
      userId: latestOrder.userId,
      order: latestOrder,
      action: { admin: adminId, status, note }
    });
// ✅【新增但不影响其他功能】提款专用状态同步
if (type === 'withdraw') {
  broadcastSSE({
    type: "update",
    userId: latestOrder.userId,   // 用于 SSE 过滤
    order: {
      orderId: orderId,
      type: "withdraw",
      status: status,             // approved / rejected
      userId: latestOrder.userId  // ⭐⭐⭐ 核心字段（前端匹配用）
    }
  });
}
    return res.json({ ok: true });
 
  } catch (e) {
    console.error('transaction.update err', e);
    return res.status(500).json({ ok:false, error: e.message });
  }
});
