require("../config/environment");
const fs = require("node:fs/promises");
const path = require("node:path");
const mysql = require("mysql2/promise");
const { readDatabaseConfig } = require("../config/database-config");
const { describeDatabaseError, requiredTables } = require("../config/db");

async function initializeDatabase() {
  const options = readDatabaseConfig(process.env, { initialize: true });
  const { database, ...serverOptions } = options;
  let connection;
  try {
    connection = await mysql.createConnection(serverOptions);
    // 库名已校验，仍使用 mysql2 标识符转义，禁止将未校验输入拼入 SQL。
    await connection.query("CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci", [database]);
    await connection.changeUser({ database });
    const source = await fs.readFile(path.join(__dirname, "..", "sql", "init.sql"), "utf8");
    // 本项目 SQL 仅包含普通建表/插入语句，无存储过程或含分号的字符串。
    const statements = source.replace(/^\s*--.*$/gm, "").split(";").map(sql => sql.trim()).filter(Boolean);
    for (const statement of statements) await connection.query(statement);
    const [rows] = await connection.execute("SELECT COUNT(*) AS count FROM products WHERE is_demo = 1");
    console.log(`初始化完成：${requiredTables.length} 张业务表，当前有 ${rows[0].count} 件示例商品。`);
    console.log("重复执行不会覆盖已有商品的价格、库存或账号数据；不会创建默认管理员。");
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    throw error;
  } finally {
    if (connection) await connection.end();
  }
}

if (require.main === module) {
  initializeDatabase().catch(error => {
    console.error(`初始化失败：${describeDatabaseError(error)}`);
    console.error("请确认使用 MySQL 8.0.19+（推荐 8.4 LTS），初始化账号有建库、建表权限。DDL 不会整体回滚，修复原因后可重试。");
    process.exitCode = 1;
  });
}

module.exports = { initializeDatabase };
