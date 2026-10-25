const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const bcrypt = require("bcryptjs");
const { getCart, addItem, CartError } = require("../services/cartService");

module.exports = async function verifyCart(t, { pool, base }) {
  const suffix = randomUUID().slice(0, 8);
  const password = randomUUID();
  const users = [];
  const products = [];
  const sessionIds = new Set();
  let categoryId;
  let itemId;
  let alice;
  let bob;
  async function client(username) {
    let cookie = "";
    let token = "";
    async function request(path, fields) {
      const response = await fetch(`${base}${path}`, {
        redirect: "manual", method: fields ? "POST" : "GET",
        headers: { Cookie: cookie, ...(fields ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
        ...(fields ? { body: new URLSearchParams(fields) } : {})
      });
      for (const value of response.headers.getSetCookie()) {
        if (!value.startsWith("shiguang.sid=")) continue;
        cookie = value.split(";")[0];
        const signed = decodeURIComponent(cookie.split("=").slice(1).join("="));
        if (signed.startsWith("s:")) sessionIds.add(signed.slice(2).split(".")[0]);
      }
      const body = await response.text();
      const match = body.match(/name="_csrf" value="([a-f0-9]{64})"/);
      if (match) token = match[1];
      return { status: response.status, headers: response.headers, body };
    }
    const api = { request, post: (path, fields = {}) => request(path, { _csrf: token, ...fields }), logout: () => request("/logout", { _csrf: token }) };
    if (username) {
      await request("/login");
      assert.equal((await api.post("/login", { identifier: username, password })).status, 303);
      await request("/account");
    }
    return api;
  }
  async function saved(user = users[0], product = products[0]) {
    const [[row]] = await pool.execute("SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ?", [user, product]);
    return row;
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    for (const name of ["cart_a", "cart_b"]) {
      const username = `${name}_${suffix}`;
      const [result] = await pool.execute("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)", [username, `${username}@example.invalid`, hash]);
      users.push(result.insertId);
    }
    const [category] = await pool.execute("INSERT INTO categories (slug, name) VALUES (?, '购物车测试分类')", [`cart-${suffix}`]);
    categoryId = category.insertId;
    for (let i = 0; i < 3; i++) {
      const [product] = await pool.execute("INSERT INTO products (category_id, sku, name, description, price, stock, image_path) VALUES (?, ?, ?, '购物车专用测试记录', ?, ?, ?)",
        [categoryId, `CART-${suffix}-${i}`, i === 0 ? '测试好物<script>alert(1)</script>' : `测试商品${i}`, i === 0 ? "0.10" : "0.20", [5, 2000, 0][i], i === 0 ? "javascript:alert(1)" : "/images/mug.svg"]);
      products.push(product.insertId);
    }
    await t.test("未登录查看和修改购物车均跳转登录，不执行写入", async () => {
      const guest = await client();
      for (const [path, fields] of [["/cart"], ["/cart/items", { productId: products[0], quantity: 1 }], ["/cart/items/1/delete", {}]]) {
        const result = await guest.request(path, fields);
        assert.equal(result.status, 303);
        assert.equal(result.headers.get("location"), "/login?next=%2Fcart");
      }
      const detail = await guest.request(`/products/${products[0]}?q=test&page=2`);
      assert.ok(detail.body.includes("登录后加入购物车"));
      assert.ok(detail.body.includes("next=%2Fproducts%2F"));
      assert.ok(!(await saved()));
    });
    alice = await client(`cart_a_${suffix}`);
    bob = await client(`cart_b_${suffix}`);
    await t.test("登录用户的空购物车有明确提示", async () => {
      const result = await alice.request("/cart");
      assert.equal(result.status, 200);
      assert.ok(result.body.includes("购物车还是空的"));
      assert.equal(result.headers.get("cache-control"), "no-store");
      const detail = await alice.request(`/products/${products[0]}`);
      assert.ok(detail.body.includes('action="/cart/items"'));
      assert.ok(detail.body.includes('name="quantity"'));
    });
    await t.test("添加写入当前账号，忽略客户端用户 ID、价格和合计", async () => {
      const response = await alice.post("/cart/items", { productId: products[0], quantity: "2", userId: users[1], price: "0.01", total: "0.01" });
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"), "/cart");
      const row = await saved(); itemId = row.id;
      assert.equal(row.quantity, 2);
      assert.equal(await saved(users[1]), undefined);
      const cart = await getCart(users[0]);
      assert.equal(cart.total, "0.20");
      assert.equal(cart.items[0].price, "0.10");
      assert.equal(cart.items[0].image, "/images/product-placeholder.svg");
      const page = await alice.request("/cart");
      assert.ok(page.body.includes("商品已加入购物车"));
      assert.ok(page.body.includes("&lt;script&gt;"));
      assert.ok(!page.body.includes("<script>alert(1)</script>"));
      assert.ok(!page.body.includes("javascript:alert(1)"));
      assert.ok(!(await alice.request("/cart")).body.includes("商品已加入购物车"), "刷新不能重复提示或添加");
    });
    await t.test("重复添加合并数量，修改为目标数量，库存保持不变", async () => {
      assert.equal((await alice.post("/cart/items", { productId: products[0], quantity: 1 })).status, 303);
      assert.equal((await saved()).id, itemId);
      assert.equal((await saved()).quantity, 3);
      assert.equal((await alice.post(`/cart/items/${itemId}/quantity`, { quantity: 2 })).status, 303);
      assert.equal((await saved()).quantity, 2);
      const [[stock]] = await pool.execute("SELECT stock FROM products WHERE id = ?", [products[0]]);
      assert.equal(stock.stock, 5);
    });
    await t.test("无效数量、数组、注入和不存在的 ID 均不能更改清单", async () => {
      for (const quantity of ["0", "-1", "1.5", "1e2", "1000", ""]) {
        assert.equal((await alice.post("/cart/items", { productId: products[0], quantity })).status, 422);
        assert.equal((await alice.post(`/cart/items/${itemId}/quantity`, { quantity })).status, 422);
      }
      for (const id of ["0", "01", "-1", "1 OR 1=1", "4294967295", "4294967296"]) {
        assert.equal((await alice.post("/cart/items", { productId: id, quantity: 1 })).status, 404);
      }
      const form = await alice.request("/cart");
      const token = form.body.match(/name="_csrf" value="([a-f0-9]{64})"/)[1];
      assert.equal((await alice.request("/cart/items", [["_csrf", token], ["productId", products[0]], ["productId", products[1]], ["quantity", "1"]])).status, 404);
      assert.equal((await alice.request("/cart/items", [["_csrf", token], ["productId", products[0]], ["quantity", "1"], ["quantity", "2"]])).status, 422);
      assert.equal((await saved()).quantity, 2);
    });
    await t.test("所有写入校验 CSRF，GET 地址不能执行删除", async () => {
      for (const path of ["/cart/items", `/cart/items/${itemId}/quantity`, `/cart/items/${itemId}/delete`]) {
        assert.equal((await alice.request(path, { productId: products[0], quantity: 1 })).status, 403);
      }
      assert.equal((await alice.request(`/cart/items/${itemId}/delete`)).status, 404);
      assert.equal((await saved()).quantity, 2);
    });
    await t.test("库存不足、无库存和累计超过库存时拒绝操作且不写入", async () => {
      assert.equal((await alice.post("/cart/items", { productId: products[0], quantity: 4 })).status, 409);
      assert.equal((await alice.post(`/cart/items/${itemId}/quantity`, { quantity: 6 })).status, 409);
      assert.equal((await alice.post("/cart/items", { productId: products[2], quantity: 1 })).status, 409);
      assert.equal((await saved()).quantity, 2);
      assert.equal(await saved(users[0], products[2]), undefined);
    });
    await t.test("其他账号无法读取、修改或删除本账号条目", async () => {
      assert.ok((await bob.request("/cart")).body.includes("购物车还是空的"));
      assert.equal((await bob.post(`/cart/items/${itemId}/quantity`, { quantity: 1, userId: users[0] })).status, 404);
      assert.equal((await bob.post(`/cart/items/${itemId}/delete`, { userId: users[0] })).status, 404);
      assert.equal((await saved()).quantity, 2);
      assert.equal((await bob.post("/cart/items", { productId: products[1], quantity: 7, userId: users[0] })).status, 303);
      assert.equal((await saved(users[1], products[1])).quantity, 7);
      assert.equal(await saved(users[0], products[1]), undefined);
      assert.equal((await getCart(users[0])).items.length, 1);
    });
    await t.test("单价、小计、合计读取数据库最新价格并精确到分", async () => {
      await alice.post(`/cart/items/${itemId}/quantity`, { quantity: 3 });
      await alice.post("/cart/items", { productId: products[1], quantity: 1, price: "-1", subtotal: "-100" });
      assert.equal((await getCart(users[0])).total, "0.50");
      await pool.execute("UPDATE products SET price = '0.11' WHERE id = ?", [products[0]]);
      const cart = await getCart(users[0]);
      assert.equal(cart.total, "0.53");
      assert.equal(cart.items.find(item => item.id === itemId).subtotal, "0.33");
      assert.ok((await alice.request("/cart")).body.includes("¥0.53"));
    });
    await t.test("购物车遇到库存降低会标记并排除合计，减量后恢复", async () => {
      await pool.execute("UPDATE products SET stock = 1 WHERE id = ?", [products[0]]);
      let cart = await getCart(users[0]);
      assert.equal(cart.unavailableCount, 1);
      assert.equal(cart.total, "0.20");
      assert.ok((await alice.request("/cart")).body.includes("库存不足，目前仅剩 1 件"));
      assert.equal((await alice.post(`/cart/items/${itemId}/quantity`, { quantity: 1 })).status, 303);
      cart = await getCart(users[0]);
      assert.equal(cart.total, "0.31");
      assert.equal(cart.unavailableCount, 0);
      await pool.execute("UPDATE products SET stock = 5 WHERE id = ?", [products[0]]);
    });
    await t.test("下架、软删除、停用分类都禁止增改；失效条目保留说明", async () => {
      try {
        for (const state of ["inactive", "deleted_at", "category"]) {
          if (state === "inactive") await pool.execute("UPDATE products SET status = 'inactive' WHERE id = ?", [products[0]]);
          if (state === "deleted_at") await pool.execute("UPDATE products SET status = 'active', deleted_at = CURRENT_TIMESTAMP WHERE id = ?", [products[0]]);
          if (state === "category") {
            await pool.execute("UPDATE products SET deleted_at = NULL WHERE id = ?", [products[0]]);
            await pool.execute("UPDATE categories SET is_active = 0 WHERE id = ?", [categoryId]);
          }
          assert.equal((await alice.post("/cart/items", { productId: products[0], quantity: 1 })).status, 409);
          assert.equal((await alice.post(`/cart/items/${itemId}/quantity`, { quantity: 1 })).status, 409);
          assert.ok((await alice.request("/cart")).body.includes("商品已下架或所在分类已停用"));
          assert.equal((await saved()).quantity, 1);
        }
      } finally {
        await pool.execute("UPDATE products SET status = 'active', deleted_at = NULL WHERE id = ?", [products[0]]);
        await pool.execute("UPDATE categories SET is_active = 1 WHERE id = ?", [categoryId]);
      }
    });
    await t.test("并发加入不丢失数量，也不会超过库存或生成重复条目", async () => {
      await pool.execute("DELETE FROM cart_items WHERE user_id = ? AND product_id = ?", [users[0], products[1]]);
      await pool.execute("UPDATE products SET stock = 2 WHERE id = ?", [products[1]]);
      const results = await Promise.allSettled(Array.from({ length: 4 }, () => addItem(users[0], products[1], 1)));
      assert.equal(results.filter(result => result.status === "fulfilled").length, 2);
      assert.ok(results.filter(result => result.status === "rejected").every(result => result.reason instanceof CartError && result.reason.status === 409));
      const cart = await getCart(users[0]);
      assert.equal(cart.items.filter(item => item.productId === products[1]).length, 1);
      assert.equal((await saved(users[0], products[1])).quantity, 2);
      const [[row]] = await pool.execute("SELECT stock FROM products WHERE id = ?", [products[1]]);
      assert.equal(row.stock, 2);
      await pool.execute("UPDATE products SET stock = 2000 WHERE id = ?", [products[1]]);
    });
    await t.test("单个条目最多 999 件，删除其他状态的条目也受归属限制", async () => {
      const row = await saved(users[0], products[1]);
      assert.equal((await alice.post(`/cart/items/${row.id}/quantity`, { quantity: 999 })).status, 303);
      assert.equal((await alice.post("/cart/items", { productId: products[1], quantity: 1 })).status, 409);
      assert.equal((await saved(users[0], products[1])).quantity, 999);
      await pool.execute("UPDATE products SET status = 'inactive' WHERE id = ?", [products[1]]);
      assert.equal((await alice.post(`/cart/items/${row.id}/delete`)).status, 303);
      assert.equal((await alice.post(`/cart/items/${row.id}/delete`)).status, 404);
      assert.equal((await saved(users[1], products[1])).quantity, 7);
      await pool.execute("UPDATE products SET status = 'active' WHERE id = ?", [products[1]]);
    });
    await t.test("退出后重新登录及新 Node.js 进程都保留购物车", async () => {
      await alice.post(`/cart/items/${itemId}/quantity`, { quantity: 2 });
      assert.equal((await alice.logout()).status, 303);
      assert.equal((await alice.request("/cart")).status, 303);
      alice = await client(`cart_a_${suffix}`);
      assert.ok((await alice.request("/cart")).body.includes("¥0.22"));
      const script = "const {getCart}=require('./services/cartService');const {closePool}=require('./config/db');getCart(Number(process.env.TEST_CART_USER)).then(c=>console.log(JSON.stringify({total:c.total,quantity:c.quantity}))).catch(()=>process.exitCode=1).finally(closePool)";
      const child = spawnSync(process.execPath, ["-e", script], { cwd: require("node:path").join(__dirname, ".."), env: { ...process.env, TEST_CART_USER: String(users[0]) }, encoding: "utf8", timeout: 15000 });
      assert.equal(child.status, 0);
      assert.deepEqual(JSON.parse(child.stdout.trim()), { total: "0.22", quantity: 2 });
    });
    await t.test("缺货条目可删除，删除后为空清单且没有创建订单", async () => {
      await pool.execute("UPDATE products SET stock = 0 WHERE id = ?", [products[0]]);
      assert.equal((await alice.post(`/cart/items/${itemId}/delete`)).status, 303);
      assert.ok((await alice.request("/cart")).body.includes("购物车还是空的"));
      const [[orders]] = await pool.execute("SELECT COUNT(*) AS n FROM orders WHERE user_id IN (?, ?)", users);
      assert.equal(orders.n, 0);
    });
  } finally {
    for (const id of sessionIds) await pool.execute("DELETE FROM sessions WHERE session_id = ?", [id]);
    for (const id of users) {
      await pool.execute("DELETE FROM cart_items WHERE user_id = ?", [id]);
      await pool.execute("DELETE FROM users WHERE id = ?", [id]);
    }
    for (const id of products) await pool.execute("DELETE FROM products WHERE id = ?", [id]);
    if (categoryId) await pool.execute("DELETE FROM categories WHERE id = ?", [categoryId]);
  }
};
