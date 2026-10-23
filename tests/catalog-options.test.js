const test = require("node:test");
const assert = require("node:assert/strict");
const { readBrowseOptions, catalogUrl, productUrl, isValidProductId, paginationItems } = require("../utils/catalog");

test("筛选参数拒绝数组和非整数页码，并限制关键词长度", () => {
  assert.deepEqual(readBrowseOptions({ q: ["a", "b"], category: ["home"], page: ["2", "3"] }), { query: "", category: "all", page: 1 });
  for (const page of ["-1", "0", "1.5", "1e2", "Infinity", "999999999999999999999"]) {
    assert.equal(readBrowseOptions({ page }).page, 1);
  }
  assert.equal(readBrowseOptions({ q: "  台灯  ", page: "2", category: "home" }).query, "台灯");
  assert.equal(readBrowseOptions({ q: "灯".repeat(101) }).query.length, 100);
});

test("列表与详情链接编码关键词并保留分类和页码，返回路径固定在本站", () => {
  const list = new URL(catalogUrl('杯 & <script>', "home", 2), "http://localhost");
  assert.equal(list.pathname, "/products");
  assert.equal(list.searchParams.get("q"), '杯 & <script>');
  assert.equal(list.searchParams.get("category"), "home");
  assert.equal(list.searchParams.get("page"), "2");
  const detail = new URL(productUrl(8, "耳机", "digital", 3), "http://localhost");
  assert.equal(detail.pathname, "/products/8");
  assert.equal(detail.searchParams.get("page"), "3");
});

test("商品 ID 必须是数据库范围内的正整数", () => {
  for (const id of ["0", "-1", "01", "1.5", "1e2", "abc", "1 OR 1=1", "4294967296"]) assert.equal(isValidProductId(id), false);
  assert.equal(isValidProductId("1"), true);
  assert.equal(isValidProductId("4294967295"), true);
});

test("大量页码只生成有限导航并显示省略号", () => {
  const items = paginationItems(500, 1000);
  assert.deepEqual(items, [1, null, 498, 499, 500, 501, 502, null, 1000]);
  assert.deepEqual(paginationItems(1, 2), [1, 2]);
});
