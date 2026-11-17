const { randomUUID } = require("node:crypto");
const { getPool } = require("../config/db");
const { withUserTransaction } = require("../config/transaction");
const { unavailableReason } = require("./cartService");
const { cartFingerprint, shippingInput, validCheckoutToken } = require("../utils/checkout");
const { toCents, formatCents } = require("../utils/money");
const { isValidProductId } = require("../utils/catalog");
const { readOrderOptions, orderPagination } = require("../utils/orders");
const MAX_ORDER_CENTS = 999999999999n; // orders.total_amount DECIMAL(12,2)

const { OrderError } = require("../utils/order-error");
const { paymentTimeoutSeconds } = require("../config/orders");
const { expireOrders } = require("./orderExpiryService");
const { flashPrice } = require('../utils/promotions');

async function createOrder(userId, token, draft, shipping) {
  if (!validCheckoutToken(token)) throw new OrderError("结算表单已失效，请重新核对购物车。");
  const { values, errors } = shippingInput(shipping);
  if (errors.length) throw new OrderError(errors.join(" "), 422);
  return withUserTransaction(userId, async connection => {
    // 先检查幂等结果，重试时即使购物车已经清空也返回原订单。
    const [[existing]] = await connection.execute("SELECT id FROM orders WHERE user_id = ? AND checkout_token = ?", [userId, token]);
    if (existing) return existing.id;
    if (!draft || draft.token !== token || typeof draft.fingerprint !== "string") throw new OrderError("结算表单已失效，请重新核对购物车。");
    const [cartRows] = await connection.execute("SELECT id, product_id, quantity,flash_offer_id FROM cart_items WHERE user_id = ? ORDER BY product_id", [userId]);
    if (!cartRows.length) throw new OrderError("购物车为空，请先选择商品。");
    // Lock all activity rows before products, matching flash add/rotation.
    const offerIds=[...new Set(cartRows.map(item=>item.flash_offer_id).filter(Boolean))].sort((a,b)=>a-b);
    for(const offerId of offerIds)await connection.execute('SELECT id FROM flash_offers WHERE id=? FOR SHARE',[offerId]);
    const lines = [];
    let total = 0n;
    let flashDiscount=0n;
    // 商品按 ID 顺序锁定，分类使用共享锁，避免不同订单交叉等待商品锁。
    for (const item of cartRows) {
      const [[product]] = await connection.execute(
        `SELECT p.name, p.price, p.stock, p.status, p.deleted_at, c.is_active FROM products p
         JOIN categories c ON c.id = p.category_id WHERE p.id = ? FOR UPDATE OF p FOR SHARE OF c`, [item.product_id]
      );
      if (!product) throw new OrderError("商品已不存在，请返回购物车调整。");
      const reason = unavailableReason(product, item.quantity);
      if (reason) throw new OrderError(`${reason}，订单未创建，请返回购物车调整。`);
      let price=product.price;
      if(item.flash_offer_id){
        const [[offer]]=await connection.execute('SELECT id FROM flash_offers WHERE id=? AND expires_at>NOW() FOR SHARE',[item.flash_offer_id]);
        if(offer)price=flashPrice(product.price);
      }
      const subtotal = toCents(price) * BigInt(item.quantity);
      flashDiscount+=(toCents(product.price)-toCents(price))*BigInt(item.quantity);
      total += subtotal;
      if (subtotal > MAX_ORDER_CENTS || total > MAX_ORDER_CENTS) throw new OrderError("订单金额超出系统范围，请减少商品数量。", 422);
      lines.push({ id: item.id, productId: item.product_id, name: product.name, price, quantity: item.quantity, subtotal: formatCents(subtotal) });
    }
    if (cartFingerprint(lines) !== draft.fingerprint) throw new OrderError("商品价格或购物车已变化，请核对本页后再次提交。");
    const orderNo = `SG${randomUUID().replaceAll("-", "").slice(0, 30)}`;
    const [order] = await connection.execute(
      `INSERT INTO orders (order_no, user_id, checkout_token, total_amount, recipient_name, recipient_phone, recipient_address, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND))`, [orderNo, userId, token, formatCents(total), values.recipientName, values.recipientPhone, values.recipientAddress, paymentTimeoutSeconds()]
    );
    if(flashDiscount>0n)await connection.execute('INSERT INTO order_promotions(order_id,items_amount,flash_discount) VALUES(?,?,?)',[order.insertId,formatCents(total),formatCents(flashDiscount)]);
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

const orderColumns = `o.id, o.order_no AS orderNo, o.total_amount AS total, o.order_status AS orderStatus,
  o.payment_status AS paymentStatus, o.created_at AS createdAt, o.paid_at AS paidAt, o.cancelled_at AS cancelledAt,
  o.expires_at AS expiresAt, o.cancel_reason AS cancelReason,
  GREATEST(0, TIMESTAMPDIFF(SECOND, CURRENT_TIMESTAMP, o.expires_at)) AS remainingSeconds`;

async function getOrders(userId, input = {}) {
  await expireOrders({ userId });
  const options = readOrderOptions(input), conditions = ["o.user_id = ?"], params = [userId];
  const filters = { unpaid: "o.order_status = 'pending' AND o.payment_status = 'unpaid'", paid: "o.payment_status = 'paid' AND o.order_status <> 'cancelled'", shipped: "o.order_status = 'shipped' AND o.payment_status = 'paid'", completed: "o.order_status = 'completed' AND o.payment_status = 'paid'", cancelled: "o.order_status = 'cancelled'" };
  if (filters[options.status]) conditions.push(filters[options.status]);
  if (options.query) { conditions.push("o.order_no LIKE ? ESCAPE '!'"); params.push(`%${options.query.replace(/[!%_]/g, "!$&")}%`); }
  const where = `FROM orders o WHERE ${conditions.join(" AND ")}`;
  const [[count]] = await getPool().execute(`SELECT COUNT(*) AS total ${where}`, params);
  const pagination = orderPagination(Number(count.total), options.page);
  const [orders] = await getPool().execute(`SELECT ${orderColumns} ${where} ORDER BY o.id DESC LIMIT ? OFFSET ?`, [...params, String(pagination.pageSize), String((pagination.page - 1) * pagination.pageSize)]);
  await require("./reviewService").attachOrderReviews(userId, orders);
  return { orders, pagination, ...options, page: pagination.page };
}

async function getOwnOrder(userId, id) {
  if (!["string", "number"].includes(typeof id) || !isValidProductId(id)) return null;
  await expireOrders({ userId, orderId: Number(id) });
  const [[order]] = await getPool().execute(
    `SELECT ${orderColumns}, COALESCE(d.items_amount,o.total_amount) AS itemsAmount,
     COALESCE(d.flash_discount,0.00) AS flashDiscount,COALESCE(d.coupon_discount,0.00) AS couponDiscount,d.coupon_code AS couponCode,
     o.recipient_name AS recipientName, o.recipient_phone AS recipientPhone,
     o.recipient_address AS recipientAddress, p.payment_no AS paymentNo, p.amount AS paymentAmount,
     p.status AS recordStatus, p.paid_at AS recordPaidAt, e.status AS emailStatus, e.attempts AS emailAttempts
     FROM orders o LEFT JOIN payments p ON p.order_id = o.id LEFT JOIN order_emails e ON e.order_id = o.id LEFT JOIN order_promotions d ON d.order_id=o.id
     WHERE o.id = ? AND o.user_id = ?`, [Number(id), userId]
  );
  if (!order) return null;
  const [items] = await getPool().execute(
    `SELECT product_id AS productId, product_name AS name, unit_price AS price, quantity, subtotal
     FROM order_items WHERE order_id = ? ORDER BY id`, [order.id]
  );
  const { paymentNo, paymentAmount, recordStatus, recordPaidAt, ...details } = order;
  return { ...details, originalAmount:formatCents(toCents(order.itemsAmount)+toCents(order.flashDiscount)), items, canReceive: order.orderStatus === "shipped" && order.paymentStatus === "paid", canPay: order.orderStatus === "pending" && order.paymentStatus === "unpaid",
    payment: paymentNo ? { paymentNo, amount: paymentAmount, status: recordStatus, paidAt: recordPaidAt } : null };
}

async function confirmReceipt(userId, id) {
  if (!["string", "number"].includes(typeof id) || !isValidProductId(id)) throw new OrderError("订单不存在或不属于当前账号。", 404);
  return withUserTransaction(userId, async c => {
    const [[order]] = await c.execute("SELECT order_no, order_status, payment_status FROM orders WHERE id = ? AND user_id = ? FOR UPDATE", [Number(id), userId]);
    if (!order) throw new OrderError("订单不存在或不属于当前账号。", 404);
    if (order.order_status === "completed" && order.payment_status === "paid") return { orderNo: order.order_no, already: true };
    if (order.order_status !== "shipped" || order.payment_status !== "paid") throw new OrderError("只能确认本人已支付、已发货订单的收货。");
    await c.execute("UPDATE orders SET order_status = 'completed' WHERE id = ? AND user_id = ?", [Number(id), userId]);
    return { orderNo: order.order_no, already: false };
  });
}

module.exports = { createOrder, getOrders, getOwnOrder, confirmReceipt, OrderError, MAX_ORDER_CENTS };
