const express = require("express");
const { getProductList, getProductById } = require("../services/catalogService");
const { readBrowseOptions, catalogUrl } = require("../utils/catalog");
const router = express.Router();

router.get("/", async (req, res, next) => {
  const options = readBrowseOptions(req.query);
  try {
    const catalog = await getProductList(options);
    res.render("products/index", {
      title: options.query ? `${options.query} · 商品搜索 · 拾光商城` : "发现好物 · 拾光商城",
      activePage: "products", query: options.query, ...catalog
    });
  } catch (error) { next(error); }
});

router.get("/:id", async (req, res, next) => {
  const options = readBrowseOptions(req.query);
  try {
    const product = await getProductById(req.params.id);
    if (!product) {
      return res.status(404).render("message", {
        title: "商品未找到 · 拾光商城", icon: "search", message: "这件好物暂时无法查看",
        description: "商品可能已下架、所在分类已停用，或链接地址有误。请返回列表看看其他好物。",
        activePage: "products", query: options.query,
        actionUrl: catalogUrl(options.query, options.category, options.page), actionLabel: "返回商品列表"
      });
    }
    res.render("products/show", {
      title: `${product.name} · 拾光商城`, activePage: "products", product,
      query: options.query, category: options.category,
      backUrl: catalogUrl(options.query, options.category, options.page)
    });
  } catch (error) { next(error); }
});

module.exports = router;
