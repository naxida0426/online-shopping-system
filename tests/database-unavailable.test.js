const test = require("node:test");
const assert = require("node:assert/strict");

test("未配置数据库时返回 503，保留静态资源和说明页，绝不退回假商品", async () => {
  // 本测试文件在独立 Node 测试进程中执行，不改变用户 .env。
  for (const key of ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]) process.env[key] = "";
  const app = require("../app");
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(base);
    assert.equal(home.status, 503);
    const html = await home.text();
    assert.ok(html.includes("数据库尚未配置"));
    assert.ok(!html.includes('class="product-card"'));
    const health = await fetch(`${base}/health/db`);
    assert.equal(health.status, 503);
    assert.equal((await health.json()).status, "unavailable");
    assert.equal((await fetch(`${base}/css/style.css`)).status, 200);
    assert.equal((await fetch(`${base}/login`)).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
