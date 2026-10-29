const { randomUUID } = require("node:crypto");
const { getPool } = require("../config/db");
const { withUserTransaction } = require("../config/transaction");
const { unavailableReason } = require("./cartService");
const { cartFingerprint, shippingInput, validCheckoutToken } = require("../utils/checkout");
const { toCents, formatCents } = require("../utils/money");
const { isValidProductId } = require("../utils/catalog");
const MAX_ORDER_CENTS = 999999999999n; // orders.total_amount DECIMAL(12,2)

class OrderError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

async function createOrder(userId, token, draft, shipping) {
  if (!validCheckoutToken(token)) throw new OrderError("结算表单已失效，请重新核对购物车。");
  const { values, errors } = shippingInput(shipping);
  if (errors.length) throw new OrderError(errors.join(" "), 422);
  return withUserTransaction(userId, async connection => {
    // 先检查幂等结果，重试时即使购物车已经清空也返回原订单。
    const [[existing]] = await connection.execute("SELECT id FROM orders WHERE user_id = ? AND checkout_token = ?", [userId, token]);
    if (existing) return existing.id;
    if (!draft || draft.token !== token || typeof draft.fingerprint !== "string") throw new OrderError("结算表单已失效，请重新核对购物车。");
    const [cartRows] = await connection.execute("SELECT id, product_id, quantity FROM cart_items WHERE user_id = ? ORDER BY product_id", [userId]);
    if (!cartRows.length) throw new OrderError("购物车为空，请先选择商品。");
    const lines = [];
    let total = 0n;
    // 商品按 ID 顺序锁定，分类使用共享锁，避免不同订单交叉等待商品锁。
    for (const item of cartRows) {
      const [[product]] = await connection.execute(
        `SELECT p.name, p.price, p.stock, p.status, p.deleted_at, c.is_active FROM products p
         JOIN categories c ON c.id = p.category_id WHERE p.id = ? FOR UPDATE OF p FOR SHARE OF c`, [item.product_id]
      );
      if (!product) throw new OrderError("商品已不存在，请返回购物车调整。");
      const reason = unavailableReason(product, item.quantity);
      if (reason) throw new OrderError(`${reason}，订单未创建，请返回购物车调整。`);
      const subtotal = toCents(product.price) * BigInt(item.quantity);
      total += subtotal;
      if (subtotal > MAX_ORDER_CENTS || total > MAX_ORDER_CENTS) throw new OrderError("订单金额超出系统范围，请减少商品数量。", 422);
      lines.push({ id: item.id, productId: item.product_id, name: product.name, price: product.price, quantity: item.quantity, subtotal: formatCents(subtotal) });
    }
    if (cartFingerprint(lines) !== draft.fingerprint) throw new OrderError("商品价格或购物车已变化，请核对本页后再次提交。");
    const orderNo = `SG${randomUUID().replaceAll("-", "").slice(0, 30)}`;
    const [order] = await connection.execute(
      `INSERT INTO orders (order_no, user_id, checkout_token, total_amount, recipient_name, recipient_phone, recipient_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, [orderNo, userId, token, formatCents(total), values.recipientName, values.recipientPhone, values.recipientAddress]
    );
    for (const line of lines) {
      const [stock] = await connection.execute("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ? AND status = 'active' AND deleted_at IS NULL", [line.quantity, line.productId, line.quantity]);
      if (stock.affectedRows !== 1) throw new OrderError("库存发生变化，订单未创建，请重新确认。");
      await connection.execute(
        "INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal) VALUES (?, ?, ?, ?, ?, ?)",
        [order.insertId, line.productId, line.name, line.price, line.quantity, line.subtotal]
      );
    }
    await connection.execute("DELETE FROM cart_items WHERE user_id = ?", [userId]);
    return order.insertId;
  });
}

const orderColumns = `id, order_no AS orderNo, total_amount AS total, order_status AS orderStatus,
  payment_status AS paymentStatus, created_at AS createdAt`;

async function getOrders(userId) {
  const [orders] = await getPool().execute(`SELECT ${orderColumns} FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 20`, [userId]);
  return orders;
}

async function getOwnOrder(userId, id) {
  if (!["string", "number"].includes(typeof id) || !isValidProductId(id)) return null;
  const [[order]] = await getPool().execute(
    `SELECT ${orderColumns}, recipient_name AS recipientName, recipient_phone AS recipientPhone,
     recipient_address AS recipientAddress FROM orders WHERE id = ? AND user_id = ?`, [Number(id), userId]
  );
  if (!order) return null;
  const [items] = await getPool().execute(
    `SELECT product_id AS productId, product_name AS name, unit_price AS price, quantity, subtotal
     FROM order_items WHERE order_id = ? ORDER BY id`, [order.id]
  );
  return { ...order, items };
}

module.exports = { createOrder, getOrders, getOwnOrder, OrderError, MAX_ORDER_CENTS };
