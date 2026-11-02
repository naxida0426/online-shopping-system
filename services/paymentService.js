const { withUserTransaction } = require("../config/transaction");
const { OrderError } = require("../utils/order-error");
const { lockOrder, ensureUnpaid, savePayment, closeUnpaidOrder, expireLockedOrder } = require("./orderLifecycle");
async function simulatePayment(userId, id, outcome) {
  if (typeof outcome !== "string" || !["success", "cancel"].includes(outcome)) throw new OrderError("请选择模拟支付成功或取消本次支付。", 422);
  return withUserTransaction(userId, async c => {
    const { order: o, payment: p } = await lockOrder(c, userId, id);
    if (o.payment_status === "paid" && o.order_status !== "cancelled" && p?.status === "succeeded") {
      if (outcome === "success") return "already_paid";
      throw new OrderError("订单已完成模拟支付，不能取消本次支付。");
    }
    if (await expireLockedOrder(c, o, p)) return "order_expired";
    ensureUnpaid(o, p);
    if (outcome === "cancel") { if (p?.status !== "cancelled") await savePayment(c, o, p, "cancelled"); return "payment_cancelled"; }
    // 支付使用订单快照，不再次扣减库存；邮件任务与支付状态一同落库。
    await savePayment(c, o, p, "succeeded");
    await c.execute("UPDATE orders SET order_status = 'confirmed', payment_status = 'paid', paid_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?", [o.id, userId]);
    await c.execute("INSERT INTO order_emails (order_id) VALUES (?) ON DUPLICATE KEY UPDATE order_id = order_emails.order_id", [o.id]);
    return "paid";
  });
}
async function cancelOrder(userId, id) {
  return withUserTransaction(userId, async c => {
    const { order: o, payment: p } = await lockOrder(c, userId, id);
    if (o.order_status === "cancelled" && o.payment_status === "cancelled" && p?.status === "cancelled") return "already_cancelled";
    if (await expireLockedOrder(c, o, p)) return "order_expired";
    await closeUnpaidOrder(c, o, p, "customer");
    return "order_cancelled";
  });
}
module.exports = { simulatePayment, cancelOrder };
