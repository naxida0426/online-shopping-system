const { checkDatabase, getPool, closePool, describeDatabaseError } = require("../config/db");

async function main() {
  try {
    const result = await checkDatabase();
    const [rows] = await getPool().execute("SELECT COUNT(*) AS count FROM products WHERE status = 'active' AND deleted_at IS NULL");
    console.log(`MySQL 连接成功，${result.tables} 张业务表齐全，上架商品 ${rows[0].count} 件。`);
  } catch (error) {
    console.error(`数据库检查失败：${describeDatabaseError(error)}`);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main();
