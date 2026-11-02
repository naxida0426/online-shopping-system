const { getPool } = require("../config/db");
const { lockOrder, expireLockedOrder } = require("./orderLifecycle");

async function expireOrders({ userId, orderId, limit = 100, onError } = {}) {
  const params = [], conditions = ["order_status = 'pending'", "payment_status = 'unpaid'", "expires_at <= CURRENT_TIMESTAMP"];
  if (userId !== undefined) { conditions.push("user_id = ?"); params.push(userId); }
  if (orderId !== undefined) { conditions.push("id = ?"); params.push(orderId); }
  const [due] = await getPool().execute(`SELECT id, user_id FROM orders WHERE ${conditions.join(" AND ")}
    ORDER BY expires_at, id LIMIT ?`, [...params, String(limit)]);
  let closed = 0;
  for (const row of due) {
    const c = await getPool().getConnection();
    try {
      await c.beginTransaction();
      // 与支付、取消、结算一致：先锁用户，再锁订单及商品。停用账号也需释放库存。
      await c.execute("SELECT id FROM users WHERE id = ? FOR UPDATE", [row.user_id]);
      const { order, payment } = await lockOrder(c, row.user_id, row.id);
      const expired = await expireLockedOrder(c, order, payment);
      await c.commit();
      if (expired) closed++;
    } catch (error) {
      await c.rollback().catch(() => {});
      if (!onError) throw error;
      onError(error);
    } finally { c.release(); }
  }
  return closed;
}

function startOrderExpiryWorker({ intervalMs = 15000, onError = () => console.error("[orders] 超时关闭未完成，将在下轮重试。") } = {}) {
  let active, stopped = false;
  function tick() {
    if (stopped || active) return;
    active = expireOrders({ onError }).catch(onError).finally(() => { active = undefined; });
  }
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return async () => { stopped = true; clearInterval(timer); await active; };
}
module.exports = { expireOrders, startOrderExpiryWorker };
