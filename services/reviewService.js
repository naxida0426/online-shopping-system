const { getPool } = require("../config/db");
const { withUserTransaction } = require("../config/transaction");
const { isValidProductId, normalizePage } = require("../utils/catalog");
class ReviewError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}
function reviewInput(body = {}) {
  const rating = typeof body.rating === "string" && /^[1-5]$/.test(body.rating) ? Number(body.rating) : null;
  const content = typeof body.content === "string" ? body.content.trim().replace(/\r\n/g, "\n") : "";
  const errors = [];
  if (!rating) errors.push("请选择 1–5 星评分。");
  if (!content || content.length > 1000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(content)) errors.push("评价须为 1–1000 个字符，不能包含控制字符。");
  return { values: { rating, content }, errors };
}
async function createReview(userId, orderId, itemId, body) {
  if (![orderId, itemId].every(id => ["string", "number"].includes(typeof id) && isValidProductId(id))) throw new ReviewError("订单商品不存在。", 404);
  return withUserTransaction(userId, async c => {
    const [[order]] = await c.execute("SELECT order_status, payment_status FROM orders WHERE id = ? AND user_id = ? FOR UPDATE", [Number(orderId), userId]);
    if (!order) throw new ReviewError("订单不存在或不属于当前账号。", 404);
    const [[item]] = await c.execute("SELECT id FROM order_items WHERE id = ? AND order_id = ? FOR UPDATE", [Number(itemId), Number(orderId)]);
    if (!item) throw new ReviewError("订单商品不存在。", 404);
    if (order.order_status !== "completed" || order.payment_status !== "paid") throw new ReviewError("只有已支付、已完成的订单可以评价。");
    const { values, errors } = reviewInput(body);
    if (errors.length) throw new ReviewError(errors.join(" "), 422);
    const [[existing]] = await c.execute("SELECT id FROM reviews WHERE order_item_id = ?", [item.id]);
    if (existing) throw new ReviewError("这件订单商品已评价，不能重复提交。");
    const [result] = await c.execute("INSERT INTO reviews (order_item_id, rating, content) VALUES (?, ?, ?)", [item.id, values.rating, values.content]);
    return result.insertId;
  });
}
async function attachOrderReviews(userId, orders) {
  const ids = orders.filter(o => o.orderStatus === "completed" && o.paymentStatus === "paid").map(o => o.id);
  orders.forEach(order => { order.reviewItems = []; });
  if (!ids.length) return;
  const [items] = await getPool().execute(`SELECT i.id, i.order_id AS orderId, i.product_id AS productId,
    i.product_name AS name, i.quantity, r.id AS reviewId, r.rating, r.content
    FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN reviews r ON r.order_item_id = i.id
    WHERE o.user_id = ? AND o.id IN (${ids.map(() => "?").join(",")}) ORDER BY i.id`, [userId, ...ids]);
  for (const order of orders) order.reviewItems = items.filter(item => item.orderId === order.id);
}
async function getProductReviews(productId, requestedPage = 1) {
  const from = `FROM reviews r JOIN order_items i ON i.id = r.order_item_id JOIN orders o ON o.id = i.order_id
    JOIN users u ON u.id = o.user_id WHERE i.product_id = ? AND o.order_status = 'completed' AND o.payment_status = 'paid'`;
  const [[summary]] = await getPool().execute(`SELECT COUNT(*) AS total, ROUND(AVG(r.rating), 1) AS average ${from}`, [productId]);
  const total = Number(summary.total), totalPages = Math.max(1, Math.ceil(total / 10)), page = Math.min(normalizePage(requestedPage), totalPages);
  const [reviews] = await getPool().execute(`SELECT r.rating, r.content, r.created_at AS createdAt,
    CASE WHEN u.status = 'deleted' THEN '已注销用户' ELSE CONCAT(LEFT(u.username, 1), '***') END AS author ${from} ORDER BY r.id DESC LIMIT 10 OFFSET ?`, [productId, String((page - 1) * 10)]);
  return { total, average: summary.average, page, totalPages, reviews };
}
module.exports = { reviewInput, createReview, attachOrderReviews, getProductReviews, ReviewError };
