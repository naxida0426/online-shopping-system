require("./environment");
const mysql = require("mysql2/promise");
const { readDatabaseConfig } = require("./database-config");

const requiredTables = ["users", "categories", "products", "cart_items", "orders", "order_items", "payments"];
let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...readDatabaseConfig(),
      waitForConnections: true,
      connectionLimit: 10,
      maxIdle: 5,
      idleTimeout: 60000,
      queueLimit: 50
    });
  }
  return pool;
}

async function checkDatabase() {
  const connection = await getPool().getConnection();
  try {
    await connection.execute("SELECT 1");
    const [rows] = await connection.execute(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`
    );
    const names = new Set(rows.map(row => row.name));
    if (requiredTables.some(name => !names.has(name))) {
      const error = new Error("数据库表尚未完整初始化。");
      error.code = "DB_SCHEMA_MISSING";
      throw error;
    }
    return { connected: true, tables: requiredTables.length };
  } finally {
    connection.release();
  }
}

function describeDatabaseError(error) {
  switch (error.code) {
    case "DB_CONFIG_INVALID": return error.message;
    case "ER_ACCESS_DENIED_ERROR":
    case "ER_DBACCESS_DENIED_ERROR":
    case "ER_TABLEACCESS_DENIED_ERROR":
      return "MySQL 账号验证或权限检查失败，请检查本机 .env 中的账号、密码和数据库授权。";
    case "ECONNREFUSED":
    case "ETIMEDOUT":
    case "ENOTFOUND":
    case "EHOSTUNREACH":
      return "无法连接 MySQL，请确认数据库服务已启动，并检查 DB_HOST 和 DB_PORT。";
    case "PROTOCOL_CONNECTION_LOST":
    case "ECONNRESET":
    case "ER_SERVER_SHUTDOWN":
      return "MySQL 连接已中断，请确认数据库服务已启动后重试。";
    case "ER_BAD_DB_ERROR":
    case "DB_SCHEMA_MISSING":
    case "ER_NO_SUCH_TABLE":
    case "ER_BAD_FIELD_ERROR":
      return "数据库尚未初始化或表结构不匹配，请在项目目录执行 npm run db:init，并核对 README。";
    default:
      return "数据库暂时不可用，请检查本机配置、MySQL 服务及表结构后重试。";
  }
}

async function closePool() {
  if (pool) {
    const current = pool;
    pool = undefined;
    await current.end();
  }
}

module.exports = { getPool, checkDatabase, describeDatabaseError, closePool, requiredTables };
