const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { shippingInput, cartFingerprint, validCheckoutToken } = require("../utils/checkout");

test("收货信息校验长度、手机号、控制字符和数组，保留正常中文", () => {
  const good = { recipientName: " 演示顾客 ", recipientPhone: "13900000000", recipientAddress: "虚构城市教学路 1 号，仅用于测试" };
  assert.deepEqual(shippingInput(good).errors, []);
  assert.equal(shippingInput(good).values.recipientName, "演示顾客");
  assert.equal(shippingInput({ ...good, recipientAddress: "虚构城市\n教学路 1 号" }).values.recipientAddress, "虚构城市 教学路 1 号");
  for (const change of [{ recipientName: "" }, { recipientName: ["顾客"] }, { recipientName: "a".repeat(81) }, { recipientName: "a\n" + "b" }, { recipientPhone: "12345678901" }, { recipientAddress: "短" }, { recipientAddress: "x".repeat(501) }, { recipientAddress: "<script>alert(1)</script>" }]) {
    assert.ok(shippingInput({ ...good, ...change }).errors.length);
  }
});

test("结算指纹检测数量与价格变化，不受条目显示顺序影响", () => {
  const a = { id: 1, productId: 2, quantity: 1, price: "0.10", name: "好物" };
  const b = { id: 2, productId: 1, quantity: 2, price: "12.34", name: "台灯" };
  assert.equal(cartFingerprint([a, b]), cartFingerprint([b, a]));
  assert.notEqual(cartFingerprint([a]), cartFingerprint([{ ...a, quantity: 2 }]));
  assert.notEqual(cartFingerprint([a]), cartFingerprint([{ ...a, price: "0.11" }]));
  assert.notEqual(cartFingerprint([a]), cartFingerprint([{ ...a, name: "另一件好物" }]));
  assert.ok(validCheckoutToken(randomUUID()));
  for (const value of ["", "' OR 1=1", [randomUUID()], {}]) assert.equal(validCheckoutToken(value), false);
});
