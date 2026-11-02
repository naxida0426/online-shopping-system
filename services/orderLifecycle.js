const { randomUUID } = require("node:crypto");
const { isValidProductId } = require("../utils/catalog");
const { OrderError } = require("../utils/order-error");

async function lockOrder(c, userId, id) {
  if (!["string", "number"].includes(typeof id) || !isValidProductId(id)) throw new OrderError("订单不存在或不属于当前账号。", 404);
  const [[order]] = await c.execute(`SELECT id, total_amount, order_status, payment_status,
    expires_at <= CURRENT_TIMESTAMP AS expired FROM orders WHERE id = ? AND user_id = ? FOR UPDATE`, [Number(id), userId]);
  if (!order) throw new OrderError("订单不存在或不属于当前账号。", 404);
  const [[payment]] = await c.execute("SELECT id, amount, method, status FROM payments WHERE order_id = ? FOR UPDATE", [order.id]);
  if (payment && (payment.amount !== order.total_amount || payment.method !== "simulated")) throw new OrderError("支付记录与订单不一致，暂时无法操作。");
  return { order, payment };
}
function ensureUnpaid(o, p) {
  if (o.order_status !== "pending" || o.payment_status !== "unpaid") throw new OrderError("订单状态已变化，只能操作待支付的订单。");
  if (p?.status === "succeeded" || p?.status === "refunded") throw new OrderError("支付记录与订单状态不一致，暂时无法操作。");
}
async function savePayment(c, o, p, status) {
  const timestamp = status === "succeeded" ? "CURRENT_TIMESTAMP" : "NULL";
  if (p) await c.execute(`UPDATE payments SET status = ?, paid_at = ${timestamp} WHERE id = ?`, [status, p.id]);
  else await c.execute(`INSERT INTO payments (order_id, payment_no, amount, method, status, paid_at) VALUES (?, ?, ?, 'simulated', ?, ${timestamp})`, [o.id, `SP${randomUUID().replaceAll("-", "")}`, o.total_amount, status]);
}
async function closeUnpaidOrder(c, o, p, reason) {
  ensureUnpaid(o, p);
  const [items] = await c.execute("SELECT product_id, quantity FROM order_items WHERE order_id = ? ORDER BY product_id, id", [o.id]);
  if (!items.length) throw new OrderError("订单明细不完整，暂时无法关闭。");
  for (const item of items) {
    const [[product]] = await c.execute("SELECT stock FROM products WHERE id = ? FOR UPDATE", [item.product_id]);
    if (!product || product.stock + item.quantity > 4294967295) throw new OrderError("库存记录无法恢复，关闭未执行。");
    await c.execute("UPDATE products SET stock = stock + ? WHERE id = ?", [item.quantity, item.product_id]);
  }
  await savePayment(c, o, p, "cancelled");
  await c.execute(`UPDATE orders SET order_status = 'cancelled', payment_status = 'cancelled',
    cancelled_at = CURRENT_TIMESTAMP, cancel_reason = ? WHERE id = ?`, [reason, o.id]);
}
async function expireLockedOrder(c, o, p) {
  if (o.order_status !== "pending" || o.payment_status !== "unpaid" || !o.expired) return false;
  await closeUnpaidOrder(c, o, p, "timeout");
  return true;
}
module.exports = { lockOrder, ensureUnpaid, savePayment, closeUnpaidOrder, expireLockedOrder };
