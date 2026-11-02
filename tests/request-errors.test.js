const test = require("node:test");
const assert = require("node:assert/strict");

test("请求解析错误返回明确状态，不泄漏原始表单或服务器路径", async () => {
  // 独立测试进程；故意不配置数据库，错误请求应在访问会话之前结束。
  for (const key of ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]) process.env[key] = "";
  const app = require("../app");
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const marker = "PRIVATE_FORM_MARKER";
  try {
    for (const entry of [
      { type: "application/x-www-form-urlencoded; charset=utf-16le", body: marker, status: 415 },
      { type: "application/x-www-form-urlencoded", encoding: "unsupported", body: marker, status: 415 },
      { type: "application/x-www-form-urlencoded", body: `password=${marker}${"a".repeat(11000)}`, status: 413 },
      { type: "application/x-www-form-urlencoded", body: Array.from({ length: 21 }, (_, i) => `x${i}=${marker}`).join("&"), status: 413 }
    ]) {
      const response = await fetch(`${base}/login`, { method: "POST", headers: { "Content-Type": entry.type, ...(entry.encoding ? { "Content-Encoding": entry.encoding } : {}) }, body: entry.body });
      assert.equal(response.status, entry.status);
      const html = await response.text();
      assert.ok(html.includes("main-content"));
      for (const value of [marker, process.cwd(), "node_modules", "Error:", "ReferenceError"]) assert.ok(!html.includes(value));
    }
    for (const path of ["/.env", "/.local/mysql.cnf", "/app.js", "/products/%E0%A4%A"]) {
      const response = await fetch(base + path);
      assert.equal(response.status, path.startsWith("/products/") ? 400 : 404);
      assert.ok(!(await response.text()).includes("ReferenceError"));
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
