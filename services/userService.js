const bcrypt = require("bcryptjs");
const { randomBytes } = require("node:crypto");
const { getPool } = require("../config/db");
const { isValidEmail } = require("../utils/email");
const { retiredIdentity } = require('../utils/account-identity');
const rounds = 12;
let dummyHash;

function registrationInput(body = {}) {
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const errors = [];
  if (!/^[\p{Script=Han}a-zA-Z0-9_]{3,30}$/u.test(username)) errors.push("用户名须为 3–30 个中文、字母、数字或下划线。");
  if (!isValidEmail(email)) errors.push("请输入单个有效的普通邮箱地址（不超过 191 个字符）。");
  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) errors.push("密码至少 8 个字符，且不超过 72 个 UTF-8 字节（中文通常占 3 字节）。");
  if (password !== body.confirmPassword) errors.push("两次输入的密码不一致。");
  return { username, email, password, errors };
}

async function registerUser(input) {
  const hash = await bcrypt.hash(input.password, rounds);
  const connection = await getPool().getConnection();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await connection.beginTransaction();
        // 兼容旧版本已注销但仍占用用户名、邮箱的记录，不复用旧用户 ID。
        const [deleted] = await connection.execute(
          "SELECT id FROM users WHERE status='deleted' AND (username=? OR email=?) ORDER BY id FOR UPDATE",
          [input.username, input.email]
        );
        for (const old of deleted) {
          const retired = retiredIdentity(old.id);
          await connection.execute("UPDATE users SET username=?,email=? WHERE id=? AND status='deleted'", [retired.username, retired.email, old.id]);
        }
        // 正常和停用账号仍受唯一约束保护，角色由服务端指定。
        const [result] = await connection.execute(
          "INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, 'customer')",
          [input.username, input.email, hash]
        );
        await connection.commit();
        return result.insertId;
      } catch (error) {
        await connection.rollback();
        if (attempt < 2 && ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.code)) continue;
        throw error;
      }
    }
  } finally {
    connection.release();
  }
}

async function authenticate(identifier, password) {
  const [rows] = await getPool().execute("SELECT id, password_hash, status, deleted_at FROM users WHERE username = ? OR email = ? LIMIT 1", [identifier, identifier.toLowerCase()]);
  const user = rows[0];
  // 不存在的账号也执行一次 bcrypt 比对，统一失败提示。
  if (!dummyHash) dummyHash = bcrypt.hash(randomBytes(32).toString("hex"), rounds);
  const matches = await bcrypt.compare(password, user?.password_hash || await dummyHash);
  return matches && user?.status === "active" && !user.deleted_at ? user.id : null;
}

async function findActiveUser(id) {
  const [rows] = await getPool().execute("SELECT id, username, email, role, created_at FROM users WHERE id = ? AND status = 'active' AND deleted_at IS NULL", [id]);
  return rows[0] || null;
}

module.exports = { registrationInput, registerUser, authenticate, findActiveUser };
