const { randomBytes, timingSafeEqual } = require("node:crypto");

function safeReturnTo(value) {
  if (typeof value !== "string" || value.length > 1000 || !value.startsWith("/") || /[\\\r\n]|%5c|%0[ad]/i.test(value)) return "/account";
  try {
    const url = new URL(value, "http://local.invalid");
    if (url.origin !== "http://local.invalid" || !/^\/(?:account|cart|products(?:\/[1-9]\d*)?)?$/.test(url.pathname)) return "/account";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return "/account"; }
}

function csrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString("hex");
  return req.session.csrfToken;
}

function verifyCsrf(req, res, next) {
  const supplied = req.body?._csrf;
  const stored = req.session?.csrfToken;
  if (typeof supplied !== "string" || typeof stored !== "string" || !/^[a-f0-9]{64}$/.test(supplied) || supplied.length !== stored.length ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(stored))) {
    return res.status(403).render("message", {
      title: "请重新打开表单", icon: "info", message: "表单已失效，请刷新后重试",
      description: "为保护你的账户，这次操作没有执行。请重新打开页面再提交。",
      activePage: "", query: "", actionUrl: req.path === "/register" ? "/register" : "/login", actionLabel: "重新打开表单"
    });
  }
  next();
}

function sessionAction(req, action) {
  return new Promise((resolve, reject) => req.session[action](error => error ? reject(error) : resolve()));
}

module.exports = { safeReturnTo, csrfToken, verifyCsrf, sessionAction };
