const express = require("express");
const path = require("node:path");
const { categories, products } = require("./data/demo-products");
const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor/bootstrap", express.static(path.join(__dirname, "node_modules/bootstrap/dist")));

app.locals.shopUrl = (query = "", category = "all") => {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (category !== "all") params.set("category", category);
  return `/${params.size ? `?${params}` : ""}#products`;
};
app.locals.year = new Date().getFullYear();

app.get("/", (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const category = categories.some(item => item.id === req.query.category) ? req.query.category : "all";
  // 当前仅查询明确标注的演示数据；后续在此替换为 MySQL 查询，保留模板数据接口。
  const filteredProducts = products.filter(product =>
    (category === "all" || product.categoryId === category) &&
    `${product.name} ${product.description} ${product.categoryName}`.toLowerCase().includes(query.toLowerCase())
  );
  res.render("index", { title: "拾光商城 · 把喜欢带回日常", activePage: "home", query, category, categories, products: filteredProducts });
});

const upcomingPages = {
  "/login": { title: "登录", icon: "user", message: "登录功能正在准备中", description: "这里将支持账号登录与会话管理。当前首页为布局演示，尚未接入用户系统。" },
  "/register": { title: "注册", icon: "user", message: "期待与你初次见面", description: "注册功能将在后续阶段开放。目前不会收集或保存你的个人信息。" },
  "/cart": { title: "购物车", icon: "bag", message: "你的好物清单，即将上线", description: "购物车功能尚未实现。当前商品为演示内容，暂不支持加入购物车、下单或支付。" }
};
Object.entries(upcomingPages).forEach(([route, page]) => {
  app.get(route, (req, res) => res.render("message", { ...page, activePage: route.slice(1), query: "" }));
});

app.use((req, res) => {
  res.status(404).render("message", { title: "页面未找到", icon: "search", message: "这页小美好，还没找到", description: "页面地址可能有误，返回首页继续逛逛吧。", activePage: "", query: "" });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`商城运行在 http://localhost:${port}`));
}

module.exports = app;
