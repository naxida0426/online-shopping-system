const { paymentTimeoutSeconds } = require("../config/orders");

async function migrateBonus(connection) {
  paymentTimeoutSeconds();
  // 仅补充缺失字段/索引；旧记录使用固定默认 30 分钟，避免演示配置改变旧订单。
  const [columns] = await connection.execute("SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders'");
  const names = new Set(columns.map(row => row.name));
  if (!names.has("expires_at")) await connection.query("ALTER TABLE orders ADD COLUMN expires_at DATETIME NULL");
  if (!names.has("cancel_reason")) await connection.query("ALTER TABLE orders ADD COLUMN cancel_reason VARCHAR(20) NULL");
  await connection.query("UPDATE orders SET expires_at = DATE_ADD(created_at, INTERVAL 1800 SECOND) WHERE expires_at IS NULL AND order_status = 'pending' AND payment_status = 'unpaid'");
  const [indexes] = await connection.execute("SELECT INDEX_NAME AS name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'orders' AND index_name = 'idx_orders_expiry'");
  if (!indexes.length) await connection.query("ALTER TABLE orders ADD INDEX idx_orders_expiry (order_status, payment_status, expires_at)");
}
module.exports = { migrateBonus };
