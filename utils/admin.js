const { createHash } = require("node:crypto");
const { OrderError } = require("../services/orderService");
const { normalizePage } = require("./catalog");
function productInput(body = {}) {
  const text = key => typeof body[key] === "string" ? body[key].trim() : "";
  const values = { sku: text("sku"), name: text("name"), categoryId: text("categoryId"), description: text("description"),
    price: text("price"), stock: text("stock"), imagePath: text("imagePath"), status: text("status"), tag: text("tag"), color: text("color") || "sand", isDemo: body.isDemo === "1" };
  const errors = [];
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(values.sku)) errors.push("SKU 须为 1–64 个字母、数字、下划线或连字符。");
  if (!values.name || values.name.length > 120 || /\p{Cc}/u.test(values.name)) errors.push("名称须为 1–120 个普通字符。");
  if (!/^[1-9]\d{0,9}$/.test(values.categoryId) || Number(values.categoryId) > 4294967295) errors.push("请选择有效分类。");
  if (!values.description || values.description.length > 5000) errors.push("描述须为 1–5000 个字符。");
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(values.price)) errors.push("价格须为非负金额，整数最多 8 位、小数最多 2 位。");
  else { const [a,b = ""] = values.price.split("."); values.price = `${BigInt(a)}.${b.padEnd(2,"0")}`; }
  if (!/^(?:0|[1-9]\d{0,9})$/.test(values.stock) || Number(values.stock) > 4294967295) errors.push("库存须为 0–4294967295 的整数。");
  if (!/^\/images\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(svg|png|jpe?g|webp|gif)$/i.test(values.imagePath)) errors.push("图片请填写本地 /images/ 下的图片地址。");
  if (!["active","inactive"].includes(values.status)) errors.push("请选择上架或下架状态。");
  if (values.tag.length > 30) errors.push("标签不能超过 30 字符。");
  if (!["sand","sage","stone","peach","paper","clay"].includes(values.color)) errors.push("请选择有效背景色。");
  return { values, errors };
}
function productVersion(row) {
  return createHash("sha256").update(JSON.stringify([row.id,row.category_id,row.sku,row.name,row.description,row.price,row.stock,row.image_path,row.status,row.tag,row.color,row.is_demo,row.deleted_at])).digest("hex");
}
function productOptions(input = {}) {
  return { query: typeof input.q === "string" ? input.q.trim().slice(0,100) : "", status: ["active","inactive","deleted"].includes(input.status) ? input.status : "all", page: Array.isArray(input.page) ? 1 : normalizePage(input.page) };
}
function dateRange(input = {}) {
  const today = new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Shanghai"}).format(new Date());
  const end = typeof input.end === "string" && input.end ? input.end : today;
  const start = typeof input.start === "string" && input.start ? input.start : new Date(Date.parse(today)+(-29*86400000)).toISOString().slice(0,10);
  const valid = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number(s.slice(0,4)) >= 2000 && Number(s.slice(0,4)) <= 2100 && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
  if ((input.start !== undefined && typeof input.start !== "string") || (input.end !== undefined && typeof input.end !== "string") || !valid(start) || !valid(end) || start > end || Date.parse(end)-Date.parse(start)>365*86400000) throw new OrderError("日期格式须为有效的 YYYY-MM-DD，起止顺序正确，范围不超过 366 天（2000–2100 年）。",422);
  return { start, end };
}
module.exports = { productInput, productVersion, productOptions, dateRange };
