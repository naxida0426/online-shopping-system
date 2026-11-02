const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const createClient = require("./http-client");
const { listAddresses, saveAddress, changeAddress } = require("../services/addressService");
const { addItem, getCart } = require("../services/cartService");
const { createOrder, getOwnOrder } = require("../services/orderService");
const { simulatePayment, cancelOrder } = require("../services/paymentService");
const { expireOrders, startOrderExpiryWorker } = require("../services/orderExpiryService");
const { cartFingerprint } = require("../utils/checkout");
const { paymentTimeoutSeconds } = require("../config/orders");

module.exports = async (t, { pool, base }) => {
  const suffix = randomUUID().slice(0, 8), password = `Bonus-${randomUUID()}`;
  const users = [], sessions = new Set();
  const shipping = { recipientName: "演示收货人", recipientPhone: "13800000000", recipientAddress: "演示省演示市演示区一号" };
  const second = { ...shipping, recipientName: "备用收货人", recipientAddress: "演示省演示市演示区二号" };
  let productId, categoryId, alice, bob, firstAddress, secondAddress;
  async function stock() { const [[p]] = await pool.execute("SELECT stock FROM products WHERE id = ?", [productId]); return p.stock; }
  async function order() {
    await addItem(users[0], productId, 1);
    const cart = await getCart(users[0]), token = randomUUID();
    return createOrder(users[0], token, { token, fingerprint: cartFingerprint(cart.items) }, shipping);
  }
  const due = id => pool.execute("UPDATE orders SET expires_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 SECOND) WHERE id = ?", [id]);
  const read = async id => (await pool.execute("SELECT * FROM orders WHERE id = ?", [id]))[0][0];
  try {
    const hash = await bcrypt.hash(password, 12);
    for (const name of ["bonus_a", "bonus_b"]) {
      const [u] = await pool.execute("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)", [`${name}_${suffix}`, `${name}_${suffix}@example.invalid`, hash]);
      users.push(u.insertId);
    }
    const [category] = await pool.execute("INSERT INTO categories (slug, name) VALUES (?, '加分功能测试')", [`bonus-${suffix}`]);
    categoryId = category.insertId;
    const [product] = await pool.execute("INSERT INTO products (category_id, sku, name, description, price, stock, image_path) VALUES (?, ?, '加分功能测试商品', '测试专用', 10.00, 1000, '/images/lamp.svg')", [categoryId, `BONUS-${suffix}`]);
    productId = product.insertId;
    alice = await createClient(base, `bonus_a_${suffix}`, password, sessions);
    bob = await createClient(base, `bonus_b_${suffix}`, password, sessions);

    await t.test("地址簿要求登录，新增校验与 CSRF 生效，第一个地址自动默认", async () => {
      const guest = await createClient(base);
      assert.equal((await guest.request("/account/addresses")).status, 303);
      assert.equal((await alice.request("/account/addresses")).status, 200);
      assert.equal((await alice.request("/account/addresses/new")).status, 200);
      assert.equal((await alice.request("/account/addresses", shipping)).status, 403);
      assert.equal((await alice.post("/account/addresses", { ...shipping, recipientPhone: "123" })).status, 422);
      assert.equal((await alice.post("/account/addresses", { ...shipping, recipientAddress: "<script>bad</script>" })).status, 422);
      assert.equal((await alice.post("/account/addresses", { ...shipping, userId: users[1] })).status, 303);
      [firstAddress] = await listAddresses(users[0]);
      assert.equal(firstAddress.isDefault, 1);
      assert.equal((await listAddresses(users[1])).length, 0);
    });
    await t.test("地址增改、默认切换、页面渲染和并发默认设置保持唯一", async () => {
      secondAddress = await saveAddress(users[0], null, second);
      assert.equal((await alice.request(`/account/addresses/${secondAddress}/edit`)).status, 200);
      assert.equal((await alice.post(`/account/addresses/${secondAddress}`, { ...second, recipientName: "修改后的收货人" })).status, 303);
      assert.equal((await alice.post(`/account/addresses/${secondAddress}/default`)).status, 303);
      assert.equal((await listAddresses(users[0]))[0].id, secondAddress);
      await Promise.all([changeAddress(users[0], firstAddress.id, "default"), changeAddress(users[0], secondAddress, "default")]);
      assert.equal((await listAddresses(users[0])).filter(a => a.isDefault).length, 1);
      await changeAddress(users[0], firstAddress.id, "default");
      const page = await alice.request("/account/addresses");
      assert.equal(page.status, 200);
      assert.ok(page.body.includes("修改后的收货人"));
      assert.equal(page.headers.get("cache-control"), "no-store");
    });
    await t.test("另一账号不能查看、修改、删除或默认设置本人地址", async () => {
      for (const route of ["edit", "delete"]) assert.equal((await bob.request(`/account/addresses/${firstAddress.id}/${route}`)).status, 404);
      for (const route of ["", "/delete", "/default"]) assert.equal((await bob.post(`/account/addresses/${firstAddress.id}${route}`, { ...shipping, confirmDelete: "yes" })).status, 404);
      assert.equal((await bob.request(`/checkout?address=${firstAddress.id}`)).status, 404);
      assert.equal((await listAddresses(users[0])).length, 2);
    });
    await t.test("结算默认填充、切换地址、临时修改和错误回显，旧订单不随地址变化", async () => {
      await addItem(users[0], productId, 1);
      const page = await alice.request("/checkout");
      assert.equal(page.status, 200);
      assert.ok(page.body.includes(`value="${shipping.recipientName}"`));
      assert.ok(page.body.includes("/js/checkout-addresses.js"));
      const switched = await alice.request(`/checkout?address=${secondAddress}`);
      assert.ok(switched.body.includes('value="修改后的收货人"'));
      const token = page.body.match(/name="checkoutToken" value="([^"]+)"/)[1];
      const invalid = await alice.post("/orders", { ...shipping, recipientName: "临时姓名", recipientPhone: "bad", checkoutToken: token });
      assert.equal(invalid.status, 422);
      assert.ok(invalid.body.includes('value="临时姓名"'));
      const result = await alice.post("/orders", { ...shipping, recipientName: "临时姓名", checkoutToken: token });
      assert.equal(result.status, 303);
      const id = Number(result.headers.get("location").split("/").at(-1));
      await saveAddress(users[0], firstAddress.id, { ...shipping, recipientAddress: "演示省演示市地址已变更" });
      await changeAddress(users[0], secondAddress, "delete");
      const saved = await getOwnOrder(users[0], id);
      assert.equal(saved.recipientName, "临时姓名");
      assert.equal(saved.recipientAddress, shipping.recipientAddress);
      await cancelOrder(users[0], id);
    });
    await t.test("删除需确认，删除默认地址后自动补选；地址上限在并发新增时生效", async () => {
      secondAddress = await saveAddress(users[0], null, second);
      assert.equal((await alice.request(`/account/addresses/${firstAddress.id}/delete`)).status, 200);
      assert.equal((await alice.post(`/account/addresses/${firstAddress.id}/delete`)).status, 422);
      assert.equal((await alice.post(`/account/addresses/${firstAddress.id}/delete`, { confirmDelete: "yes" })).status, 303);
      assert.equal((await listAddresses(users[0]))[0].isDefault, 1);
      for (let i = 0; i < 18; i++) await saveAddress(users[0], null, shipping);
      const results = await Promise.allSettled([saveAddress(users[0], null, shipping), saveAddress(users[0], null, shipping)]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.equal((await listAddresses(users[0])).length, 20);
      assert.equal((await listAddresses(users[0])).filter(a => a.isDefault).length, 1);
    });
    await t.test("新订单固定保存截止时间，详情及支付页渲染倒计时", async () => {
      const id = await order();
      const [[delta]] = await pool.execute("SELECT TIMESTAMPDIFF(SECOND, created_at, expires_at) AS seconds FROM orders WHERE id = ?", [id]);
      assert.equal(delta.seconds, paymentTimeoutSeconds());
      for (const path of [`/orders/${id}`, `/orders/${id}/pay`]) {
        const page = await alice.request(path);
        assert.equal(page.status, 200);
        assert.ok(page.body.includes("data-order-countdown"));
      }
      assert.equal(await expireOrders({ userId: users[0] }), 0);
      assert.equal((await read(id)).order_status, "pending");
      await cancelOrder(users[0], id);
    });
    await t.test("旧待支付订单补齐截止时间，重复升级不改动既有截止时间和收货快照", async () => {
      const id = await order();
      await pool.execute("UPDATE orders SET expires_at = NULL WHERE id = ?", [id]);
      const mysql = require("mysql2/promise");
      const { readDatabaseConfig } = require("../config/database-config");
      const c = await mysql.createConnection(readDatabaseConfig(process.env, { initialize: true }));
      try {
        const { migrateBonus } = require("../scripts/migrate-bonus");
        await migrateBonus(c);
        const [[delta]] = await c.execute("SELECT TIMESTAMPDIFF(SECOND, created_at, expires_at) AS seconds FROM orders WHERE id = ?", [id]);
        assert.equal(delta.seconds, 1800);
        await c.execute("UPDATE orders SET expires_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 600 SECOND) WHERE id = ?", [id]);
        const before = await read(id);
        await migrateBonus(c);
        const after = await read(id);
        assert.equal(after.expires_at, before.expires_at);
        assert.equal(after.recipient_address, shipping.recipientAddress);
      } finally { await c.end(); }
      await cancelOrder(users[0], id);
    });
    await t.test("已到截止时间的旧支付表单不能付款，关闭提交后库存只恢复一次", async () => {
      const before = await stock(), id = await order();
      await due(id);
      const result = await alice.post(`/orders/${id}/pay`, { outcome: "success" });
      assert.equal(result.status, 303);
      const saved = await read(id);
      assert.equal(saved.payment_status, "cancelled");
      assert.equal(saved.cancel_reason, "timeout");
      assert.equal(saved.paid_at, null);
      assert.equal(await stock(), before);
      assert.equal(await expireOrders({ userId: users[0] }), 0);
      assert.equal(await cancelOrder(users[0], id), "already_cancelled");
      assert.equal(await stock(), before);
      assert.ok((await alice.request(`/orders/${id}`)).body.includes("超时未支付自动关闭"));
      const [[email]] = await pool.execute("SELECT COUNT(*) AS n FROM order_emails WHERE order_id = ?", [id]);
      assert.equal(email.n, 0);
    });
    await t.test("超时关闭、支付、主动取消并发时，只关闭一次且不能越权支付", async () => {
      const before = await stock(), id = await order();
      await assert.rejects(simulatePayment(users[1], id, "success"), { status: 404 });
      await due(id);
      const results = await Promise.allSettled([expireOrders({ userId: users[0] }), simulatePayment(users[0], id, "success"), cancelOrder(users[0], id)]);
      assert.ok(results.some(r => r.status === "fulfilled"));
      assert.equal((await read(id)).cancel_reason, "timeout");
      assert.equal(await stock(), before);
      const [[count]] = await pool.execute("SELECT COUNT(*) AS n FROM payments WHERE order_id = ?", [id]);
      assert.equal(count.n, 1);
    });
    await t.test("截止前支付与扫描并发，已支付订单即使截止时间已过也不会关闭", async () => {
      const before = await stock(), id = await order();
      const results = await Promise.all([simulatePayment(users[0], id, "success"), expireOrders({ userId: users[0] })]);
      assert.equal(results[0], "paid");
      await due(id);
      assert.equal(await expireOrders({ userId: users[0] }), 0);
      assert.equal((await read(id)).payment_status, "paid");
      assert.equal(await stock(), before - 1);
    });
    await t.test("关闭事务失败回滚库存与订单，之后可安全重试", async () => {
      const id = await order(), before = await stock();
      await due(id);
      const original = pool.getConnection;
      pool.getConnection = async function () {
        const c = await original.call(pool);
        return new Proxy(c, { get(target, key) {
          if (key === "execute") return async (sql, params) => {
            if (sql.includes("cancel_reason = ?")) throw Object.assign(new Error("Injected close failure"), { code: "TEST_CLOSE_FAILURE" });
            return target.execute(sql, params);
          };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        } });
      };
      try { await assert.rejects(expireOrders({ userId: users[0] }), { code: "TEST_CLOSE_FAILURE" }); }
      finally { pool.getConnection = original; }
      assert.equal((await read(id)).order_status, "pending");
      assert.equal(await stock(), before);
      assert.equal(await expireOrders({ userId: users[0] }), 1);
      assert.equal(await stock(), before + 1);
    });
    await t.test("启动后的后台任务无需访问订单页即可补关超时订单，停用账号仍释放库存", async () => {
      const before = await stock(), id = await order();
      await due(id);
      await pool.execute("UPDATE users SET status = 'disabled' WHERE id = ?", [users[0]]);
      const errors = [], stop = startOrderExpiryWorker({ intervalMs: 25, onError: error => errors.push(error) });
      try {
        const deadline = Date.now() + 3000;
        while ((await read(id)).order_status !== "cancelled" && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
        assert.equal((await read(id)).cancel_reason, "timeout");
        assert.equal(await stock(), before);
        assert.equal(errors.length, 0);
      } finally {
        await stop();
        await pool.execute("UPDATE users SET status = 'active' WHERE id = ?", [users[0]]);
      }
    });
  } finally {
    for (const id of sessions) await pool.execute("DELETE FROM sessions WHERE session_id = ?", [id]);
    for (const userId of users) {
      await pool.execute("DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)", [userId]);
      await pool.execute("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)", [userId]);
      await pool.execute("DELETE FROM orders WHERE user_id = ?", [userId]);
      await pool.execute("DELETE FROM cart_items WHERE user_id = ?", [userId]);
      await pool.execute("DELETE FROM users WHERE id = ?", [userId]);
    }
    if (productId) await pool.execute("DELETE FROM products WHERE id = ?", [productId]);
    if (categoryId) await pool.execute("DELETE FROM categories WHERE id = ?", [categoryId]);
  }
};
