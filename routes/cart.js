const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { verifyCsrf, sessionAction } = require("../utils/auth");
const { getCart, addItem, updateItem, removeItem, CartError } = require("../services/cartService");
const router = express.Router();

router.use(requireAuth);

async function renderCart(req, res, status = 200, errorMessage = "") {
  const cart = await getCart(req.user.id);
  const notice = typeof req.session.cartNotice === "string" ? req.session.cartNotice : "";
  if (req.session.cartNotice) {
    delete req.session.cartNotice;
    await sessionAction(req, "save");
  }
  res.status(status).render("cart/index", { title: "购物车 · 拾光商城", activePage: "cart", query: "", cart, notice, errorMessage });
}

router.get("/", (req, res) => renderCart(req, res));

function mutation(work, notice) {
  return async (req, res) => {
    await work(req);
    req.session.cartNotice = notice;
    await sessionAction(req, "save");
    res.redirect(303, "/cart");
  };
}

router.post("/items", verifyCsrf, mutation(req => addItem(req.user.id, req.body.productId, req.body.quantity), "商品已加入购物车；重复加入的数量已合并。"));
router.post("/items/:id/quantity", verifyCsrf, mutation(req => updateItem(req.user.id, req.params.id, req.body.quantity), "商品数量已更新。"));
router.post("/items/:id/delete", verifyCsrf, mutation(req => removeItem(req.user.id, req.params.id), "商品已从购物车移除。"));

router.use((error, req, res, next) => {
  if (error instanceof CartError) return renderCart(req, res, error.status, error.message).catch(next);
  next(error);
});

module.exports = router;
