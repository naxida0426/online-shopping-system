const bcrypt = require("bcryptjs");
const { randomBytes } = require("node:crypto");
const { getPool } = require("../config/db");
const rounds = 12;
let dummyHash;

function registrationInput(body = {}) {
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const errors = [];
  if (!/^[\p{Script=Han}a-zA-Z0-9_]{3,30}$/u.test(username)) errors.push("用户名须为 3–30 个中文、字母、数字或下划线。");
  if (email.length > 191 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("请输入有效的邮箱地址（不超过 191 个字符）。");
  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) errors.push("密码至少 8 个字符，且不超过 72 个 UTF-8 字节（中文通常占 3 字节）。");
  if (password !== body.confirmPassword) errors.push("两次输入的密码不一致。");
  return { username, email, password, errors };
}

async function registerUser(input) {
  const hash = await bcrypt.hash(input.password, rounds);
  // 角色由服务端指定，忽略表单提交的 role 等额外字段。
  const [result] = await getPool().execute("INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, 'customer')", [input.username, input.email, hash]);
  return result.insertId;
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
