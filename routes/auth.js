const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { registrationInput, registerUser, authenticate } = require("../services/userService");
const { safeReturnTo, csrfToken, verifyCsrf, sessionAction } = require("../utils/auth");
const { requireAuth } = require("../middleware/auth");
const { cookieName, cookieOptions } = require("../config/session");
const router = express.Router();

async function form(req, res, page, status = 200, errors = [], values = {}) {
  const token = csrfToken(req);
  const registered = page === "login" && req.session.registered === true;
  delete req.session.registered;
  await sessionAction(req, "save");
  res.status(status).render(`auth/${page}`, {
    title: `${page === "login" ? "登录" : "注册"} · 拾光商城`, activePage: page, query: "",
    csrfToken: token, nextUrl: safeReturnTo(req.body?.next || req.query.next), errors, values, registered
  });
}

function limiter(limit, windowMs, skipSuccessfulRequests = false) {
  return rateLimit({ windowMs, limit, standardHeaders: "draft-8", legacyHeaders: false, skipSuccessfulRequests,
    handler: (req, res) => res.status(429).render("message", {
      title: "请稍后重试", icon: "info", message: "尝试次数较多，请稍后再试",
      description: "为保护账户，暂时限制了这个网络地址的连续尝试。请按响应中的 Retry-After 时间重试。", activePage: "", query: ""
    }) });
}

router.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.get(["/login", "/register"], (req, res) => {
  if (req.user) return res.redirect(303, safeReturnTo(req.query.next));
  return form(req, res, /^\/register\/?$/i.test(req.path) ? "register" : "login");
});

router.post("/register", verifyCsrf, limiter(5, 60 * 60 * 1000), async (req, res, next) => {
  if (req.user) return res.redirect(303, "/account");
  const input = registrationInput(req.body);
  const values = { username: input.username, email: input.email };
  if (input.errors.length) return form(req, res, "register", 422, input.errors, values);
  try {
    await registerUser(input);
    req.session.registered = true;
    await sessionAction(req, "save");
    res.redirect(303, `/login?next=${encodeURIComponent(safeReturnTo(req.body.next))}`);
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return form(req, res, "register", 409, ["用户名或邮箱已被使用，请更换后重试。"], values);
    next(error);
  }
});

router.post("/login", verifyCsrf, limiter(10, 15 * 60 * 1000, true), async (req, res, next) => {
  if (req.user) return res.redirect(303, "/account");
  const identifier = typeof req.body.identifier === "string" ? req.body.identifier.trim() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  if (!identifier || identifier.length > 191 || !password || Buffer.byteLength(password) > 72) {
    return form(req, res, "login", 422, ["请输入有效的用户名或邮箱，以及密码。"], { identifier });
  }
  try {
    const userId = await authenticate(identifier, password);
    if (!userId) return form(req, res, "login", 401, ["账号或密码不正确。"], { identifier });
    await sessionAction(req, "regenerate");
    req.session.userId = userId;
    csrfToken(req);
    await sessionAction(req, "save");
    res.redirect(303, safeReturnTo(req.body.next));
  } catch (error) { next(error); }
});

router.post("/logout", verifyCsrf, async (req, res, next) => {
  try {
    await sessionAction(req, "destroy");
    res.clearCookie(cookieName, cookieOptions());
    res.redirect(303, "/login");
  } catch (error) { next(error); }
});

router.get("/account", requireAuth, (req, res) => res.render("auth/account", {
  title: "我的账户 · 拾光商城", activePage: "account", query: ""
}));

module.exports = router;
