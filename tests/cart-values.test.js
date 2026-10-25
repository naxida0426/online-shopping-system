const test = require("node:test");
const assert = require("node:assert/strict");
const { toCents, formatCents } = require("../utils/money");
const { readQuantity, CartError } = require("../services/cartService");

test("购物车金额精确到分，大额累计也不转成浮点数", () => {
  assert.equal(formatCents(toCents("0.10") + toCents("0.20")), "0.30");
  assert.equal(formatCents(toCents("12.34") * 3n), "37.02");
  assert.equal(formatCents(toCents("99999999.99") * 999n * 100000n), "9989999999001000.00");
  assert.equal(formatCents(0n), "0.00");
  for (const value of [0.1, "12.345", "-1.00", "1e2", "NaN"]) assert.throws(() => toCents(value));
});

test("购物车数量拒绝零、负数、小数、指数、空值和数组", () => {
  for (const value of ["1", "999", 2]) assert.equal(readQuantity(value), Number(value));
  for (const value of ["0", "-1", "1.5", "1e2", "01", " 1", "1000", "", undefined, ["1"], true, {}]) {
    assert.throws(() => readQuantity(value), CartError);
  }
});
