async function migrateAutoShipping(connection) {
  const [result] = await connection.execute(`UPDATE orders o JOIN payments p ON p.order_id = o.id
    SET o.order_status = 'shipped'
    WHERE o.order_status = 'confirmed' AND o.payment_status = 'paid'
      AND p.status = 'succeeded' AND p.method = 'simulated' AND p.amount = o.total_amount`);
  return result.affectedRows;
}
module.exports = { migrateAutoShipping };
