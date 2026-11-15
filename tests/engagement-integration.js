const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const createClient = require("./http-client");
const { setFavorite, listFavorites } = require("../services/favoriteService");
const { createReview, getProductReviews } = require("../services/reviewService");
const { addItem, getCart } = require("../services/cartService");
const { createOrder, getOwnOrder } = require("../services/orderService");
const { simulatePayment } = require("../services/paymentService");
const { cartFingerprint } = require("../utils/checkout");

module.exports = async (t, { pool, base }) => {
  const suffix = randomUUID().slice(0, 8), password = `Engagement-${randomUUID()}`;
  const users = [], products = [], sessions = new Set();
  let categoryId, alice, bob, completed, pending, confirmed, shipped, another;
  const shipping = { recipientName: "演示收货人", recipientPhone: "13800000000", recipientAddress: "演示省演示市演示地址" };
  const review = { rating: "5", content: "使用方便，体验很好。" };
  async function order(status, owner = users[0]) {
    for (const productId of products) await addItem(owner, productId, 1);
    const cart = await getCart(owner), token = randomUUID();
    const id = await createOrder(owner, token, { token, fingerprint: cartFingerprint(cart.items) }, shipping);
    if (status !== "pending") {
      await simulatePayment(owner, id, "success");
      await pool.execute("UPDATE orders SET order_status = ? WHERE id = ?", [status, id]);
    }
    const [items] = await pool.execute("SELECT id, product_id AS productId FROM order_items WHERE order_id = ? ORDER BY id", [id]);
    return { id, items };
  }
  const url = (o, item = o.items[0]) => `/orders/${o.id}/items/${item.id}/review?status=completed`;
  try {
    const hash = await bcrypt.hash(password, 12);
    for (const name of ["engage_a", "engage_b"]) {
      const [u] = await pool.execute("INSERT INTO users (username,email,password_hash) VALUES (?,?,?)", [`${name}_${suffix}`, `${name}_${suffix}@example.invalid`, hash]);
      users.push(u.insertId);
    }
    const [category] = await pool.execute("INSERT INTO categories (slug,name) VALUES (?, '互动测试分类')", [`engagement-${suffix}`]);
    categoryId = category.insertId;
    for (let i = 0; i < 2; i++) {
      const [p] = await pool.execute("INSERT INTO products (category_id,sku,name,description,price,stock,image_path) VALUES (?, ?, ?, '测试商品', 10.00, 1000, '/images/lamp.svg')", [categoryId, `ENG-${suffix}-${i}`, `互动商品${i}`]);
      products.push(p.insertId);
    }
    alice = await createClient(base, `engage_a_${suffix}`, password, sessions);
    bob = await createClient(base, `engage_b_${suffix}`, password, sessions);

    await t.test("收藏要求登录和 CSRF，列表与详情提供入口，重复收藏幂等且账号隔离", async () => {
      const guest = await createClient(base);
      assert.equal((await guest.request("/account/favorites")).status, 303);
      assert.equal((await guest.post(`/account/favorites/${products[0]}`, { action: "add" })).status, 303);
      const detail = await alice.request(`/products/${products[0]}`);
      assert.equal(detail.status, 200);
      assert.ok(detail.body.includes("favorite-form"));
      assert.ok((await alice.request(`/products?category=engagement-${suffix}`)).body.includes(`data-favorite-id="${products[0]}"`));
      assert.equal((await alice.request(`/account/favorites/${products[0]}`, { action: "add" })).status, 403);
      await Promise.all([setFavorite(users[0], products[0], "add"), setFavorite(users[0], products[0], "add")]);
      assert.equal((await listFavorites(users[0])).pagination.total, 1);
      assert.equal((await listFavorites(users[1])).pagination.total, 0);
      assert.equal((await bob.post(`/account/favorites/${products[0]}`, { action: "remove", userId: users[0] })).status, 303);
      assert.equal((await listFavorites(users[0])).pagination.total, 1);
      assert.ok((await alice.request(`/products/${products[0]}`)).body.includes('aria-pressed="true"'));
    });
    await t.test("收藏页选择数量加入购物车，合并同款且保留收藏，缺货及下架仍由后端拦截", async () => {
      const page = await alice.request("/account/favorites");
      assert.ok(page.body.includes('action="/cart/items"'));
      assert.ok(page.body.includes(`id="favorite-quantity-${products[0]}"`));
      assert.equal((await alice.request("/cart/items", { productId: products[0], quantity: "2" })).status, 403);
      const response = await alice.post("/cart/items", { productId: products[0], quantity: "2", userId: users[1] });
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"), "/cart");
      assert.equal((await getCart(users[0])).quantity, 2);
      assert.equal((await getCart(users[1])).quantity, 0);
      await alice.post("/cart/items", { productId: products[0], quantity: "1" });
      assert.equal((await getCart(users[0])).quantity, 3);
      assert.equal((await listFavorites(users[0])).pagination.total, 1);
      await pool.execute("UPDATE products SET stock = 0 WHERE id = ?", [products[0]]);
      assert.ok((await alice.request("/account/favorites")).body.includes("暂时缺货"));
      assert.equal((await alice.post("/cart/items", { productId: products[0], quantity: "1" })).status, 409);
      await pool.execute("UPDATE products SET stock = 1000, status = 'inactive' WHERE id = ?", [products[0]]);
      assert.equal((await alice.post("/cart/items", { productId: products[0], quantity: "1" })).status, 409);
      await pool.execute("UPDATE products SET status = 'active' WHERE id = ?", [products[0]]);
      await pool.execute("DELETE FROM cart_items WHERE user_id = ?", [users[0]]);
    });
    await t.test("收藏分页、下架保留、拒绝新增失效商品和取消收藏", async () => {
      await setFavorite(users[0], products[1], "add");
      const page = await alice.request("/account/favorites?page=999");
      assert.equal(page.status, 200);
      assert.ok(page.body.includes("互动商品0"));
      await pool.execute("UPDATE products SET status = 'inactive' WHERE id = ?", [products[0]]);
      assert.ok((await alice.request("/account/favorites")).body.includes("商品已下架，暂不可购买"));
      await assert.rejects(setFavorite(users[1], products[0], "add"), { status: 404 });
      await setFavorite(users[0], products[0], "remove");
      assert.equal((await listFavorites(users[0])).pagination.total, 1);
      assert.equal((await alice.post(`/account/favorites/${products[1]}`, { action: "remove", returnTo: "https://evil.invalid" })).headers.get("location"), "/account");
      assert.equal((await listFavorites(users[0])).pagination.total, 0);
      assert.equal((await alice.post(`/account/favorites/${products[1]}`, { action: "toggle" })).status, 422);
      await pool.execute("UPDATE products SET status = 'active' WHERE id = ?", [products[0]]);
    });
    completed = await order("completed");
    pending = await order("pending");
    confirmed = await order("confirmed");
    shipped = await order("shipped");
    another = await order("completed", users[1]);

    await t.test("订单入口默认全部订单，已完成筛选仅在显式选择时启用", async () => {
      const account = await alice.request("/account");
      assert.ok(account.body.includes('class="btn btn-outline-brand" href="/orders">我的订单'));
      assert.ok(!account.body.includes('>订单与评价</a>'));
      const all = await alice.request("/orders");
      assert.ok(all.body.includes('value="all" selected'));
      assert.ok(all.body.includes(`/orders/${pending.id}`));
      assert.ok(all.body.includes(`/orders/${completed.id}`));
      const filtered = await alice.request("/orders?status=completed");
      assert.ok(filtered.body.includes('value="completed" selected'));
      assert.ok(!filtered.body.includes(`/orders/${pending.id}`));
    });

    await t.test("评价表单位于已完成订单列表，每件商品分别显示，未完成订单不可评", async () => {
      const page = await alice.request("/orders?status=completed");
      assert.equal(page.status, 200);
      assert.ok(page.body.includes(`action="${url(completed)}"`));
      assert.ok(page.body.includes(`action="${url(completed, completed.items[1])}"`));
      assert.ok(!page.body.includes(`/orders/${pending.id}/items/`));
      assert.ok(!page.body.includes(`/orders/${another.id}/items/`));
      for (const o of [pending, confirmed, shipped]) assert.equal((await alice.post(url(o), review)).status, 409);
      assert.equal((await alice.request("/orders?status=unpaid")).body.includes('name="rating"'), false);
    });
    await t.test("评价校验本人归属、订单明细归属、CSRF、评分和文字并保留错误输入", async () => {
      assert.equal((await bob.post(url(completed), review)).status, 404);
      assert.equal((await alice.post(url(completed, another.items[0]), review)).status, 404);
      assert.equal((await alice.request(url(completed), review)).status, 403);
      for (const rating of ["0", "6", "1.5", "01", "bad"]) assert.equal((await alice.post(url(completed), { ...review, rating })).status, 422);
      for (const content of [" ", "x".repeat(1001), "test\u0000bad"]) assert.equal((await alice.post(url(completed), { ...review, content })).status, 422);
      const failed = await alice.post(url(completed), { rating: "0", content: "保留输入的评价" });
      assert.ok(failed.body.includes("保留输入的评价"));
    });
    await t.test("并发重复评价只保存一次，评价显示在原列表并正确转义", async () => {
      const malicious = '<script>alert("x")</script> 使用感受';
      const results = await Promise.all([alice.post(url(completed), { ...review, content: malicious }), alice.post(url(completed), { ...review, content: malicious })]);
      assert.deepEqual(results.map(r => r.status).sort(), [303, 409]);
      const list = await alice.request("/orders?status=completed");
      assert.ok(list.body.includes("已评价"));
      assert.ok(list.body.includes("&lt;script&gt;"));
      assert.ok(!list.body.includes(malicious));
      assert.equal(list.body.includes(`action="${url(completed)}"`), false);
      assert.ok(list.body.includes(`action="${url(completed, completed.items[1])}"`));
    });
    await t.test("平均分和数量来自有效购买评价，详情分页和公开内容不泄漏账号资料", async () => {
      await createReview(users[1], another.id, another.items[0].id, { rating: "1", content: "需要改进。" });
      const feedback = await getProductReviews(products[0]);
      assert.equal(feedback.total, 2);
      assert.equal(Number(feedback.average), 3);
      const guest = await createClient(base);
      const detail = await guest.request(`/products/${products[0]}?reviewPage=999`);
      assert.equal(detail.status, 200);
      assert.ok(detail.body.includes("购买评价"));
      assert.ok(detail.body.includes("需要改进。"));
      assert.ok(detail.body.includes("&lt;script&gt;"));
      assert.ok(!detail.body.includes(`engage_a_${suffix}`));
      assert.ok(!detail.body.includes("@example.invalid"));
      await pool.execute("UPDATE products SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP WHERE id = ?", [products[1]]);
      assert.equal((await alice.post(url(completed, completed.items[1]), review)).status, 303);
    });
    await t.test("历史已支付订单须发货和确认收货后才可评价，确认操作校验归属、CSRF 和明确确认", async () => {
      const guest = await createClient(base);
      assert.equal((await guest.request(`/orders/${shipped.id}/receive`)).status, 303);
      assert.equal((await bob.post(`/orders/${shipped.id}/receive`, { confirmReceipt: "yes" })).status, 404);
      assert.equal((await alice.request(`/orders/${shipped.id}/receive`, { confirmReceipt: "yes" })).status, 403);
      assert.equal((await alice.post(`/orders/${shipped.id}/receive`)).status, 422);
      for (const o of [confirmed, pending]) assert.equal((await alice.post(`/orders/${o.id}/receive`, { confirmReceipt: "yes" })).status, 409);
      const list = await alice.request("/orders");
      assert.ok(!list.body.includes(`/orders/${confirmed.id}/receive`));
      assert.ok(list.body.includes(`/orders/${shipped.id}/receive`));
      const receipt = await alice.request(`/orders/${shipped.id}/receive`);
      assert.equal(receipt.status, 200);
      assert.ok(receipt.body.includes('name="confirmReceipt"'));
      assert.equal((await getOwnOrder(users[0], shipped.id)).orderStatus, "shipped", "GET 不改变收货状态");
      assert.equal((await alice.post(url(confirmed), review)).status, 409);
    });
    await t.test("历史已支付订单自动补发货，重复迁移幂等；确认收货后进入评价且库存付款不变", async () => {
      const { migrateAutoShipping } = require("../scripts/migrate-auto-shipping");
      const beforeMigration = await getOwnOrder(users[0], confirmed.id);
      assert.ok(await migrateAutoShipping(pool) >= 1);
      assert.equal(await migrateAutoShipping(pool), 0);
      const migrated = await getOwnOrder(users[0], confirmed.id);
      assert.equal(migrated.orderStatus, "shipped");
      assert.equal(migrated.paidAt, beforeMigration.paidAt);
      assert.equal((await getOwnOrder(users[0], pending.id)).orderStatus, "pending");
      assert.equal((await getOwnOrder(users[0], completed.id)).orderStatus, "completed");
      const [[before]] = await pool.execute("SELECT stock FROM products WHERE id = ?", [products[0]]);
      const orderBefore = await getOwnOrder(users[0], confirmed.id);
      const responses = await Promise.all([alice.post(`/orders/${confirmed.id}/receive`, { confirmReceipt: "yes" }), alice.post(`/orders/${confirmed.id}/receive`, { confirmReceipt: "yes" })]);
      assert.ok(responses.every(r => r.status === 303));
      const location = responses[0].headers.get("location");
      assert.equal(new URL(location, base).searchParams.get("status"), "completed");
      assert.equal(new URL(location, base).searchParams.get("q"), orderBefore.orderNo);
      assert.ok((await alice.request(location)).body.includes(`/orders/${confirmed.id}/items/${confirmed.items[0].id}/review`));
      assert.equal((await getOwnOrder(users[0], confirmed.id)).orderStatus, "completed");
      assert.equal((await getOwnOrder(users[0], confirmed.id)).paidAt, orderBefore.paidAt);
      const [[after]] = await pool.execute("SELECT stock FROM products WHERE id = ?", [products[0]]);
      assert.equal(after.stock, before.stock);
      assert.equal((await alice.post(url(confirmed), review)).status, 303);
    });
    await t.test("付款即自动发货，无需后台，确认收货后才能评价且重复支付不倒退状态", async () => {
      const [[before]] = await pool.execute("SELECT stock FROM products WHERE id = ?", [products[0]]);
      assert.equal((await alice.post(`/orders/${pending.id}/pay`, { outcome: "success" })).status, 303);
      const paid = await getOwnOrder(users[0], pending.id);
      assert.equal(paid.orderStatus, "shipped");
      assert.equal(paid.canReceive, true);
      assert.equal((await alice.post(url(pending), review)).status, 409);
      assert.equal((await alice.post(`/orders/${pending.id}/receive`, { confirmReceipt: "yes" })).status, 303);
      assert.equal((await alice.post(url(pending), review)).status, 303);
      assert.equal((await alice.post(`/orders/${pending.id}/pay`, { outcome: "success" })).status, 303);
      assert.equal((await getOwnOrder(users[0], pending.id)).orderStatus, "completed");
      const [[after]] = await pool.execute("SELECT stock FROM products WHERE id = ?", [products[0]]);
      assert.equal(after.stock, before.stock);
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
