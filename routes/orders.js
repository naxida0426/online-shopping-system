const express = require("express");
const { randomUUID } = require("node:crypto");
const { getCart } = require("../services/cartService");
const { createOrder, getOrders, getOwnOrder, OrderError, MAX_ORDER_CENTS } = require("../services/orderService");
const { simulatePayment, cancelOrder } = require("../services/paymentService");
const { deliverOrderEmail } = require("../services/mailService");
const { readOrderOptions, orderFilters, orderListUrl, orderUrl } = require("../utils/orders");
const { shippingInput, cartFingerprint } = require("../utils/checkout");
const { toCents } = require("../utils/money");
const { requireAuth } = require("../middleware/auth");
const { verifyCsrf, sessionAction } = require("../utils/auth");
const router = express.Router();

router.use(["/checkout", "/orders"], requireAuth);

const orderLabels = { pending: "待确认", confirmed: "已确认", shipped: "已发货", completed: "已完成", cancelled: "已取消" };
const paymentLabels = { unpaid: "未支付", paid: "已支付", cancelled: "已取消", refunded: "已退款" };
router.use((req, res, next) => {
  Object.assign(res.locals, { orderLabels, paymentLabels, orderFilters, orderListUrl, orderUrl,
    recordLabels: { pending: "处理中", succeeded: "模拟支付成功", cancelled: "已取消", failed: "未成功", refunded: "已退款" },
    emailLabels: { pending: "等待发送", sending: "正在发送", sent: "SMTP 已接受，实际送达以收件箱为准", skipped: "SMTP 未配置，尚未验证发送", failed: "发送失败，可稍后重试" } });
  next();
});

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
  const history = await getOrders(req.user.id, req.query);
  res.render("orders/index", { title: "我的订单 · 拾光商城", activePage: "orders", query: "", orders: history.orders, pagination: history.pagination, browse: history });
});

async function renderOrder(req, res, { status = 200, errorMessage = "", view = "show" } = {}) {
  const order = await getOwnOrder(req.user.id, req.params.id);
  if (!order) return res.status(404).render("message", {
    title: "订单未找到", icon: "info", message: "无法查看这笔订单", description: "订单不存在或不属于当前账号。",
    activePage: "orders", query: "", actionUrl: "/orders", actionLabel: "返回我的订单"
  });
  const browse = readOrderOptions(req.query);
  if (view !== "show" && !order.canPay) return res.redirect(303, orderUrl(order.id, browse));
  const notice = req.session.orderNotice?.id === order.id ? req.session.orderNotice.text : "";
  if (notice) { delete req.session.orderNotice; await sessionAction(req, "save"); }
  res.status(status).render(`orders/${view}`, { title: `${view === "pay" ? "模拟支付" : view === "cancel" ? "取消订单" : "订单详情"} · 拾光商城`, activePage: "orders", query: "", order, browse, notice, errorMessage });
}
router.get("/orders/:id", (req, res) => renderOrder(req, res));
router.get("/orders/:id/pay", (req, res) => renderOrder(req, res, { view: "pay" }));
router.get("/orders/:id/cancel", (req, res) => renderOrder(req, res, { view: "cancel" }));
const notices = { paid: "模拟支付成功，未发生真实扣款。", already_paid: "此前已完成模拟支付，未重复处理。", payment_cancelled: "已取消本次支付，订单仍待支付；取消订单才会恢复库存。", order_cancelled: "订单已取消，库存已恢复。", already_cancelled: "此前已取消，未重复恢复库存。" };
function orderAction(work, sendEmail = false) {
  return async (req, res, next) => {
    try {
      const result = await work(req);
      let text = notices[result] || "操作已完成。";
      if (sendEmail && ["paid", "already_paid"].includes(result)) {
        const email = await deliverOrderEmail(req.user.id, Number(req.params.id)).catch(() => "failed");
        if (email !== "sent") text += " 邮件尚未确认发送，请查看下方邮件状态。";
      }
      req.session.orderNotice = { id: Number(req.params.id), text };
      await sessionAction(req, "save");
      res.redirect(303, orderUrl(req.params.id, readOrderOptions(req.query)));
    } catch (error) {
      if (error instanceof OrderError) return renderOrder(req, res, { status: error.status, errorMessage: error.message });
      next(error);
    }
  };
}
router.post("/orders/:id/pay", verifyCsrf, orderAction(req => simulatePayment(req.user.id, req.params.id, req.body.outcome), true));
router.post("/orders/:id/cancel", verifyCsrf, orderAction(req => {
  if (req.body.confirmCancel !== "yes") throw new OrderError("请先查看说明，再确认取消订单。", 422);
  return cancelOrder(req.user.id, req.params.id);
}));
router.post("/orders/:id/email", verifyCsrf, async (req, res) => {
  const order = await getOwnOrder(req.user.id, req.params.id);
  if (!order || order.paymentStatus !== "paid") return renderOrder(req, res, { status: order ? 409 : 404, errorMessage: "只能重试本人已支付订单的确认邮件。" });
  const result = await deliverOrderEmail(req.user.id, order.id).catch(() => "failed");
  req.session.orderNotice = { id: order.id, text: result === "sent" ? "SMTP 已接受此邮件，实际送达请检查收件箱。" : "邮件未确认发送。请检查 SMTP 配置，重试间隔 60 秒，最多 5 次。" };
  await sessionAction(req, "save");
  res.redirect(303, orderUrl(order.id, readOrderOptions(req.query)));
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
