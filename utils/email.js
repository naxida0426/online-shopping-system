// 课程项目只接受单个普通邮箱地址，不接受显示名、地址列表或引号地址。
// 注册邮箱也用于邮件收件人，因此不能只检查是否含有 @ 和点号。
function isValidEmail(value) {
  if (typeof value !== "string" || value.length > 191) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) ||
      local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label));
}

module.exports = { isValidEmail };
