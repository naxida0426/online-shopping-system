const test = require("node:test");
const assert = require("node:assert/strict");
const { safeReturnTo } = require("../utils/auth");
const { registrationInput } = require("../services/userService");
const { validateSessionSecret } = require("../config/session");

test("登录返回地址只允许本站已有的顾客页面", () => {
  for (const value of ["https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/%5cevil.invalid", "/products%0d%0aX-Test:1", "/admin", ["/cart"]]) {
    assert.equal(safeReturnTo(value), "/account");
  }
  for (const value of ["/", "/cart", "/account", "/products?q=%E6%9D%AF&page=2", "/products/1?category=home#details"]) assert.equal(safeReturnTo(value), value);
  assert.equal(safeReturnTo("/products?q=杯"), "/products?q=%E6%9D%AF");
});

test("注册校验按 UTF-8 字节限制密码，不截断多字节密码", () => {
  const valid = { username: "顾客_test", email: " TEST@example.invalid ", password: "password-123", confirmPassword: "password-123" };
  const input = registrationInput(valid);
  assert.deepEqual(input.errors, []);
  assert.equal(input.email, "test@example.invalid");
  for (const change of [{ username: "a" }, { username: "<script>" }, { email: "invalid" }, { password: "短密码" }, { password: "字".repeat(25), confirmPassword: "字".repeat(25) }, { confirmPassword: "different" }]) {
    assert.ok(registrationInput({ ...valid, ...change }).errors.length);
  }
  assert.ok(registrationInput({ username: ["array"], email: {}, password: [] }).errors.length);
});

test("拒绝空会话密钥、短密钥及示例占位值", () => {
  const previous = process.env.SESSION_SECRET;
  try {
    for (const secret of ["", "short", "replace_with_random_session_secret"]) {
      process.env.SESSION_SECRET = secret;
      assert.throws(validateSessionSecret, { code: "SESSION_CONFIG_INVALID" });
    }
    process.env.SESSION_SECRET = require("node:crypto").randomBytes(32).toString("hex");
    assert.equal(validateSessionSecret(), process.env.SESSION_SECRET);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  }
});
