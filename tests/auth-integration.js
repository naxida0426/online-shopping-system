const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const bcrypt = require("bcryptjs");

module.exports = async function authIntegration(t, { pool, base }) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const username = `auth_${suffix}`;
  const email = `${username}@example.invalid`;
  const password = randomUUID();
  const sessionIds = new Set();
  let cookie = "";
  let token;
  let userId;
  let signedInCookie;
  let guestCookie;
  const csrf = html => {
    const match = html.match(/name="_csrf" value="([a-f0-9]{64})"/);
    assert.ok(match, "表单应带有 CSRF token");
    return match[1];
  };
  function rememberCookie(value) {
    if (!value) return;
    cookie = value.split(";")[0];
    const decoded = decodeURIComponent(cookie.split("=").slice(1).join("="));
    if (decoded.startsWith("s:")) sessionIds.add(decoded.slice(2).split(".")[0]);
  }
  async function request(url, fields, cookieOverride) {
    const response = await fetch(`${base}${url}`, {
      redirect: "manual", method: fields ? "POST" : "GET",
      headers: { Cookie: cookieOverride ?? cookie, ...(fields ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      ...(fields ? { body: new URLSearchParams(fields) } : {})
    });
    for (const value of response.headers.getSetCookie()) if (value.startsWith("shiguang.sid=")) rememberCookie(value);
    const body = await response.text();
    return { status: response.status, headers: response.headers, body };
  }
  const login = (identifier = username, extra = {}) => request("/login", { _csrf: token, identifier, password, ...extra });
  try {
    await t.test("游客访问账户和购物车会跳转，匿名商品页不创建会话", async () => {
      const publicPage = await request("/products");
      assert.equal(publicPage.status, 200);
      assert.equal(publicPage.headers.get("set-cookie"), null);
      for (const page of ["/account", "/cart"]) {
        const response = await request(page);
        assert.equal(response.status, 303);
        assert.equal(response.headers.get("location"), `/login?next=${encodeURIComponent(page)}`);
      }
      const response = await request("/register?next=/cart");
      token = csrf(response.body);
      guestCookie = cookie;
      assert.match(response.headers.get("set-cookie"), /HttpOnly/);
      assert.match(response.headers.get("set-cookie"), /SameSite=Lax/);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal((await request("/LOGIN/")).status, 200);
      assert.equal((await request("/REGISTER/")).status, 200);
    });
    await t.test("注册写入 MySQL、密码哈希且不能通过表单提升角色", async () => {
      const result = await request("/register", { _csrf: token, username, email: email.toUpperCase(), password, confirmPassword: password, role: "admin", next: "/cart" });
      assert.equal(result.status, 303);
      assert.equal(result.headers.get("location"), "/login?next=%2Fcart");
      const [[user]] = await pool.execute("SELECT id, email, password_hash, role FROM users WHERE username = ?", [username]);
      userId = user.id;
      assert.equal(user.email, email);
      assert.equal(user.role, "customer");
      assert.notEqual(user.password_hash, password);
      assert.match(user.password_hash, /^\$2[aby]\$12\$/);
      assert.ok(await bcrypt.compare(password, user.password_hash));
      assert.equal((await request("/account")).status, 303, "注册后仍需登录");
      const page = await request("/login?next=/cart");
      token = csrf(page.body);
      assert.ok(page.body.includes("注册成功"));
      assert.ok(!page.body.includes(password));
    });
    await t.test("重复用户名、重复邮箱及无效输入不创建账号", async () => {
      for (const fields of [{ username, email: `other_${email}` }, { username: `other_${username}`, email }]) {
        const result = await request("/register", { _csrf: token, password, confirmPassword: password, ...fields });
        assert.equal(result.status, 409);
        assert.ok(result.body.includes("用户名或邮箱已被使用"));
        assert.ok(!result.body.includes(password));
      }
      const invalid = await request("/register", { _csrf: token, username: "<script>", email: "bad", password: "short", confirmPassword: "mismatch" });
      assert.equal(invalid.status, 422);
      assert.ok(invalid.body.includes("&lt;script&gt;"));
      assert.ok(!invalid.body.includes("value=\"short\""));
      const [[count]] = await pool.execute("SELECT COUNT(*) AS n FROM users WHERE email = ?", [email]);
      assert.equal(count.n, 1);
    });
    await t.test("缺少、错误及多字节 CSRF token 均返回 403", async () => {
      for (const value of ["", "f".repeat(64), "字".repeat(64)]) {
        assert.equal((await request("/login", { _csrf: value, identifier: username, password })).status, 403);
        assert.equal((await request("/register", { _csrf: value })).status, 403);
      }
    });
    await t.test("错误密码、不存在账号和注入输入使用相同失败提示", async () => {
      for (const identifier of [username, `missing_${username}`, "' OR 1=1 --"]) {
        const response = await login(identifier, { password: "wrong-password" });
        assert.equal(response.status, 401);
        assert.ok(response.body.includes("账号或密码不正确"));
        assert.ok(!response.body.includes(password));
      }
      assert.equal((await login("", { password: "" })).status, 422);
      assert.equal((await login(username, { password: "字".repeat(25) })).status, 422);
    });
    await t.test("登录更换会话编号，保留站内返回地址且能读取真实账户", async () => {
      const result = await login(username, { next: "/cart" });
      assert.equal(result.status, 303);
      assert.equal(result.headers.get("location"), "/cart");
      assert.notEqual(cookie, guestCookie);
      signedInCookie = cookie;
      const account = await request("/account");
      assert.equal(account.status, 200);
      assert.ok(account.body.includes(email));
      assert.ok(account.body.includes("顾客"));
      assert.ok(!account.body.includes(password));
      token = csrf(account.body);
      assert.equal((await request("/cart")).status, 200);
      assert.equal((await request("/account", undefined, guestCookie)).status, 303);
      cookie = signedInCookie;
      const [sessions] = await pool.execute("SELECT data FROM sessions WHERE JSON_EXTRACT(data, '$.userId') = ?", [userId]);
      assert.equal(sessions.length, 1);
      const data = JSON.parse(sessions[0].data);
      assert.deepEqual(Object.keys(data).sort(), ["cookie", "csrfToken", "userId"]);
      assert.ok(!sessions[0].data.includes(password));
    });
    await t.test("另一 Node.js 进程可从 MySQL 恢复同一个登录会话", () => {
      const script = `const app = require('./app'); const {closeSessionStore} = require('./config/session'); const {closePool} = require('./config/db'); const s = app.listen(0, '127.0.0.1', async () => { try { const r = await fetch('http://127.0.0.1:'+s.address().port+'/account', {redirect:'manual',headers:{Cookie:process.env.TEST_AUTH_COOKIE}}); const html = await r.text(); console.log(JSON.stringify({status:r.status,account:html.includes('账户信息')})); } catch { process.exitCode=1; } finally { s.closeAllConnections(); s.close(async()=>{await closeSessionStore();await closePool()}); } });`;
      const child = spawnSync(process.execPath, ["-e", script], { cwd: require("node:path").join(__dirname, ".."), env: { ...process.env, TEST_AUTH_COOKIE: signedInCookie }, encoding: "utf8", timeout: 15000 });
      assert.equal(child.status, 0);
      assert.deepEqual(JSON.parse(child.stdout.trim()), { status: 200, account: true });
    });
    await t.test("退出必须 POST 并验证 CSRF，退出后旧会话不能继续访问", async () => {
      assert.equal((await request("/logout")).status, 404);
      assert.equal((await request("/logout", { _csrf: "wrong" })).status, 403);
      assert.equal((await request("/account")).status, 200);
      const response = await request("/logout", { _csrf: token });
      assert.equal(response.status, 303);
      assert.match(response.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/);
      assert.equal((await request("/account", undefined, signedInCookie)).status, 303);
      cookie = "";
    });
    await t.test("邮箱可登录，外站返回地址被忽略，停用账号使已有会话失效", async () => {
      token = csrf((await request("/login")).body);
      const result = await login(email.toUpperCase(), { next: "//evil.invalid" });
      assert.equal(result.status, 303);
      assert.equal(result.headers.get("location"), "/account");
      await pool.execute("UPDATE users SET status = 'disabled' WHERE id = ?", [userId]);
      assert.equal((await request("/account")).status, 303);
      token = csrf((await request("/login")).body);
      assert.equal((await login()).status, 401);
      await pool.execute("UPDATE users SET status = 'active' WHERE id = ?", [userId]);
    });
    await t.test("篡改及已过期会话不会获得账户访问权限", async () => {
      token = csrf((await request("/login")).body);
      assert.equal((await login()).status, 303);
      const validCookie = cookie;
      const changed = `${validCookie.slice(0, -1)}${validCookie.endsWith("X") ? "Y" : "X"}`;
      assert.equal((await request("/account", undefined, changed)).status, 303);
      cookie = validCookie;
      const id = decodeURIComponent(cookie.split("=")[1]).slice(2).split(".")[0];
      await pool.execute("UPDATE sessions SET expires = 1 WHERE session_id = ?", [id]);
      assert.equal((await request("/account")).status, 303);
    });
    await t.test("连续失败的登录和注册会返回 429", async () => {
      cookie = "";
      token = csrf((await request("/login")).body);
      let status;
      for (let i = 0; i < 12; i++) {
        const response = await login(username, { password: "wrong-password" });
        status = response.status;
        if (status === 429) { assert.ok(Number(response.headers.get("retry-after")) > 0); break; }
      }
      assert.equal(status, 429);
      for (let i = 0; i < 3; i++) {
        status = (await request("/register", { _csrf: token, username: "!" })).status;
        if (status === 429) break;
      }
      assert.equal(status, 429);
    });
  } finally {
    for (const id of sessionIds) await pool.execute("DELETE FROM sessions WHERE session_id = ?", [id]);
    if (userId) await pool.execute("DELETE FROM users WHERE id = ?", [userId]);
  }
};
