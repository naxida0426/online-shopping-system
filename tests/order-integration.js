const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const bcrypt = require("bcryptjs");
const { addItem, getCart } = require("../services/cartService");
const { createOrder, getOwnOrder } = require("../services/orderService");
const { cartFingerprint } = require("../utils/checkout");

module.exports = async function verifyOrders(t, { pool, base }) {
  const suffix = randomUUID().slice(0, 8);
  const password = randomUUID();
  const shipping = { recipientName: "演示收货人", recipientPhone: "13900000000", recipientAddress: "虚构城市教学区测试路 6 号，仅用于独立测试" };
  const users = [], products = [], sessions = new Set();
  let categoryId, alice, bob, firstOrderId, firstToken, firstOrderNo;

  async function client(username) {
    let cookie = "", csrf = "";
    async function request(path, fields) {
      const response = await fetch(`${base}${path}`, { redirect: "manual", method: fields ? "POST" : "GET",
        headers: { Cookie: cookie, ...(fields ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
        ...(fields ? { body: new URLSearchParams(fields) } : {}) });
      for (const value of response.headers.getSetCookie()) {
        if (!value.startsWith("shiguang.sid=")) continue;
        cookie = value.split(";")[0];
        const raw = decodeURIComponent(cookie.split("=").slice(1).join("="));
        if (raw.startsWith("s:")) sessions.add(raw.slice(2).split(".")[0]);
      }
      const body = await response.text();
      const match = body.match(/name="_csrf" value="([a-f0-9]{64})"/);
      if (match) csrf = match[1];
      return { status: response.status, headers: response.headers, body };
    }
    const post = (path, fields = {}) => request(path, { _csrf: csrf, ...fields });
    const checkout = async () => {
      const page = await request("/checkout");
      const token = page.body.match(/name="checkoutToken" value="([^"]*)"/)?.[1] || "";
      return { ...page, token };
    };
    if (username) {
      await request("/login");
      assert.equal((await post("/login", { identifier: username, password })).status, 303);
      await request("/account");
    }
    return { request, post, checkout, submit: (token, extra = {}) => post("/orders", { ...shipping, checkoutToken: token, ...extra }) };
  }
  async function resetCart(userId, entries) {
    await pool.execute("DELETE FROM cart_items WHERE user_id = ?", [userId]);
    for (const [index, quantity] of entries) await addItem(userId, products[index], quantity);
  }
  async function resetProducts() {
    for (let i = 0; i < products.length; i++) await pool.execute("UPDATE products SET price = ?, stock = ?, status = 'active', deleted_at = NULL WHERE id = ?", [["12.34", "0.20", "99999999.99"][i], [5, 10, 999][i], products[i]]);
    await pool.execute("UPDATE categories SET is_active = 1 WHERE id = ?", [categoryId]);
  }
  async function stocks() {
    const result = [];
    for (const id of products) { const [[row]] = await pool.execute("SELECT stock FROM products WHERE id = ?", [id]); result.push(row.stock); }
    return result;
  }
  async function orderCount() {
    const [[row]] = await pool.execute("SELECT COUNT(*) AS n FROM orders WHERE user_id IN (?, ?)", users);
    return row.n;
  }
  function orderId(result) {
    assert.equal(result.status, 303);
    assert.match(result.headers.get("location"), /^\/orders\/[1-9]\d*$/);
    return Number(result.headers.get("location").split("/").at(-1));
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    for (const name of ["order_a", "order_b"]) {
      const username = `${name}_${suffix}`;
      const [user] = await pool.execute("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)", [username, `${username}@example.invalid`, hash]);
      users.push(user.insertId);
    }
    const [category] = await pool.execute("INSERT INTO categories (slug, name) VALUES (?, '订单测试分类')", [`orders-${suffix}`]);
    categoryId = category.insertId;
    for (let i = 0; i < 3; i++) {
      const [product] = await pool.execute("INSERT INTO products (category_id, sku, name, description, price, stock, image_path) VALUES (?, ?, ?, '订单专用测试数据', ?, ?, '/images/lamp.svg')", [categoryId, `ORDER-${suffix}-${i}`, i === 0 ? '演示台灯<script>alert(1)</script>' : `订单好物${i}`, ["12.34", "0.20", "99999999.99"][i], [5, 10, 999][i]]);
      products.push(product.insertId);
    }
    await t.test("结算、订单列表、详情和提交均要求登录", async () => {
      const guest = await client();
      for (const path of ["/checkout", "/orders", "/orders/1"]) {
        const response = await guest.request(path);
        assert.equal(response.status, 303);
        assert.equal(response.headers.get("location"), `/login?next=${encodeURIComponent(path)}`);
      }
      assert.equal((await guest.request("/orders", shipping)).status, 303);
      assert.equal(await orderCount(), 0);
    });
    alice = await client(`order_a_${suffix}`);
    bob = await client(`order_b_${suffix}`);
    await t.test("空购物车、伪造结算令牌不能创建订单", async () => {
      const page = await alice.checkout();
      assert.equal(page.status, 200);
      assert.equal(page.token, "");
      assert.ok(page.body.includes("购物车为空"));
      assert.equal((await alice.submit(randomUUID())).status, 409);
      assert.equal((await alice.submit("' OR 1=1 --")).status, 409);
      assert.equal(await orderCount(), 0);
    });
    await t.test("结算预览签发稳定令牌，收货输入和 CSRF 校验失败不写入", async () => {
      await resetCart(users[0], [[0, 2], [1, 3]]);
      const page = await alice.checkout(); firstToken = page.token;
      assert.match(firstToken, /^[a-f0-9-]{36}$/);
      assert.equal((await alice.checkout()).token, firstToken);
      assert.ok(page.body.includes("¥25.28"));
      assert.equal(page.headers.get("cache-control"), "no-store");
      for (const extra of [{ recipientName: "" }, { recipientPhone: "123" }, { recipientAddress: "<script>bad</script>" }]) {
        assert.equal((await alice.submit(firstToken, extra)).status, 422);
      }
      assert.equal((await alice.request("/orders", { ...shipping, checkoutToken: firstToken })).status, 403);
      assert.equal(await orderCount(), 0);
      assert.deepEqual(await stocks(), [5, 10, 999]);
      assert.equal((await getCart(users[0])).quantity, 5);
    });
    await t.test("订单、明细、库存和清空清单一次完成，忽略客户端金额及归属", async () => {
      await resetCart(users[1], [[0, 1]]);
      const response = await alice.submit(firstToken, { total: "0.01", price: "0.01", userId: users[1], quantity: "999", orderStatus: "completed", paymentStatus: "paid" });
      firstOrderId = orderId(response);
      const [[stored]] = await pool.execute("SELECT * FROM orders WHERE id = ?", [firstOrderId]);
      firstOrderNo = stored.order_no;
      assert.equal(stored.user_id, users[0]);
      assert.equal(stored.total_amount, "25.28");
      assert.equal(stored.order_status, "pending");
      assert.equal(stored.payment_status, "unpaid");
      assert.equal(stored.recipient_name, shipping.recipientName);
      const [lines] = await pool.execute("SELECT product_id, unit_price, quantity, subtotal FROM order_items WHERE order_id = ? ORDER BY product_id", [firstOrderId]);
      assert.deepEqual(lines.map(row => [row.unit_price, row.quantity, row.subtotal]), [["12.34", 2, "24.68"], ["0.20", 3, "0.60"]]);
      assert.deepEqual(await stocks(), [3, 7, 999]);
      assert.equal((await getCart(users[0])).items.length, 0);
      assert.equal((await getCart(users[1])).quantity, 1);
      const [[payments]] = await pool.execute("SELECT COUNT(*) AS n FROM payments WHERE order_id = ?", [firstOrderId]);
      assert.equal(payments.n, 0);
      const detail = await alice.request(`/orders/${firstOrderId}`);
      assert.equal(detail.status, 200);
      assert.ok(detail.body.includes("未支付"));
      assert.ok(detail.body.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
      assert.ok(!detail.body.includes("<script>alert(1)</script>"));
    });
    await t.test("重试同一结算令牌返回原订单，不再扣库存，也不清除新购物车", async () => {
      const before = await orderCount();
      await resetCart(users[0], [[1, 1]]);
      await alice.checkout(); // 新草稿不能影响旧表单的幂等重试。
      const results = await Promise.all(Array.from({ length: 3 }, () => alice.submit(firstToken)));
      assert.ok(results.every(result => orderId(result) === firstOrderId));
      assert.equal(await orderCount(), before);
      assert.deepEqual(await stocks(), [3, 7, 999]);
      assert.equal((await getCart(users[0])).quantity, 1);
    });
    await t.test("订单本人可查看，其他账号和伪造令牌无法越权", async () => {
      assert.equal((await bob.request(`/orders/${firstOrderId}`)).status, 404);
      assert.equal(await getOwnOrder(users[1], firstOrderId), null);
      const list = await bob.request(`/orders?userId=${users[0]}`);
      assert.ok(!list.body.includes(firstOrderNo));
      assert.ok(list.body.includes("还没有订单"));
      assert.equal((await bob.submit(firstToken, { userId: users[0] })).status, 409);
      for (const id of ["0", "abc", "1 OR 1=1", "4294967295"]) assert.equal((await alice.request(`/orders/${encodeURIComponent(id)}`)).status, 404);
    });
    await t.test("价格或数量变化要求重新确认，不悄悄按新金额下单", async () => {
      await resetProducts(); await resetCart(users[0], [[0, 1], [1, 1]]);
      const draft = await alice.checkout();
      const before = await orderCount();
      await pool.execute("UPDATE products SET price = '13.37' WHERE id = ?", [products[0]]);
      const changed = await alice.submit(draft.token);
      assert.equal(changed.status, 409);
      assert.ok(changed.body.includes("商品价格或购物车已变化"));
      assert.ok(changed.body.includes("¥13.57"));
      assert.equal(await orderCount(), before);
      assert.deepEqual(await stocks(), [5, 10, 999]);
      const nextToken = changed.body.match(/name="checkoutToken" value="([^"]+)"/)[1];
      assert.notEqual(nextToken, draft.token);
      const id = orderId(await alice.submit(nextToken));
      assert.equal((await getOwnOrder(users[0], id)).total, "13.57");
      await resetProducts(); await resetCart(users[0], [[0, 1]]);
      const quantityDraft = await alice.checkout();
      await addItem(users[0], products[0], 1);
      assert.equal((await alice.submit(quantityDraft.token)).status, 409);
      assert.equal((await getCart(users[0])).quantity, 2);
    });
    await t.test("库存不足、下架、软删除和分类停用时整单拒绝，购物车保留", async () => {
      const before = await orderCount();
      for (const state of ["stock", "inactive", "deleted", "category"]) {
        await resetProducts(); await resetCart(users[0], [[0, 2], [1, 1]]);
        const draft = await alice.checkout();
        if (state === "stock") await pool.execute("UPDATE products SET stock = 1 WHERE id = ?", [products[0]]);
        if (state === "inactive") await pool.execute("UPDATE products SET status = 'inactive' WHERE id = ?", [products[0]]);
        if (state === "deleted") await pool.execute("UPDATE products SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?", [products[0]]);
        if (state === "category") await pool.execute("UPDATE categories SET is_active = 0 WHERE id = ?", [categoryId]);
        assert.equal((await alice.submit(draft.token)).status, 409);
        assert.equal(await orderCount(), before);
        assert.equal((await getCart(users[0])).quantity, 3);
        assert.equal((await stocks())[1], 10);
      }
      await resetProducts();
    });
    await t.test("并发提交同一表单只生成一单且扣减一次", async () => {
      await resetProducts(); await resetCart(users[0], [[0, 1], [1, 1]]);
      const { token } = await alice.checkout();
      const before = await orderCount();
      const responses = await Promise.all([alice.submit(token), alice.submit(token)]);
      assert.equal(orderId(responses[0]), orderId(responses[1]));
      assert.equal(await orderCount(), before + 1);
      assert.deepEqual(await stocks(), [4, 9, 999]);
    });
    await t.test("两位用户同时购买最后一件，只有一单成功，另一份清单保留", async () => {
      await resetProducts();
      await pool.execute("UPDATE products SET stock = 1 WHERE id = ?", [products[0]]);
      await resetCart(users[0], [[0, 1]]); await resetCart(users[1], [[0, 1]]);
      const a = await alice.checkout(), b = await bob.checkout();
      const before = await orderCount();
      const responses = await Promise.all([alice.submit(a.token), bob.submit(b.token)]);
      assert.deepEqual(responses.map(response => response.status).sort(), [303, 409]);
      assert.equal(await orderCount(), before + 1);
      assert.equal((await stocks())[0], 0);
      assert.equal((await getCart(users[0])).quantity + (await getCart(users[1])).quantity, 1);
    });
    await t.test("交叉添加多种商品后并发下单，不超卖、不相互锁死", async () => {
      await resetProducts();
      await pool.execute("UPDATE products SET stock = 2 WHERE id IN (?, ?)", [products[0], products[1]]);
      await resetCart(users[0], [[1, 1], [0, 1]]); await resetCart(users[1], [[0, 1], [1, 1]]);
      const a = await alice.checkout(), b = await bob.checkout();
      const before = await orderCount();
      const responses = await Promise.all([alice.submit(a.token), bob.submit(b.token)]);
      responses.forEach(orderId);
      assert.equal(await orderCount(), before + 2);
      assert.deepEqual(await stocks(), [0, 0, 999]);
    });
    await t.test("第二条明细写入失败时，已写订单、明细和扣减库存全部回滚", async () => {
      await resetProducts(); await resetCart(users[0], [[0, 1], [1, 1]]);
      const { token } = await alice.checkout();
      const draft = { token, fingerprint: cartFingerprint((await getCart(users[0])).items) };
      const before = await orderCount();
      const original = pool.getConnection;
      let writes = 0;
      // 只注入本次连接的第二次明细写入故障；其余写入和回滚都由真实 MySQL 执行。
      pool.getConnection = async function () {
        const connection = await original.call(pool);
        return new Proxy(connection, { get(target, key) {
          if (key === "execute") return async (sql, values) => {
            if (sql.startsWith("INSERT INTO order_items") && ++writes === 2) {
              const error = new Error("Test-only second item failure"); error.code = "TEST_ORDER_ITEM_FAILURE"; throw error;
            }
            return target.execute(sql, values);
          };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        } });
      };
      try { await assert.rejects(createOrder(users[0], token, draft, shipping), { code: "TEST_ORDER_ITEM_FAILURE" }); }
      finally { pool.getConnection = original; }
      assert.equal(writes, 2);
      assert.equal(await orderCount(), before);
      assert.deepEqual(await stocks(), [5, 10, 999]);
      assert.equal((await getCart(users[0])).quantity, 2);
      orderId(await alice.submit(token)); // 同一份表单在故障恢复后可以重试。
    });
    await t.test("结算期间并发添加购物车，新增数量不会被清空丢失", async () => {
      await resetProducts(); await resetCart(users[0], [[0, 1]]);
      const { token } = await alice.checkout();
      const responses = await Promise.all([alice.submit(token), addItem(users[0], products[0], 1)]);
      const remaining = (await getCart(users[0])).quantity;
      if (responses[0].status === 303) {
        assert.equal(remaining, 1); assert.equal((await stocks())[0], 4);
      } else {
        assert.equal(responses[0].status, 409); assert.equal(remaining, 2); assert.equal((await stocks())[0], 5);
      }
    });
    await t.test("超过 DECIMAL 金额范围时拒绝下单且不发生部分写入", async () => {
      await resetProducts(); await resetCart(users[0], [[0, 1]]);
      const { token } = await alice.checkout();
      await resetCart(users[0], [[2, 101]]);
      const before = await orderCount();
      const response = await alice.submit(token);
      assert.equal(response.status, 422);
      assert.ok(response.body.includes("订单金额超出系统范围"));
      assert.equal(await orderCount(), before);
      assert.deepEqual(await stocks(), [5, 10, 999]);
      assert.equal((await getCart(users[0])).quantity, 101);
    });
    await t.test("商品更名改价后，订单快照仍保存，另一进程可读取", async () => {
      await pool.execute("UPDATE products SET name = '后来改的名称', price = '99.99', status = 'inactive' WHERE id = ?", [products[0]]);
      const order = await getOwnOrder(users[0], firstOrderId);
      assert.equal(order.total, "25.28");
      assert.equal(order.items[0].price, "12.34");
      assert.ok(order.items[0].name.includes("演示台灯"));
      const script = "const {getOwnOrder}=require('./services/orderService');const {closePool}=require('./config/db');getOwnOrder(Number(process.env.TEST_ORDER_USER),Number(process.env.TEST_ORDER_ID)).then(o=>console.log(JSON.stringify({total:o.total,price:o.items[0].price,quantity:o.items[0].quantity}))).catch(()=>process.exitCode=1).finally(closePool)";
      const child = spawnSync(process.execPath, ["-e", script], { cwd: require("node:path").join(__dirname, ".."), env: { ...process.env, TEST_ORDER_USER: String(users[0]), TEST_ORDER_ID: String(firstOrderId) }, encoding: "utf8", timeout: 15000 });
      assert.equal(child.status, 0);
      assert.deepEqual(JSON.parse(child.stdout.trim()), { total: "25.28", price: "12.34", quantity: 2 });
      assert.ok((await alice.request("/orders")).body.includes(firstOrderNo));
      const [stored] = await pool.execute("SELECT data FROM sessions WHERE JSON_EXTRACT(data, '$.userId') = ?", [users[0]]);
      assert.ok(stored.every(row => !row.data.includes(shipping.recipientAddress)), "会话不应保存收货地址");
    });
  } finally {
    for (const id of sessions) await pool.execute("DELETE FROM sessions WHERE session_id = ?", [id]);
    for (const id of users) {
      await pool.execute("DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)", [id]);
      await pool.execute("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)", [id]);
      await pool.execute("DELETE FROM orders WHERE user_id = ?", [id]);
      await pool.execute("DELETE FROM cart_items WHERE user_id = ?", [id]);
      await pool.execute("DELETE FROM users WHERE id = ?", [id]);
    }
    for (const id of products) await pool.execute("DELETE FROM products WHERE id = ?", [id]);
    if (categoryId) await pool.execute("DELETE FROM categories WHERE id = ?", [categoryId]);
  }
};
