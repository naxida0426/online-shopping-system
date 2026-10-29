const { createHash } = require("node:crypto");

function shippingInput(body = {}) {
  const text = key => typeof body[key] === "string" ? body[key].trim() : "";
  const values = { recipientName: text("recipientName"), recipientPhone: text("recipientPhone"), recipientAddress: text("recipientAddress") };
  values.recipientAddress = values.recipientAddress.replace(/\r?\n/g, " ");
  const errors = [];
  if (!values.recipientName || values.recipientName.length > 80 || /[\p{Cc}<>]/u.test(values.recipientName)) errors.push("收货人须为 1–80 个字符，不能包含控制字符或尖括号。");
  if (!/^1[3-9]\d{9}$/.test(values.recipientPhone)) errors.push("请输入 11 位中国大陆手机号码；课程演示请填写虚构号码。");
  if (values.recipientAddress.length < 5 || values.recipientAddress.length > 500 || /[\p{Cc}<>]/u.test(values.recipientAddress)) errors.push("详细地址须为 5–500 个字符，不能包含控制字符或尖括号。");
  return { values, errors };
}

function cartFingerprint(items) {
  const rows = items.map(item => [item.id, item.productId, item.quantity, item.price, item.name]).sort((a, b) => a[1] - b[1]);
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function validCheckoutToken(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

module.exports = { shippingInput, cartFingerprint, validCheckoutToken };
