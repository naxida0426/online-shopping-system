const express = require("express");
const { randomUUID } = require("node:crypto");
const { getCart } = require("../services/cartService");
const { createOrder, getOrders, getOwnOrder, OrderError, MAX_ORDER_CENTS } = require("../services/orderService");
const { shippingInput, cartFingerprint } = require("../utils/checkout");
const { toCents } = require("../utils/money");
const { requireAuth } = require("../middleware/auth");
const { verifyCsrf, sessionAction } = require("../utils/auth");
const router = express.Router();

router.use(["/checkout", "/orders"], requireAuth);

const orderLabels = { pending: "待确认", confirmed: "已确认", shipped: "已发货", completed: "已完成", cancelled: "已取消" };
const paymentLabels = { unpaid: "未支付", paid: "已支付", cancelled: "已取消", refunded: "已退款" };
router.use((req, res, next) => { res.locals.orderLabels = orderLabels; res.locals.paymentLabels = paymentLabels; next(); });

async function renderCheckout(req, res, { status = 200, errors = [], values = {} } = {}) {
  const cart = await getCart(req.user.id);
  const blocked = !cart.items.length || cart.unavailableCount > 0 || toCents(cart.total) > MAX_ORDER_CENTS;
  let token = "";
  if (!blocked) {
    const fingerprint = cartFingerprint(cart.items);
    if (req.session.checkoutDraft?.fingerprint !== fingerprint) {
      req.session.checkoutDraft = { token: randomUUID(), fingerprint };
    }
    token = req.session.checkoutDraft.token;
    await sessionAction(req, "save");
  }
  res.status(status).render("orders/checkout", {
    title: "确认订单 · 拾光商城", activePage: "orders", query: "", cart, token, blocked, errors, values
  });
}

router.get("/checkout", (req, res) => renderCheckout(req, res));
router.get("/orders", async (req, res) => {
  const orders = await getOrders(req.user.id);
  res.render("orders/index", { title: "我的订单 · 拾光商城", activePage: "orders", query: "", orders });
});
router.get("/orders/:id", async (req, res) => {
  const order = await getOwnOrder(req.user.id, req.params.id);
  if (!order) return res.status(404).render("message", {
    title: "订单未找到", icon: "info", message: "无法查看这笔订单", description: "订单不存在或不属于当前账号。",
    activePage: "orders", query: "", actionUrl: "/orders", actionLabel: "返回我的订单"
  });
  res.render("orders/show", { title: "订单详情 · 拾光商城", activePage: "orders", query: "", order });
});
router.post("/orders", verifyCsrf, async (req, res, next) => {
  const { values, errors } = shippingInput(req.body);
  if (errors.length) return renderCheckout(req, res, { status: 422, errors, values });
  try {
    const id = await createOrder(req.user.id, req.body.checkoutToken, req.session.checkoutDraft, values);
    res.redirect(303, `/orders/${id}`);
  } catch (error) {
    if (error instanceof OrderError) return renderCheckout(req, res, { status: error.status, errors: [error.message], values });
    next(error);
  }
});

module.exports = router;
