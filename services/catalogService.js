const { getPool } = require("../config/db");

const allowedIcons = new Set(["home", "headphones", "bag", "book", "grid"]);
const allowedColors = new Set(["sand", "sage", "stone", "peach", "paper", "clay"]);

async function getHomeCatalog({ query = "", category = "all" } = {}) {
  const pool = getPool();
  const [categoryRows] = await pool.execute(
    "SELECT slug, name, icon FROM categories WHERE is_active = 1 ORDER BY sort_order, id"
  );
  const categories = [
    { id: "all", name: "全部好物", icon: "grid" },
    ...categoryRows.map(row => ({ id: row.slug, name: row.name, icon: allowedIcons.has(row.icon) ? row.icon : "grid" }))
  ];
  const selectedCategory = categories.some(item => item.id === category) ? category : "all";
  const conditions = ["p.status = 'active'", "p.deleted_at IS NULL", "c.is_active = 1"];
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
  const [rows] = await pool.execute(
    `SELECT p.id, p.name, p.description, p.price, p.stock, p.image_path,
            p.tag, p.color, p.is_demo, c.slug AS category_id, c.name AS category_name
     FROM products p JOIN categories c ON c.id = p.category_id
     WHERE ${conditions.join(" AND ")} ORDER BY p.id LIMIT 12`, params
  );
  const products = rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price,
    stock: row.stock,
    categoryId: row.category_id,
    categoryName: row.category_name,
    image: /^\/images\/[a-zA-Z0-9_.-]+$/.test(row.image_path) ? row.image_path : "/images/lamp.svg",
    tag: row.tag || "精选好物",
    color: allowedColors.has(row.color) ? row.color : "sand",
    isDemo: Boolean(row.is_demo)
  }));
  return { categories, category: selectedCategory, products };
}

module.exports = { getHomeCatalog };
