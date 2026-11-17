const test=require('node:test'),assert=require('node:assert/strict');
const{flashPrice,couponDiscount,promotionDay}=require('../utils/promotions');
test('八折按整数分四舍五入，抵扣封顶订单金额',()=>{
  assert.equal(flashPrice('123.45'),'98.76');assert.equal(flashPrice('0.01'),'0.01');assert.equal(flashPrice('0.02'),'0.02');
  assert.equal(flashPrice('0.03'),'0.02');assert.equal(flashPrice('99999999.99'),'79999999.99');
  assert.equal(couponDiscount('1.23','100.00'),'1.23');assert.equal(couponDiscount('150.00','50.00'),'50.00');
  assert.equal(couponDiscount('0.00','50.00'),'0.00');
});
test('活动日期固定使用上海时区',()=>{
  assert.equal(promotionDay(new Date('2026-11-17T15:59:59Z')),'2026-11-17');
  assert.equal(promotionDay(new Date('2026-11-17T16:00:00Z')),'2026-11-18');
});
