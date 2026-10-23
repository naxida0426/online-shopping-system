const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { getProductList, getProductById } = require("../services/catalogService");

// 由 database.test.js 在专用测试库中顺序调用，避免并行用例相互改变商品状态。
module.exports = async function verifyCatalog(t, { pool, base }) {
  const suffix = randomUUID().slice(0, 8);
  const slug = `day3-${suffix}`;
  const keyword = `分页好物${suffix}`;
  let categoryId;
  const ids = [];
  try {
    const [category] = await pool.execute("INSERT INTO categories (slug, name, icon, sort_order) VALUES (?, '分页测试分类', 'grid', 999)", [slug]);
    categoryId = category.insertId;
    for (let index = 0; index < 7; index++) {
      const [product] = await pool.execute(
        `INSERT INTO products (category_id, sku, name, description, price, stock, image_path, is_demo)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [categoryId, `DAY3-${suffix}-${index}`, `${keyword}-${index}`,
          index === 0 ? "特殊字符：% _ ! <script>alert(1)</script>\n详情完整描述。" : "仅用于独立测试库的分页验收。",
          "12.34", index === 0 ? 0 : 10, index === 0 ? "javascript:alert(1)" : "/images/lamp.svg"]
      );
      ids.push(product.insertId);
    }

    await t.test("7 件商品分为 6+1，两页不重复，计数与越界页码正确", async () => {
      const first = await getProductList({ query: keyword, category: slug, page: 1 });
      const second = await getProductList({ query: keyword, category: slug, page: 2 });
      assert.equal(first.pagination.total, 7);
      assert.equal(first.pagination.totalPages, 2);
      assert.equal(first.products.length, 6);
      assert.equal(second.products.length, 1);
      assert.equal(second.pagination.start, 7);
      assert.equal(new Set([...first.products, ...second.products].map(item => item.id)).size, 7);
      const overflow = await getProductList({ category: slug, page: 999 });
      assert.equal(overflow.pagination.page, 2);
      assert.equal(overflow.pagination.wasAdjusted, true);
    });

    await t.test("关键词中特殊字符按字面搜索，注入不能扩大结果集", async () => {
      for (const query of ["%", "_", "!"]) {
        const result = await getProductList({ query, category: slug });
        assert.equal(result.pagination.total, 1);
        assert.equal(result.products[0].id, ids[0]);
      }
      const empty = await getProductList({ query: "' OR 1=1 --", category: slug, page: 3 });
      assert.equal(empty.pagination.total, 0);
      assert.equal(empty.pagination.page, 1);
      assert.equal(empty.products.length, 0);
    });

    await t.test("详情读取准确价格、零库存、SKU 与描述，并拒绝危险图片地址", async () => {
      const product = await getProductById(ids[0]);
      assert.equal(product.price, "12.34");
      assert.equal(product.stock, 0);
      assert.equal(product.sku, `DAY3-${suffix}-0`);
      assert.ok(product.description.includes("详情完整描述"));
      assert.equal(product.image, "/images/product-placeholder.svg");
      const response = await fetch(`${base}/products/${ids[0]}`);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.ok(html.includes("暂时缺货"));
      assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
      assert.ok(!html.includes("<script>alert(1)</script>"));
      assert.ok(!html.includes("javascript:alert(1)"));
    });

    await t.test("数据库修改后列表与详情都立即展示新价格和库存", async () => {
      await pool.execute("UPDATE products SET price = ?, stock = ? WHERE id = ?", ["17.50", 8, ids[0]]);
      const detail = await getProductById(ids[0]);
      const list = await getProductList({ query: keyword, category: slug });
      assert.equal(detail.price, "17.50");
      assert.equal(detail.stock, 8);
      assert.equal(list.products.find(item => item.id === ids[0]).price, "17.50");
    });

    await t.test("分页链接、详情与返回列表保留关键词、分类及页码", async () => {
      const params = new URLSearchParams({ q: keyword, category: slug, page: "2" });
      const response = await fetch(`${base}/products?${params}`);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.ok(html.includes('aria-label="第 2 页，当前页"'));
      assert.ok(html.includes("展示 7–7 件"));
      const match = html.match(/href="(\/products\/\d+\?[^\"]+)"/);
      assert.ok(match, "应存在包含筛选信息的详情链接");
      const detailUrl = new URL(match[1].replaceAll("&amp;", "&"), base);
      assert.equal(detailUrl.searchParams.get("q"), keyword);
      assert.equal(detailUrl.searchParams.get("category"), slug);
      assert.equal(detailUrl.searchParams.get("page"), "2");
      const detailHtml = await (await fetch(detailUrl)).text();
      const backMatch = detailHtml.match(/class="detail-back" href="([^\"]+)"/);
      assert.ok(backMatch);
      const back = new URL(backMatch[1].replaceAll("&amp;", "&"), base);
      assert.equal(back.pathname, "/products");
      assert.equal(back.searchParams.get("page"), "2");
      assert.equal(back.searchParams.get("q"), keyword);
      assert.equal(back.searchParams.get("category"), slug);
    });

    await t.test("无效 ID 返回 404，非法 URL 编码返回 400", async () => {
      for (const id of ["0", "-1", "01", "1.5", "1e2", "abc", "4294967296", "1 OR 1=1"]) {
        assert.equal(await getProductById(id), null);
        assert.equal((await fetch(`${base}/products/${encodeURIComponent(id)}`)).status, 404);
      }
      assert.equal((await fetch(`${base}/products/4294967295`)).status, 404);
      assert.equal((await fetch(`${base}/products/%E0%A4%A`)).status, 400);
    });

    await t.test("下架、软删除和停用分类的商品均不能从详情链接绕过限制", async () => {
      try {
        await pool.execute("UPDATE products SET status = 'inactive' WHERE id = ?", [ids[0]]);
        assert.equal(await getProductById(ids[0]), null);
        assert.equal((await getProductList({ category: slug })).pagination.total, 6);
        assert.equal((await fetch(`${base}/products/${ids[0]}`)).status, 404);
        await pool.execute("UPDATE products SET status = 'active', deleted_at = CURRENT_TIMESTAMP WHERE id = ?", [ids[0]]);
        assert.equal(await getProductById(ids[0]), null);
        assert.equal((await fetch(`${base}/products/${ids[0]}`)).status, 404);
        await pool.execute("UPDATE products SET deleted_at = NULL WHERE id = ?", [ids[0]]);
        await pool.execute("UPDATE categories SET is_active = 0 WHERE id = ?", [categoryId]);
        assert.equal(await getProductById(ids[0]), null);
        const hidden = await getProductList({ category: slug });
        assert.equal(hidden.invalidCategory, true);
        assert.ok(hidden.products.every(product => !ids.includes(product.id)));
        assert.equal((await fetch(`${base}/products/${ids[0]}`)).status, 404);
      } finally {
        await pool.execute("UPDATE categories SET is_active = 1 WHERE id = ?", [categoryId]);
        await pool.execute("UPDATE products SET status = 'active', deleted_at = NULL WHERE id = ?", [ids[0]]);
      }
    });

    await t.test("空分类和无结果搜索提供提示，不出现错误分页", async () => {
      await pool.execute("UPDATE products SET status = 'inactive' WHERE category_id = ?", [categoryId]);
      const empty = await getProductList({ category: slug });
      assert.equal(empty.pagination.total, 0);
      assert.equal(empty.pagination.totalPages, 1);
      const html = await (await fetch(`${base}/products?category=${slug}`)).text();
      assert.ok(html.includes("暂时没有可展示的好物"));
      assert.ok(!html.includes('aria-label="商品分页"'));
      const noResult = await (await fetch(`${base}/products?q=${encodeURIComponent(`不存在${suffix}`)}`)).text();
      assert.ok(noResult.includes("暂时没有找到这件好物"));
    });
  } finally {
    if (categoryId) {
      await pool.execute("DELETE FROM products WHERE category_id = ?", [categoryId]);
      await pool.execute("DELETE FROM categories WHERE id = ?", [categoryId]);
    }
  }
};
