// MySQL DECIMAL 转整数分计算，避免 0.1 + 0.2 的浮点误差。
function toCents(value) {
  if (typeof value !== "string" || !/^\d+\.\d{2}$/.test(value)) throw new TypeError("金额必须为两位小数的 DECIMAL 字符串。");
  return BigInt(value.replace(".", ""));
}

function formatCents(value) {
  if (typeof value !== "bigint" || value < 0n) throw new TypeError("金额必须为非负整数分。");
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

module.exports = { toCents, formatCents };
