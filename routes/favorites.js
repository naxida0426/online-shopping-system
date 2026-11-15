const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { verifyCsrf, safeReturnTo } = require("../utils/auth");
const { listFavorites, setFavorite, FavoriteError } = require("../services/favoriteService");
const router = express.Router();
router.use(requireAuth);
router.get("/", async (req, res) => res.render("favorites/index", {
  title: "我的收藏 · 拾光商城", activePage: "account", query: "", ...await listFavorites(req.user.id, req.query.page)
}));
router.post("/:productId", verifyCsrf, async (req, res, next) => {
  try {
    const isFavorite = await setFavorite(req.user.id, req.params.productId, req.body.action);
    if (req.get("Accept") === "application/json") return res.json({ isFavorite, productId: Number(req.params.productId) });
    res.redirect(303, safeReturnTo(req.body.returnTo));
  } catch (error) {
    if (!(error instanceof FavoriteError)) return next(error);
    if (req.get("Accept") === "application/json") return res.status(error.status).json({ message: error.message });
    res.status(error.status).render("message", { title: "收藏操作未完成", message: "收藏操作未完成", description: error.message,
      icon: "info", activePage: "account", query: "", actionUrl: "/account/favorites", actionLabel: "返回我的收藏" });
  }
});
module.exports = router;
