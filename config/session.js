const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const { getPool } = require("./db");

const cookieName = "shiguang.sid";
const cookieOptions = () => ({ httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
let store;
let middleware;

function validateSessionSecret() {
  const value = process.env.SESSION_SECRET || "";
  if (Buffer.byteLength(value) < 32 || /^(replace_with_|change_me|your_)/i.test(value)) {
    const error = new Error("会话密钥尚未配置，请执行 npm run session:setup 后重启网站。");
    error.code = "SESSION_CONFIG_INVALID";
    throw error;
  }
  return value;
}

function getMiddleware() {
  if (!middleware) {
    const secret = validateSessionSecret();
    store = new MySQLStore({ createDatabaseTable: false, endConnectionOnClose: false }, getPool());
    // 驱动错误只交给请求错误处理中间件，不在日志中打印连接参数。
    store.on("error", () => console.error("[session] 会话存储暂不可用。"));
    middleware = session({
      name: cookieName, secret, store, resave: false, saveUninitialized: false,
      cookie: { ...cookieOptions(), maxAge: 8 * 60 * 60 * 1000 }
    });
  }
  return middleware;
}

function sessionMiddleware(req, res, next) {
  // 匿名浏览商品不创建会话；需要账户操作或已有会话时才访问会话表。
  if (!/^\/(login|register|logout|account|cart)(\/|$)/i.test(req.path) &&
      !(req.headers.cookie || "").split(";").some(part => part.trim().startsWith(`${cookieName}=`))) return next();
  try { getMiddleware()(req, res, next); } catch (error) { next(error); }
}

async function closeSessionStore() {
  if (store) await store.close();
  store = undefined;
  middleware = undefined;
}

module.exports = { sessionMiddleware, closeSessionStore, validateSessionSecret, cookieName, cookieOptions };
