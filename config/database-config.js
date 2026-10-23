class DatabaseConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.code = "DB_CONFIG_INVALID";
  }
}

function readDatabaseConfig(env = process.env, { initialize = false } = {}) {
  const user = initialize && env.DB_INIT_USER ? env.DB_INIT_USER : env.DB_USER;
  const password = initialize && env.DB_INIT_USER ? env.DB_INIT_PASSWORD : env.DB_PASSWORD;
  const required = { DB_HOST: env.DB_HOST, DB_NAME: env.DB_NAME };
  required[initialize && env.DB_INIT_USER ? "DB_INIT_USER" : "DB_USER"] = user;
  required[initialize && env.DB_INIT_USER ? "DB_INIT_PASSWORD" : "DB_PASSWORD"] = password;
  const missing = Object.keys(required).filter(key => !required[key] || !required[key].trim());
  if (missing.length) {
    throw new DatabaseConfigurationError(`数据库尚未配置：请在本机 .env 中填写 ${missing.join("、")}。`);
  }
  if (/^(replace_with_|change_me|your_)/i.test(password)) {
    throw new DatabaseConfigurationError("请将 .env 中的数据库密码占位符替换为本机实际密码。");
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(env.DB_NAME)) {
    throw new DatabaseConfigurationError("DB_NAME 应为不超过 64 个字符的字母、数字和下划线，且不以数字开头。");
  }
  const port = env.DB_PORT || "3306";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new DatabaseConfigurationError("DB_PORT 必须为 1 到 65535 之间的整数。");
  }
  return {
    host: env.DB_HOST.trim(),
    port: Number(port),
    user: user.trim(),
    password,
    database: env.DB_NAME,
    charset: "utf8mb4",
    connectTimeout: 5000,
    // 金额保留为 DECIMAL 字符串，避免隐式转换成浮点数。
    decimalNumbers: false,
    dateStrings: true,
    multipleStatements: false
  };
}

module.exports = { DatabaseConfigurationError, readDatabaseConfig };
