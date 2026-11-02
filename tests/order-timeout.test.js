const test = require("node:test");
const assert = require("node:assert/strict");
const { paymentTimeoutSeconds } = require("../config/orders");

test("支付超时配置默认 30 分钟，支持演示秒数并拒绝越界配置", () => {
  assert.equal(paymentTimeoutSeconds({}), 1800);
  assert.equal(paymentTimeoutSeconds({ ORDER_PAYMENT_TIMEOUT_SECONDS: "60" }), 60);
  for (const value of ["", "0", "-1", "1.5", "86401", "oops", " 60 "]) {
    assert.throws(() => paymentTimeoutSeconds({ ORDER_PAYMENT_TIMEOUT_SECONDS: value }));
  }
});
