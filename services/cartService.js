const { getPool } = require("../config/db");
const { isValidProductId } = require("../utils/catalog");
const { toCents, formatCents } = require("../utils/money");
const { withUserTransaction } = require("../config/transaction");

class CartError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}

function readQuantity(value) {
  if (!["string", "number"].includes(typeof value) || !/^[1-9]\d{0,2}$/.test(String(value))) {
    throw new CartError("数量须为 1–999 的正整数；如需移除商品，请点击删除。");
  }
  return Number(value);
}

function readId(value) {
  if (!["string", "number"].includes(typeof value) || !isValidProductId(value)) throw new CartError("商品或购物车条目不存在。", 404);
  return Number(value);
}

function unavailableReason(row, quantity) {
  if (row.status !== "active" || row.deleted_at || !row.is_active) return "商品已下架或所在分类已停用";
  if (row.stock === 0) return "商品暂时缺货";
  if (quantity > row.stock) return `库存不足，目前仅剩 ${row.stock} 件`;
  return "";
}

async function getCart(userId) {
  const [rows] = await getPool().execute(
    `SELECT ci.id, ci.product_id, ci.quantity, p.name, p.sku, p.price, p.stock, p.image_path,
            p.is_demo, p.status, p.deleted_at, c.is_active
     FROM cart_items ci JOIN products p ON p.id = ci.product_id JOIN categories c ON c.id = p.category_id
     WHERE ci.user_id = ? ORDER BY ci.id DESC`, [userId]
  );
  let total = 0n;
  let quantity = 0;
  let validQuantity = 0;
  const items = rows.map(row => {
    const reason = unavailableReason(row, row.quantity);
    const subtotal = toCents(row.price) * BigInt(row.quantity);
    quantity += row.quantity;
    if (!reason) { total += subtotal; validQuantity += row.quantity; }
    return {
      id: row.id, productId: row.product_id, name: row.name, sku: row.sku, quantity: row.quantity,
      price: row.price, subtotal: formatCents(subtotal), stock: row.stock, isDemo: Boolean(row.is_demo),
      image: /^\/images\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(row.image_path) ? row.image_path : "/images/product-placeholder.svg",
      available: !reason, reason,
      canUpdate: row.status === "active" && !row.deleted_at && Boolean(row.is_active) && row.stock > 0,
      maxQuantity: Math.min(row.stock, 999)
    };
  });
  return { items, quantity, validQuantity, total: formatCents(total), unavailableCount: items.filter(item => !item.available).length };
}

async function lockProduct(connection, id) {
  // 总是先锁商品、再锁购物车条目，防止并发加入时覆盖数量或突破库存上限。
  const [rows] = await connection.execute(
    `SELECT p.stock, p.status, p.deleted_at, c.is_active FROM products p
     JOIN categories c ON c.id = p.category_id WHERE p.id = ? FOR UPDATE OF p FOR SHARE OF c`, [id]
  );
  if (!rows.length) throw new CartError("商品不存在或暂时无法加入购物车。", 404);
  return rows[0];
}

function checkQuantity(product, quantity) {
  const reason = unavailableReason(product, quantity);
  if (reason) throw new CartError(`${reason}，请调整数量或选择其他商品。`, 409);
  if (quantity > 999) throw new CartError("每种商品最多保存 999 件，请先调整购物车数量。", 409);
}

async function addItem(userId, productValue, quantityValue) {
  const productId = readId(productValue);
  const quantity = readQuantity(quantityValue);
  return withUserTransaction(userId, async connection => {
    const product = await lockProduct(connection, productId);
    const [rows] = await connection.execute("SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ? FOR UPDATE", [userId, productId]);
    const nextQuantity = (rows[0]?.quantity || 0) + quantity;
    checkQuantity(product, nextQuantity);
    if (rows.length) {
      await connection.execute("UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?", [nextQuantity, rows[0].id, userId]);
    } else {
      await connection.execute("INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)", [userId, productId, quantity]);
    }
  });
}

async function updateItem(userId, itemValue, quantityValue) {
  const itemId = readId(itemValue);
  const quantity = readQuantity(quantityValue);
  return withUserTransaction(userId, async connection => {
    const [existing] = await connection.execute("SELECT product_id FROM cart_items WHERE id = ? AND user_id = ?", [itemId, userId]);
    if (!existing.length) throw new CartError("购物车条目不存在，或已经被移除。", 404);
    const product = await lockProduct(connection, existing[0].product_id);
    const [rows] = await connection.execute("SELECT id FROM cart_items WHERE id = ? AND user_id = ? FOR UPDATE", [itemId, userId]);
    if (!rows.length) throw new CartError("购物车条目不存在，或已经被移除。", 404);
    checkQuantity(product, quantity);
    await connection.execute("UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?", [quantity, itemId, userId]);
  });
}

async function removeItem(userId, itemValue) {
  const itemId = readId(itemValue);
  return withUserTransaction(userId, async connection => {
    const [result] = await connection.execute("DELETE FROM cart_items WHERE id = ? AND user_id = ?", [itemId, userId]);
    if (!result.affectedRows) throw new CartError("购物车条目不存在，或已经被移除。", 404);
  });
}

module.exports = { getCart, addItem, updateItem, removeItem, CartError, readQuantity, unavailableReason };
