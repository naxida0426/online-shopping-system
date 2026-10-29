const { normalizePage, paginationItems } = require("./catalog");
const orderFilters = { all: "全部订单", unpaid: "待支付", paid: "已支付", cancelled: "已取消" };
function readOrderOptions(input = {}) {
  const valid = typeof input.status === "string" && Object.hasOwn(orderFilters, input.status);
  return { status: valid ? input.status : "all", invalidStatus: input.status !== undefined && !valid,
    query: typeof input.q === "string" ? input.q.trim().slice(0, 50) : "", page: Array.isArray(input.page) ? 1 : normalizePage(input.page) };
}
function orderParams(options = {}) {
  const p = new URLSearchParams();
  if (options.query) p.set("q", options.query);
  if (options.status && options.status !== "all" && Object.hasOwn(orderFilters, options.status)) p.set("status", options.status);
  if (normalizePage(options.page) > 1) p.set("page", normalizePage(options.page));
  return p.size ? `?${p}` : "";
}
const orderListUrl = (options = {}) => `/orders${orderParams(options)}`;
function orderUrl(id, options = {}, action = "") {
  if (!["", "pay", "cancel", "email"].includes(action)) throw new TypeError("无效的订单操作。");
  return `/orders/${encodeURIComponent(id)}${action ? `/${action}` : ""}${orderParams(options)}`;
}
function orderPagination(total, requested, pageSize = 10) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize)), page = Math.min(normalizePage(requested), totalPages);
  return { total, page, pageSize, totalPages, wasAdjusted: normalizePage(requested) !== page, items: paginationItems(page, totalPages) };
}
module.exports = { orderFilters, readOrderOptions, orderListUrl, orderUrl, orderPagination };
