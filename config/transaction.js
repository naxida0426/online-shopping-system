const { getPool } = require("./db");

// 同一用户的购物车修改和结算共用这把锁，避免结算期间新增条目被误清除。
async function withUserTransaction(userId, work) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute("SELECT id FROM users WHERE id = ? AND status = 'active' AND deleted_at IS NULL FOR UPDATE", [userId]);
    if (!users.length) {
      const error = new Error("账户状态已变化，请重新登录。");
      error.code = "AUTH_USER_INACTIVE";
      throw error;
    }
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}

module.exports = { withUserTransaction };
