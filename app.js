require("./config/environment");
const express = require("express");
const path = require("node:path");
const { getHomeCatalog } = require("./services/catalogService");
const { checkDatabase, describeDatabaseError, closePool } = require("./config/db");
const { readBrowseOptions, catalogUrl, productUrl } = require("./utils/catalog");
const productRoutes = require("./routes/products");
const authRoutes = require("./routes/auth");
const { sessionMiddleware, closeSessionStore, validateSessionSecret } = require("./config/session");
const { loadCurrentUser, requireAuth } = require("./middleware/auth");
const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: false, limit: "10kb", parameterLimit: 20 }));
app.use((req, res, next) => {
  res.locals.currentUser = null;
  res.locals.csrfToken = "";
  next();
});
app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor/bootstrap", express.static(path.join(__dirname, "node_modules/bootstrap/dist")));

app.locals.shopUrl = catalogUrl;
app.locals.productUrl = productUrl;
app.locals.year = new Date().getFullYear();
app.locals.currentUser = null;
app.locals.csrfToken = "";

app.get("/health/db", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    await checkDatabase();
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    res.status(503).json({ status: "unavailable", message: describeDatabaseError(error) });
  }
});
app.use(sessionMiddleware);
app.use(loadCurrentUser);
app.use(authRoutes);

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

app.get("/cart", requireAuth, (req, res) => res.render("message", {
  title: "购物车", icon: "bag", message: "你的好物清单，即将上线",
  description: "你已登录。购物车将在下一阶段开放，当前暂不支持加入商品、下单或支付。", activePage: "cart", query: ""
}));

app.use((req, res) => {
  res.status(404).render("message", { title: "页面未找到", icon: "search", message: "这页小美好，还没找到", description: "页面地址可能有误，返回首页继续逛逛吧。", activePage: "", query: "" });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === "entity.too.large" || error.type === "parameters.too.many") {
    return res.status(413).render("message", { title: "表单内容过多", icon: "info", message: "表单内容过多", description: "请检查输入内容后重新提交。", activePage: "", query: "" });
  }
  if (error.code === "SESSION_CONFIG_INVALID") {
    return res.status(503).render("message", { title: "账户服务未配置", icon: "info", message: "账户服务暂不可用", description: error.message, activePage: "", query: "" });
  }
  if (error instanceof URIError) {
    return res.status(400).render("message", {
      title: "链接地址有误", icon: "info", message: "链接地址有误",
      description: "这个地址包含无效编码，请从商品列表重新打开。",
      activePage: "products", query: "", actionUrl: "/products", actionLabel: "返回商品列表"
    });
  }
  // 不输出原始 SQL、连接配置或驱动错误详情，防止泄漏账号与凭据。
  const isDatabaseError = error.code === "DB_CONFIG_INVALID" || /^(DB_|ER_|ECONN|ETIMEDOUT|ENOTFOUND|EHOST|PROTOCOL_|POOL_)/.test(error.code || "");
  console.error(isDatabaseError ? "[database] 数据读取失败，请执行 npm run db:check。" : "[app] 请求处理失败。");
  res.status(isDatabaseError ? 503 : 500).render("message", {
    title: "服务暂不可用", icon: "info", message: "服务暂时无法使用",
    description: isDatabaseError ? describeDatabaseError(error) : "页面暂时不可用，请稍后重试。",
    activePage: req.path.startsWith("/products") ? "products" : "home", query: ""
  });
});

if (require.main === module) {
  try { validateSessionSecret(); }
  catch (error) { console.error(error.message); process.exit(1); }
  const port = process.env.PORT || 3000;
  const server = app.listen(port, () => {
    console.log(`商城运行在 http://localhost:${port}`);
    checkDatabase().then(() => console.log("MySQL 连接与表结构检查通过。"))
      .catch(error => console.error(`数据库检查：${describeDatabaseError(error)}`));
  });
  const shutdown = () => {
    server.close(() => closeSessionStore().then(closePool).then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

module.exports = app;
