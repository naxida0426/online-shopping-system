const { findActiveUser } = require("../services/userService");
const { csrfToken, safeReturnTo, sessionAction } = require("../utils/auth");
const { cookieName, cookieOptions } = require("../config/session");

async function loadCurrentUser(req, res, next) {
  try {
    if (req.session?.userId) {
      req.user = await findActiveUser(req.session.userId);
      if (!req.user) {
        await sessionAction(req, "regenerate");
        res.clearCookie(cookieName, cookieOptions());
      } else {
        res.locals.currentUser = req.user;
        res.locals.csrfToken = csrfToken(req);
      }
    }
    next();
  } catch (error) { next(error); }
}

function requireAuth(req, res, next) {
  res.set("Cache-Control", "no-store");
  if (!req.user) return res.redirect(303, `/login?next=${encodeURIComponent(safeReturnTo(req.originalUrl))}`);
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role === "admin") return next();
    res.status(403).render("message", { title: "无访问权限", icon: "info", message: "此页面需要管理员权限", description: "当前账号不能执行这项操作。", activePage: "", query: "" });
  });
}

module.exports = { loadCurrentUser, requireAuth, requireAdmin };
