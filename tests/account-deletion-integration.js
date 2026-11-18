const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const createClient = require("./http-client");
const { deleteAccount } = require("../services/accountService");
const { addItem, getCart } = require("../services/cartService");
const { createOrder, confirmReceipt } = require("../services/orderService");
const { simulatePayment } = require("../services/paymentService");
const { cartFingerprint } = require("../utils/checkout");
module.exports = async (t, { pool, base }) => {
  const tag = randomUUID().slice(0, 8), password = randomUUID(), users = [], sessions = new Set();
  let productId, categoryId, paidId, pendingId, alice, otherSession, bob, admin;
  async function makeOrder() {
    await addItem(users[0], productId, 1);
    const token = randomUUID(), cart = await getCart(users[0]);
    return createOrder(users[0], token, { token, fingerprint: cartFingerprint(cart.items) }, { recipientName: "演示用户", recipientPhone: "13800000000", recipientAddress: "演示省演示市演示地址" });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    for (const [index, name] of ["close_a", "close_b", "close_admin"].entries()) {
      const [user] = await pool.execute("INSERT INTO users (username,email,password_hash,role) VALUES (?,?,?,?)", [`${name}_${tag}`, `${name}_${tag}@example.invalid`, hash, index === 2 ? "admin" : "customer"]);
      users.push(user.insertId);
    }
    const [category] = await pool.execute("INSERT INTO categories (slug,name) VALUES (?, '账号注销测试')", [`close-${tag}`]);
    categoryId = category.insertId;
    const [product] = await pool.execute("INSERT INTO products (category_id,sku,name,description,price,stock,image_path) VALUES (?,?,'注销测试商品','测试',10.00,10,'/images/lamp.svg')", [categoryId, `CLOSE-${tag}`]);
    productId = product.insertId;
    paidId = await makeOrder();
    await simulatePayment(users[0], paidId, "success");
    await require("../services/adminService").advanceOrder(users[2], paidId, "shipped", "confirmed");
    await confirmReceipt(users[0], paidId);
    const [[item]] = await pool.execute("SELECT id FROM order_items WHERE order_id = ?", [paidId]);
    await require("../services/reviewService").createReview(users[0], paidId, item.id, { rating: "5", content: "评价保留" });
    pendingId = await makeOrder();
    await addItem(users[0], productId, 1);
    await require("../services/favoriteService").setFavorite(users[0], productId, "add");
    await require("../services/addressService").saveAddress(users[0], null, { recipientName: "演示用户", recipientPhone: "13800000000", recipientAddress: "演示省演示市演示地址" });
    alice = await createClient(base, `close_a_${tag}`, password, sessions);
    otherSession = await createClient(base, `close_a_${tag}`, password, sessions);
    bob = await createClient(base, `close_b_${tag}`, password, sessions);
    admin = await createClient(base, `close_admin_${tag}`, password, sessions);
    await t.test("注销确认页不改账号，游客、CSRF、密码及明确确认均受校验", async () => {
      const guest = await createClient(base);
      assert.equal((await guest.request("/account/delete")).status, 303);
      const page = await alice.request("/account/delete");
      assert.equal(page.status, 200);
      assert.ok(page.body.includes('type="password"'));
      assert.ok((await alice.request("/account")).body.includes('href="/account/delete"'));
      assert.equal((await alice.request("/account/delete", { password, confirmDeletion: "yes" })).status, 403);
      assert.equal((await alice.post("/account/delete", { password })).status, 422);
      const wrong = await alice.post("/account/delete", { password: "Incorrect-close-password", confirmDeletion: "yes" });
      assert.equal(wrong.status, 422);
      assert.ok(!wrong.body.includes("Incorrect-close-password"));
      for(let attempt=0;attempt<6;attempt++){
        const retry=await alice.post('/account/delete',{password:'Incorrect-close-password',confirmDeletion:'yes'});
        assert.equal(retry.status,422);assert.equal(retry.headers.get('retry-after'),null);
      }
      assert.equal((await alice.request("/account")).status, 200);
      assert.equal((await getCart(users[0])).quantity, 1);
    });
    await t.test("注销事务写入失败时回滚账号状态及个人清单", async () => {
      const original = pool.getConnection;
      pool.getConnection = async function () {
        const c = await original.call(pool);
        return new Proxy(c, { get(target, key) {
          if (key === "execute") return async (sql, params) => {
            if (sql.startsWith("DELETE FROM favorites")) throw Object.assign(new Error("Test deletion failure"), { code: "TEST_DELETION_FAILURE" });
            return target.execute(sql, params);
          };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        } });
      };
      try { await assert.rejects(deleteAccount(users[0], password, "yes"), { code: "TEST_DELETION_FAILURE" }); }
      finally { pool.getConnection = original; }
      const [[stored]] = await pool.execute("SELECT status,username,email FROM users WHERE id = ?", [users[0]]);
      assert.equal(stored.status, "active");
      assert.equal(stored.username,`close_a_${tag}`);assert.equal(stored.email,`close_a_${tag}@example.invalid`);
      assert.equal((await getCart(users[0])).quantity, 1);
    });
    await t.test("顾客注销清除自己的清单和全部会话，保留订单、支付、评价及其他账号", async () => {
      const [[stockBefore]] = await pool.execute("SELECT stock FROM products WHERE id = ?", [productId]);
      const result = await alice.post("/account/delete", { password, confirmDeletion: "yes", userId: users[1] });
      assert.equal(result.status, 200);
      assert.ok(result.body.includes("账号已注销"));
      assert.match(result.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/);
      const [[stored]] = await pool.execute("SELECT status,deleted_at FROM users WHERE id = ?", [users[0]]);
      assert.equal(stored.status, "deleted"); assert.ok(stored.deleted_at);
      for (const table of ["cart_items", "favorites", "addresses"]) {
        const [[count]] = await pool.execute(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, [users[0]]);
        assert.equal(count.n, 0);
      }
      const [[sessionCount]] = await pool.execute("SELECT COUNT(*) AS n FROM sessions WHERE JSON_EXTRACT(data,'$.userId') = ?", [users[0]]);
      assert.equal(sessionCount.n, 0);
      assert.equal((await otherSession.request("/orders")).status, 303);
      assert.equal((await bob.request("/account")).status, 200);
      const [[payment]] = await pool.execute("SELECT status,amount FROM payments WHERE order_id = ?", [paidId]);
      assert.equal(payment.status, "succeeded"); assert.equal(payment.amount, "10.00");
      const reviews = await require("../services/reviewService").getProductReviews(productId);
      assert.equal(reviews.total, 1); assert.equal(reviews.reviews[0].author, "已注销用户");
      const [[stockAfter]] = await pool.execute("SELECT stock FROM products WHERE id = ?", [productId]);
      assert.equal(stockAfter.stock, stockBefore.stock);
      assert.equal(await require("../services/userService").authenticate(`close_a_${tag}`, password), null);
      await alice.request("/login");
      assert.equal((await alice.post("/login", { identifier: `close_a_${tag}`, password })).status, 401);
      await pool.execute("UPDATE orders SET expires_at=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 SECOND) WHERE id=?", [pendingId]);
      assert.equal(await require("../services/orderExpiryService").expireOrders({ userId: users[0] }), 1);
      const [[expired]] = await pool.execute("SELECT order_status FROM orders WHERE id=?", [pendingId]);
      assert.equal(expired.order_status, "cancelled");
    });
    await t.test('注销后同名同邮箱可注册新账号，旧订单和会话不会继承',async()=>{
      const username=`close_a_${tag}`,email=`${username}@example.invalid`,nextPassword=randomUUID();
      const [[old]]=await pool.execute('SELECT username,email FROM users WHERE id=?',[users[0]]);
      assert.notEqual(old.username,username);assert.notEqual(old.email,email);
      const guest=await createClient(base,undefined,undefined,sessions);await guest.request('/register');
      const response=await guest.post('/register',{username,email,password:nextPassword,confirmPassword:nextPassword});assert.equal(response.status,303);
      const [[fresh]]=await pool.execute("SELECT id,status FROM users WHERE username=? AND email=?",[username,email]);
      assert(fresh);users.push(fresh.id);assert.notEqual(fresh.id,users[0]);assert.equal(fresh.status,'active');
      const client=await createClient(base,username,nextPassword,sessions);
      assert.equal((await client.request('/account')).status,200);assert.equal((await client.request(`/orders/${paidId}`)).status,404);
      assert.equal((await getCart(fresh.id)).quantity,0);assert.equal((await otherSession.request('/account')).status,303);
      assert.equal(await require('../services/userService').authenticate(username,password),null);
    });
    await t.test('旧版本已注销的用户名和邮箱自动释放，注册失败会回滚释放操作',async()=>{
      const {registerUser}=require('../services/userService');
      const username=`legacy_${tag}`,email=`${username}@example.invalid`;
      const [old]=await pool.execute("INSERT INTO users(username,email,password_hash,status,deleted_at) VALUES(?,?,?,'deleted',NOW())",[username,email,hash]);users.push(old.insertId);
      await assert.rejects(registerUser({username,email:`close_b_${tag}@example.invalid`,password}),{code:'ER_DUP_ENTRY'});
      const [[unchanged]]=await pool.execute('SELECT username,email FROM users WHERE id=?',[old.insertId]);assert.equal(unchanged.username,username);assert.equal(unchanged.email,email);
      const fresh=await registerUser({username,email,password});users.push(fresh);assert.notEqual(fresh,old.insertId);
      const [[retired]]=await pool.execute('SELECT status,username,email FROM users WHERE id=?',[old.insertId]);assert.equal(retired.status,'deleted');assert.notEqual(retired.username,username);assert.notEqual(retired.email,email);
    });
    await t.test('并发重注册只产生一个新账号，停用和正常账号仍不可重复注册',async()=>{
      const {registerUser}=require('../services/userService');
      const username=`race_${tag}`,email=`${username}@example.invalid`;
      const [legacy]=await pool.execute("INSERT INTO users(username,email,password_hash,status,deleted_at) VALUES(?,?,?,'deleted',NOW())",[username,email,hash]);users.push(legacy.insertId);
      const results=await Promise.allSettled([registerUser({username,email,password}),registerUser({username,email,password})]);
      const accepted=results.filter(r=>r.status==='fulfilled');assert.equal(accepted.length,1);users.push(accepted[0].value);
      assert.equal(results.find(r=>r.status==='rejected').reason.code,'ER_DUP_ENTRY');
      await assert.rejects(registerUser({username:`close_b_${tag}`,email:`close_b_${tag}@example.invalid`,password}),{code:'ER_DUP_ENTRY'});
      const [disabled]=await pool.execute("INSERT INTO users(username,email,password_hash,status) VALUES(?,?,?,'disabled')",[`disabled_${tag}`,`disabled_${tag}@example.invalid`,hash]);users.push(disabled.insertId);
      await assert.rejects(registerUser({username:`disabled_${tag}`,email:`disabled_${tag}@example.invalid`,password}),{code:'ER_DUP_ENTRY'});
    });
    await t.test("管理员无法通过自助注销入口停用管理账号", async () => {
      assert.equal((await admin.request("/account/delete")).status, 409);
      assert.equal((await admin.post("/account/delete", { password, confirmDeletion: "yes" })).status, 409);
      assert.equal((await admin.request("/admin/stats")).status, 200);
    });
  } finally {
    for (const id of sessions) await pool.execute("DELETE FROM sessions WHERE session_id=?", [id]);
    for (const id of users) {
      await pool.execute("DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE user_id=?)", [id]);
      await pool.execute("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id=?)", [id]);
      await pool.execute("DELETE FROM orders WHERE user_id=?", [id]);
      await pool.execute("DELETE FROM users WHERE id=?", [id]);
    }
    if (productId) await pool.execute("DELETE FROM products WHERE id=?", [productId]);
    if (categoryId) await pool.execute("DELETE FROM categories WHERE id=?", [categoryId]);
  }
};
