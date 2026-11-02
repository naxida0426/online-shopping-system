const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { verifyCsrf } = require("../utils/auth");
const { shippingInput } = require("../utils/checkout");
const { listAddresses, getAddress, saveAddress, changeAddress, AddressError } = require("../services/addressService");
const router = express.Router();
router.use(requireAuth);
router.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
function renderForm(res, id, values = {}, errors = [], status = 200) {
  return res.status(status).render("addresses/form", { title: `${id ? "编辑" : "新增"}收货地址 · 拾光商城`, activePage: "account", query: "", id, values, errors });
}
router.get("/", async (req, res) => res.render("addresses/index", {
  title: "收货地址簿 · 拾光商城", activePage: "account", query: "", addresses: await listAddresses(req.user.id)
}));
router.get("/new", (req, res) => renderForm(res, null));
router.get("/:id/edit", async (req, res) => renderForm(res, req.params.id, await getAddress(req.user.id, req.params.id)));
router.get("/:id/delete", async (req, res) => res.render("addresses/delete", {
  title: "删除收货地址 · 拾光商城", activePage: "account", query: "", address: await getAddress(req.user.id, req.params.id)
}));
function save(idFromRequest) {
  return async (req, res, next) => {
    const id = idFromRequest ? req.params.id : null;
    try {
      await saveAddress(req.user.id, id, req.body);
      res.redirect(303, "/account/addresses");
    } catch (error) {
      if (error instanceof AddressError && error.status !== 404) {
        return renderForm(res, id, { ...shippingInput(req.body).values, isDefault: req.body.isDefault === "yes" }, [error.message], error.status);
      }
      next(error);
    }
  };
}
router.post("/", verifyCsrf, save(false));
router.post("/:id", verifyCsrf, save(true));
router.post("/:id/default", verifyCsrf, async (req, res) => {
  await changeAddress(req.user.id, req.params.id, "default");
  res.redirect(303, "/account/addresses");
});
router.post("/:id/delete", verifyCsrf, async (req, res) => {
  if (req.body.confirmDelete !== "yes") throw new AddressError("请先查看说明，再确认删除地址。", 422);
  await changeAddress(req.user.id, req.params.id, "delete");
  res.redirect(303, "/account/addresses");
});
router.use((error, req, res, next) => {
  if (!(error instanceof AddressError)) return next(error);
  res.status(error.status).render("message", { title: "地址操作未完成", icon: "info", message: "地址操作未完成", description: error.message,
    activePage: "account", query: "", actionUrl: "/account/addresses", actionLabel: "返回地址簿" });
});
module.exports = router;
