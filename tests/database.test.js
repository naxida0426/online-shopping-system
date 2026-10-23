require("../config/environment");
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, scryptSync } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const testDatabase = process.env.DB_TEST_NAME;

test("真实 MySQL：初始化、约束、参数化查询、HTTP 与跨进程持久化", { skip: !testDatabase, timeout: 60000 }, async t => {
  assert.match(testDatabase, /^[a-zA-Z_][a-zA-Z0-9_]*_test$/);
  assert.notEqual(testDatabase, process.env.DB_NAME, "测试库必须与运行库不同");
  process.env.DB_NAME = testDatabase;
  const { initializeDatabase } = require("../scripts/init-db");
  const { getPool, closePool, checkDatabase } = require("../config/db");
  const { getHomeCatalog } = require("../services/catalogService");
  let original;
  let server;
  try {
    await initializeDatabase();
    const pool = getPool();
    const [[row]] = await pool.execute("SELECT price, stock, status FROM products WHERE sku = ?", ["DEMO-LAMP"]);
    original = row;

    await t.test("重复初始化不会重置价格或库存，也不重复插入种子数据", async () => {
      await pool.execute("UPDATE products SET price = ?, stock = ? WHERE sku = ?", ["131.25", 17, "DEMO-LAMP"]);
      await initializeDatabase();
      const [[lamp]] = await pool.execute("SELECT price, stock FROM products WHERE sku = ?", ["DEMO-LAMP"]);
      assert.equal(lamp.price, "131.25");
      assert.equal(lamp.stock, 17);
      const [[counts]] = await pool.execute("SELECT COUNT(*) AS count FROM products WHERE is_demo = 1");
      assert.equal(counts.count, 6);
      assert.equal((await checkDatabase()).tables, 7);
    });

    await t.test("商品查询来自数据库，下架、组合筛选和注入输入得到正确处理", async () => {
      const catalog = await getHomeCatalog({ query: "台灯", category: "home" });
      assert.equal(catalog.products.length, 1);
      assert.equal(catalog.products[0].price, "131.25");
      assert.equal(catalog.products[0].stock, 17);
      assert.equal((await getHomeCatalog({ category: "home" })).products.length, 3);
      assert.equal((await getHomeCatalog({ query: "' OR 1=1 --" })).products.length, 0);
      assert.equal((await getHomeCatalog({ query: "%" })).products.length, 0);
      assert.equal((await getHomeCatalog({ query: "_" })).products.length, 0);
      await pool.execute("UPDATE products SET status = 'inactive' WHERE sku = ?", ["DEMO-LAMP"]);
      try { assert.equal((await getHomeCatalog({ query: "台灯" })).products.length, 0); }
      finally { await pool.execute("UPDATE products SET status = 'active' WHERE sku = ?", ["DEMO-LAMP"]); }
    });

    await t.test("外键、唯一键、金额与数量约束实际生效，事务能回滚", async () => {
      const connection = await pool.getConnection();
      const suffix = randomUUID().slice(0, 8);
      const username = `db_test_${suffix}`;
      try {
        await connection.beginTransaction();
        const hash = `scrypt:${scryptSync(randomUUID(), suffix, 64).toString("hex")}`;
        const [user] = await connection.execute("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)", [username, `${username}@example.invalid`, hash]);
        await assert.rejects(connection.execute("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)", [username, `other_${username}@example.invalid`, hash]), { code: "ER_DUP_ENTRY" });
        const [[product]] = await connection.execute("SELECT id FROM products WHERE sku = ?", ["DEMO-LAMP"]);
        await assert.rejects(connection.execute("UPDATE products SET price = -1 WHERE id = ?", [product.id]), { code: "ER_CHECK_CONSTRAINT_VIOLATED" });
        await assert.rejects(connection.execute("UPDATE products SET category_id = 4294967295 WHERE id = ?", [product.id]), { code: "ER_NO_REFERENCED_ROW_2" });
        await assert.rejects(connection.execute("INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, 0)", [user.insertId, product.id]), { code: "ER_CHECK_CONSTRAINT_VIOLATED" });
        await connection.execute("INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, 1)", [user.insertId, product.id]);
        await assert.rejects(connection.execute("INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, 2)", [user.insertId, product.id]), { code: "ER_DUP_ENTRY" });
        const token = randomUUID();
        const orderSql = "INSERT INTO orders (order_no, user_id, checkout_token, total_amount, recipient_name, recipient_phone, recipient_address) VALUES (?, ?, ?, 10, '测试收件人', '00000000000', '仅测试库内的虚构地址')";
        const [order] = await connection.execute(orderSql, [`T${suffix}`, user.insertId, token]);
        await assert.rejects(connection.execute(orderSql, [`D${suffix}`, user.insertId, token]), { code: "ER_DUP_ENTRY" });
        await assert.rejects(connection.execute("INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal) VALUES (?, ?, '测试快照', 10, 2, 10)", [order.insertId, product.id]), { code: "ER_CHECK_CONSTRAINT_VIOLATED" });
        await connection.execute("INSERT INTO payments (order_id, payment_no, amount) VALUES (?, ?, 10)", [order.insertId, `P${suffix}`]);
        await assert.rejects(connection.execute("INSERT INTO payments (order_id, payment_no, amount) VALUES (?, ?, 10)", [order.insertId, `Q${suffix}`]), { code: "ER_DUP_ENTRY" });
      } finally {
        await connection.rollback();
        connection.release();
      }
      const [[remaining]] = await pool.execute("SELECT COUNT(*) AS count FROM users WHERE username = ?", [username]);
      assert.equal(remaining.count, 0);
    });

    await t.test("新 Node.js 进程仍读取到已保存的价格与库存", () => {
      const script = "const { getHomeCatalog } = require('./services/catalogService'); const { closePool } = require('./config/db'); getHomeCatalog({query:'台灯'}).then(result=>console.log(JSON.stringify(result.products.map(p=>({price:p.price,stock:p.stock}))))).catch(()=>{process.exitCode=1}).finally(closePool);";
      const child = spawnSync(process.execPath, ["-e", script], { cwd: require("node:path").join(__dirname, ".."), env: process.env, encoding: "utf8", timeout: 15000 });
      assert.equal(child.status, 0);
      assert.deepEqual(JSON.parse(child.stdout.trim()), [{ price: "131.25", stock: 17 }]);
    });

    await t.test("HTTP 首页、搜索、健康检查和输入转义", async () => {
      const app = require("../app");
      server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
      const base = `http://127.0.0.1:${server.address().port}`;
      const home = await fetch(base);
      assert.equal(home.status, 200);
      const html = await home.text();
      assert.ok(html.includes("商品信息来自 MySQL"));
      assert.ok(html.includes("131.25"));
      assert.ok(html.includes("库存：17 件"));
      assert.equal((await fetch(`${base}/health/db`)).status, 200);
      const escaped = await fetch(`${base}/?q=${encodeURIComponent('<script>alert(1)</script>')}`);
      const body = await escaped.text();
      assert.ok(body.includes("&lt;script&gt;"));
      assert.ok(!body.includes("<script>alert(1)</script>"));
      assert.equal((await fetch(`${base}/not-found`)).status, 404);
    });
  } finally {
    if (original) await getPool().execute("UPDATE products SET price = ?, stock = ?, status = ? WHERE sku = ?", [original.price, original.stock, original.status, "DEMO-LAMP"]);
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await closePool();
  }
});
