require("../config/environment");
const bcrypt = require("bcryptjs");
const { createHash } = require("node:crypto");
const { registrationInput } = require("../services/userService");
const { getPool, closePool } = require("../config/db");

async function createInitialAdmin(env = process.env) {
  const input = registrationInput({ username: env.BOOTSTRAP_ADMIN_USERNAME, email: env.BOOTSTRAP_ADMIN_EMAIL, password: env.BOOTSTRAP_ADMIN_PASSWORD, confirmPassword: env.BOOTSTRAP_ADMIN_PASSWORD });
  if (input.errors.length || input.password.length < 12 || /^replace_with_|^change_me|^your_/i.test(input.password)) throw new Error("请在本机 .env 填写 BOOTSTRAP_ADMIN_USERNAME、BOOTSTRAP_ADMIN_EMAIL 和至少 12 字符的独立强密码。");
  const c = await getPool().getConnection();
  const lock = `shop_admin_${createHash('sha256').update(env.DB_NAME || '').digest('hex').slice(0,32)}`;
  let locked = false;
  try {
    const [[result]] = await c.execute("SELECT GET_LOCK(?, 5) AS acquired", [lock]);
    if (result.acquired !== 1) throw new Error("初始化正在执行，请稍后重试。");
    locked = true;
    const [[count]] = await c.execute("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL");
    if (count.n) return false;
    const hash = await bcrypt.hash(input.password, 12);
    await c.execute("INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, 'admin')", [input.username, input.email, hash]);
    return true;
  } finally {
    if (locked) await c.execute("SELECT RELEASE_LOCK(?)", [lock]).catch(() => {});
    c.release();
  }
}
if (require.main === module) createInitialAdmin().then(created => console.log(created ? "首位管理员已创建，请使用普通登录页登录。建议随后从 .env 删除初始化密码。" : "已存在有效管理员，未修改任何账号。"))
  .catch(error => { console.error(error.code ? "管理员创建失败，请检查配置及用户名、邮箱是否重复。" : error.message); process.exitCode = 1; }).finally(closePool);
module.exports = { createInitialAdmin };
