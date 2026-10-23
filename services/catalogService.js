const { getPool } = require("../config/db");
const { normalizePage, paginationItems, isValidProductId } = require("../utils/catalog");

const allowedIcons = new Set(["home", "headphones", "bag", "book", "grid"]);
const allowedColors = new Set(["sand", "sage", "stone", "peach", "paper", "clay"]);

const PAGE_SIZE = 6;
const productColumns = `p.id, p.sku, p.name, p.description, p.price, p.stock, p.image_path,
  p.tag, p.color, p.is_demo, c.slug AS category_id, c.name AS category_name`;
const visibleProduct = "p.status = 'active' AND p.deleted_at IS NULL AND c.is_active = 1";

function mapProduct(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    price: row.price,
    stock: row.stock,
    categoryId: row.category_id,
    categoryName: row.category_name,
    image: /^\/images\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(row.image_path) ? row.image_path : "/images/product-placeholder.svg",
    tag: row.tag || "精选好物",
    color: allowedColors.has(row.color) ? row.color : "sand",
    isDemo: Boolean(row.is_demo)
  };
}

async function getProductList({ query = "", category = "all", page = 1 } = {}) {
  const pool = getPool();
  const [categoryRows] = await pool.execute(
    "SELECT slug, name, icon FROM categories WHERE is_active = 1 ORDER BY sort_order, id"
  );
  const categories = [
    { id: "all", name: "全部好物", icon: "grid" },
    ...categoryRows.map(row => ({ id: row.slug, name: row.name, icon: allowedIcons.has(row.icon) ? row.icon : "grid" }))
  ];
  const selectedCategory = categories.some(item => item.id === category) ? category : "all";
  const conditions = [visibleProduct];
  const params = [];
  if (selectedCategory !== "all") {
    conditions.push("c.slug = ?");
    params.push(selectedCategory);
  }
  if (query) {
    conditions.push("CONCAT_WS(' ', p.name, p.description, c.name) LIKE ? ESCAPE '!'");
    // ! 是显式转义符，将用户输入的 %、_ 作为普通字符搜索。
    params.push(`%${query.replace(/[!%_]/g, "!$&")}%`);
  }
  const fromAndWhere = `FROM products p JOIN categories c ON c.id = p.category_id WHERE ${conditions.join(" AND ")}`;
  const [[count]] = await pool.execute(`SELECT COUNT(*) AS total ${fromAndWhere}`, params);
  const total = Number(count.total);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requestedPage = normalizePage(page);
  const currentPage = Math.min(requestedPage, totalPages);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const [rows] = await pool.execute(
    `SELECT ${productColumns} ${fromAndWhere} ORDER BY p.id LIMIT ? OFFSET ?`,
    [...params, String(PAGE_SIZE), String(offset)]
  );
  return {
    categories,
    category: selectedCategory,
    invalidCategory: selectedCategory !== category,
    products: rows.map(mapProduct),
    pagination: {
      total, page: currentPage, pageSize: PAGE_SIZE, totalPages,
      start: total ? offset + 1 : 0,
      end: offset + rows.length,
      wasAdjusted: requestedPage !== currentPage,
      items: paginationItems(currentPage, totalPages)
    }
  };
}

async function getProductById(id) {
  // 非法 ID 直接返回未找到，不触发 SQL，也不受数据库是否在线影响。
  if (!isValidProductId(id)) return null;
  const [rows] = await getPool().execute(
    `SELECT ${productColumns} FROM products p JOIN categories c ON c.id = p.category_id
     WHERE p.id = ? AND ${visibleProduct}`, [Number(id)]
  );
  return rows.length ? mapProduct(rows[0]) : null;
}

// 保留第 2 天的调用接口，首页与完整列表共享查询和可见性规则。
const getHomeCatalog = getProductList;
module.exports = { getHomeCatalog, getProductList, getProductById };
