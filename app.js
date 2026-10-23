require("./config/environment");
const express = require("express");
const path = require("node:path");
const { getHomeCatalog } = require("./services/catalogService");
const { checkDatabase, describeDatabaseError, closePool } = require("./config/db");
const { readBrowseOptions, catalogUrl, productUrl } = require("./utils/catalog");
const productRoutes = require("./routes/products");
const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor/bootstrap", express.static(path.join(__dirname, "node_modules/bootstrap/dist")));

app.locals.shopUrl = catalogUrl;
app.locals.productUrl = productUrl;
app.locals.year = new Date().getFullYear();

app.get("/", async (req, res, next) => {
  const options = readBrowseOptions(req.query);
  try {
    const catalog = await getHomeCatalog(options);
    res.render("index", { title: "拾光商城 · 把喜欢带回日常", activePage: "home", query: options.query, ...catalog });
  } catch (error) {
    next(error);
  }
});

app.use("/products", productRoutes);

app.get("/health/db", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    await checkDatabase();
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    res.status(503).json({ status: "unavailable", message: describeDatabaseError(error) });
  }
});

const upcomingPages = {
  "/login": { title: "登录", icon: "user", message: "登录功能正在准备中", description: "这里将支持账号登录与会话管理。当前尚未接入用户系统。" },
  "/register": { title: "注册", icon: "user", message: "期待与你初次见面", description: "注册功能将在后续阶段开放。目前不会收集或保存你的个人信息。" },
  "/cart": { title: "购物车", icon: "bag", message: "你的好物清单，即将上线", description: "购物车功能尚未实现。当前商品仅供课程展示，暂不支持加入购物车、下单或支付。" }
};
Object.entries(upcomingPages).forEach(([route, page]) => {
  app.get(route, (req, res) => res.render("message", { ...page, activePage: route.slice(1), query: "" }));
});

app.use((req, res) => {
  res.status(404).render("message", { title: "页面未找到", icon: "search", message: "这页小美好，还没找到", description: "页面地址可能有误，返回首页继续逛逛吧。", activePage: "", query: "" });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof URIError) {
    return res.status(400).render("message", {
      title: "链接地址有误", icon: "info", message: "链接地址有误",
      description: "这个地址包含无效编码，请从商品列表重新打开。",
      activePage: "products", query: "", actionUrl: "/products", actionLabel: "返回商品列表"
    });
  }
  // 不输出原始 SQL、连接配置或驱动错误详情，防止泄漏账号与凭据。
  const isDatabaseError = error.code === "DB_CONFIG_INVALID" || /^(DB_|ER_|ECONN|ETIMEDOUT|ENOTFOUND|EHOST|PROTOCOL_|POOL_)/.test(error.code || "");
  console.error(isDatabaseError ? "[database] 商品读取失败，请执行 npm run db:check。" : "[app] 请求处理失败。");
  res.status(isDatabaseError ? 503 : 500).render("message", {
    title: "商品暂不可用", icon: "info", message: "商品暂时无法加载",
    description: isDatabaseError ? describeDatabaseError(error) : "页面暂时不可用，请稍后重试。",
    activePage: req.path.startsWith("/products") ? "products" : "home", query: ""
  });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  const server = app.listen(port, () => {
    console.log(`商城运行在 http://localhost:${port}`);
    checkDatabase().then(() => console.log("MySQL 连接与表结构检查通过。"))
      .catch(error => console.error(`数据库检查：${describeDatabaseError(error)}`));
  });
  const shutdown = () => {
    server.close(() => closePool().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

module.exports = app;
