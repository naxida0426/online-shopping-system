const test = require("node:test");
const assert = require("node:assert/strict");
const { readDatabaseConfig } = require("../config/database-config");
const { describeDatabaseError } = require("../config/db");

const valid = { DB_HOST: "127.0.0.1", DB_PORT: "3306", DB_NAME: "shopping_test", DB_USER: "test_user", DB_PASSWORD: "unit-test-value-only" };

test("缺少配置或仍使用示例密码时拒绝连接", () => {
  assert.throws(() => readDatabaseConfig({}), error => error.code === "DB_CONFIG_INVALID");
  assert.throws(() => readDatabaseConfig({ ...valid, DB_PASSWORD: "replace_with_local_password" }), /占位符/);
});

test("拒绝非法端口和可注入的库名，异常不泄漏密码", () => {
  for (const port of ["0", "65536", "3306abc", "-1", "3.5"]) {
    assert.throws(() => readDatabaseConfig({ ...valid, DB_PORT: port }), /DB_PORT/);
  }
  assert.throws(() => readDatabaseConfig({ ...valid, DB_NAME: "shopping`; DROP DATABASE mysql" }), error => {
    assert.ok(!error.message.includes(valid.DB_PASSWORD));
    return error.code === "DB_CONFIG_INVALID";
  });
});

test("初始化账号与运行账号分离，保持 DECIMAL 精度", () => {
  const env = { ...valid, DB_INIT_USER: "setup_user", DB_INIT_PASSWORD: "setup-test-value-only" };
  assert.equal(readDatabaseConfig(env).user, "test_user");
  assert.equal(readDatabaseConfig(env, { initialize: true }).user, "setup_user");
  assert.equal(readDatabaseConfig(env).decimalNumbers, false);
  assert.equal(readDatabaseConfig(env).multipleStatements, false);
  assert.throws(() => readDatabaseConfig({ ...env, DB_INIT_PASSWORD: "" }, { initialize: true }), /DB_INIT_PASSWORD/);
});

test("数据库错误提示不直接返回 SQL 或驱动中的敏感信息", () => {
  for (const code of ["ECONNREFUSED", "ER_ACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR", "DB_SCHEMA_MISSING", "UNKNOWN"]) {
    const message = describeDatabaseError({ code, message: "private-password-and-sql" });
    assert.ok(!message.includes("private-password-and-sql"));
  }
});
