const { getPool } = require("../config/db");
const { withUserTransaction } = require("../config/transaction");
const { shippingInput } = require("../utils/checkout");
const { isValidProductId } = require("../utils/catalog");

class AddressError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}
const columns = "id, recipient_name AS recipientName, recipient_phone AS recipientPhone, recipient_address AS recipientAddress, is_default AS isDefault";
async function listAddresses(userId) {
  const [rows] = await getPool().execute(`SELECT ${columns} FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC`, [userId]);
  return rows;
}
async function getAddress(userId, id, connection = getPool(), lock = false) {
  if (!["string", "number"].includes(typeof id) || !isValidProductId(id)) throw new AddressError("收货地址不存在或不属于当前账号。", 404);
  const [[row]] = await connection.execute(`SELECT ${columns} FROM addresses WHERE id = ? AND user_id = ?${lock ? " FOR UPDATE" : ""}`, [Number(id), userId]);
  if (!row) throw new AddressError("收货地址不存在或不属于当前账号。", 404);
  return row;
}
async function saveAddress(userId, id, body) {
  const { values, errors } = shippingInput(body);
  if (errors.length) throw new AddressError(errors.join(" "), 422);
  return withUserTransaction(userId, async c => {
    const existing = id === null ? null : await getAddress(userId, id, c, true);
    const [[count]] = await c.execute("SELECT COUNT(*) AS total FROM addresses WHERE user_id = ?", [userId]);
    if (!existing && count.total >= 20) throw new AddressError("最多保存 20 个收货地址，请先删除不再使用的地址。");
    const isDefault = body.isDefault === "yes" || !!existing?.isDefault || count.total === 0;
    if (isDefault) await c.execute("UPDATE addresses SET is_default = 0 WHERE user_id = ? AND is_default = 1", [userId]);
    const params = [values.recipientName, values.recipientPhone, values.recipientAddress, isDefault ? 1 : 0];
    if (existing) {
      await c.execute("UPDATE addresses SET recipient_name = ?, recipient_phone = ?, recipient_address = ?, is_default = ? WHERE id = ? AND user_id = ?", [...params, existing.id, userId]);
      return existing.id;
    }
    const [row] = await c.execute("INSERT INTO addresses (recipient_name, recipient_phone, recipient_address, is_default, user_id) VALUES (?, ?, ?, ?, ?)", [...params, userId]);
    return row.insertId;
  });
}
async function changeAddress(userId, id, action) {
  if (!["default", "delete"].includes(action)) throw new AddressError("无效的地址操作。", 422);
  return withUserTransaction(userId, async c => {
    const row = await getAddress(userId, id, c, true);
    if (action === "default") {
      await c.execute("UPDATE addresses SET is_default = 0 WHERE user_id = ? AND is_default = 1", [userId]);
      await c.execute("UPDATE addresses SET is_default = 1 WHERE id = ? AND user_id = ?", [row.id, userId]);
    } else {
      await c.execute("DELETE FROM addresses WHERE id = ? AND user_id = ?", [row.id, userId]);
      if (row.isDefault) await c.execute("UPDATE addresses SET is_default = 1 WHERE user_id = ? ORDER BY id DESC LIMIT 1", [userId]);
    }
  });
}
module.exports = { listAddresses, getAddress, saveAddress, changeAddress, AddressError };
