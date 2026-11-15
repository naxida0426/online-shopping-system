const { getPool } = require("../config/db");
const { withUserTransaction } = require("../config/transaction");
const { isValidProductId } = require("../utils/catalog");
const { orderPagination } = require("../utils/orders");
class FavoriteError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}
async function markFavorites(userId, products) {
  if (!userId || !products.length) return;
  const [rows] = await getPool().execute(`SELECT product_id FROM favorites WHERE user_id = ? AND product_id IN (${products.map(() => "?").join(",")})`, [userId, ...products.map(p => p.id)]);
  const ids = new Set(rows.map(row => row.product_id));
  products.forEach(product => { product.isFavorite = ids.has(product.id); });
}
async function setFavorite(userId, productId, action) {
  if (!isValidProductId(productId) || !["string", "number"].includes(typeof productId)) throw new FavoriteError("商品不存在。", 404);
  if (!["add", "remove"].includes(action)) throw new FavoriteError("无效的收藏操作。", 422);
  return withUserTransaction(userId, async c => {
    if (action === "remove") {
      await c.execute("DELETE FROM favorites WHERE user_id = ? AND product_id = ?", [userId, Number(productId)]);
      return false;
    }
    const [[product]] = await c.execute(`SELECT p.id FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.id = ? AND p.status = 'active' AND p.deleted_at IS NULL AND c.is_active = 1 FOR SHARE OF p FOR SHARE OF c`, [Number(productId)]);
    if (!product) throw new FavoriteError("商品已下架或不存在，无法收藏。", 404);
    await c.execute("INSERT INTO favorites (user_id, product_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE product_id = favorites.product_id", [userId, Number(productId)]);
    return true;
  });
}
async function listFavorites(userId, page = 1) {
  const [[count]] = await getPool().execute("SELECT COUNT(*) AS total FROM favorites WHERE user_id = ?", [userId]);
  const pagination = orderPagination(Number(count.total), page, 20);
  const [products] = await getPool().execute(`SELECT p.id, p.name, p.price, p.stock, p.image_path AS image,
    (p.status = 'active' AND p.deleted_at IS NULL AND c.is_active = 1) AS available
    FROM favorites f JOIN products p ON p.id = f.product_id JOIN categories c ON c.id = p.category_id
    WHERE f.user_id = ? ORDER BY f.id DESC LIMIT ? OFFSET ?`, [userId, String(pagination.pageSize), String((pagination.page - 1) * pagination.pageSize)]);
  products.forEach(p => {
    p.isFavorite = true;
    if (!/^\/images\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(p.image)) p.image = "/images/product-placeholder.svg";
  });
  return { products, pagination };
}
module.exports = { markFavorites, setFavorite, listFavorites, FavoriteError };
