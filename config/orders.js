function paymentTimeoutSeconds(env = process.env) {
  const value = env.ORDER_PAYMENT_TIMEOUT_SECONDS ?? "1800";
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 86400) {
    throw new Error("ORDER_PAYMENT_TIMEOUT_SECONDS 须为 1–86400 的整数秒数。");
  }
  return Number(value);
}
module.exports = { paymentTimeoutSeconds };
