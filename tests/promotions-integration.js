const assert=require('node:assert/strict');
const{randomUUID}=require('node:crypto');
const bcrypt=require('bcryptjs');
const{addItem,getCart}=require('../services/cartService');
const{createOrder,getOwnOrder}=require('../services/orderService');
const{simulatePayment,cancelOrder}=require('../services/paymentService');
const{issueCode,applyCode,getFlashOffer}=require('../services/promotionService');
const{cartFingerprint}=require('../utils/checkout');
const{toCents,formatCents}=require('../utils/money');
const{confirmationMessage,deliverOrderEmail}=require('../services/mailService');
const createClient=require('./http-client');
module.exports=async function(t,{pool,base}){
 const users=[],sessions=new Set(),suffix=randomUUID().slice(0,8),password=randomUUID();
 let productId,offerId,alice,bob,catId;
 const shipping={recipientName:'促销测试',recipientPhone:'13800000000',recipientAddress:'演示城市测试地址18号'};
 const makeOrder=async(user,quantity=1,flash=false)=>{
  await addItem(user,productId,String(quantity),flash?String(offerId):undefined);
  const cart=await getCart(user),token=randomUUID();
  return createOrder(user,token,{token,fingerprint:cartFingerprint(cart.items)},shipping);
 };
 try{
  for(let i=0;i<2;i++){
   const name=`promo_${suffix}_${i}`;
   const [r]=await pool.execute('INSERT INTO users(username,email,password_hash) VALUES(?,?,?)',[name,name+'@example.invalid',await bcrypt.hash(password,10)]);users.push(r.insertId);
  }
  [alice,bob]=users;
  const[cat]=await pool.execute("INSERT INTO categories(slug,name) VALUES(?,'促销验收')",['promo-'+suffix]);catId=cat.insertId;
  const[p]=await pool.execute("INSERT INTO products(category_id,sku,name,description,price,stock,image_path) VALUES(?,?,'促销测试键盘','测试','123.45',500,'/images/electronics-keyboard.jpg')",[catId,'PROMO-'+suffix]);productId=p.insertId;
  const[f]=await pool.execute("INSERT INTO flash_offers(offer_day,product_id,expires_at) VALUES(?, ?, DATE_ADD(NOW(),INTERVAL 2 HOUR))",['2099-01-01',productId]);offerId=f.insertId;
  await t.test('每日闪购固定，八折入口不能伪造商品或活动',async()=>{
   const first=await getFlashOffer(),next=await getFlashOffer();assert.equal(first.id,next.id);
   await assert.rejects(addItem(alice,productId,'1','4294967295'),{status:409});
   await addItem(alice,productId,'2',String(offerId));const c=await getCart(alice);assert.equal(c.total,'197.52');assert.equal(c.items[0].price,'98.76');assert.equal(c.items[0].isFlashSale,true);
   await pool.execute('DELETE FROM cart_items WHERE user_id=?',[alice]);
  });
  let paid,code,net;
  await t.test('发行金额50–100元、每天一张、账户绑定及CSRF',async()=>{
   const pair=await Promise.all([issueCode(alice),issueCode(alice)]);assert.equal(pair[0].code,pair[1].code);code=pair[0];
   assert(toCents(code.amount)>=5000n&&toCents(code.amount)<=10000n);
   const guest=await createClient(base);assert.equal((await guest.post('/promotions/codes')).status,303);
   const client=await createClient(base,`promo_${suffix}_0`,password,sessions);
   assert.equal((await client.post('/promotions/codes',{_csrf:''})).status,403);
   const issued=await client.post('/promotions/codes');assert.equal(issued.status,303);
   const foreign=await makeOrder(bob);await assert.rejects(applyCode(bob,foreign,code.code),{status:422});
   await assert.rejects(applyCode(alice,foreign,code.code),{status:404});
  });
  await t.test('兑换写入故障整体回滚，过期和伪造兑换码不改变订单金额',async()=>{
   const probe=await makeOrder(alice);
   await assert.rejects(applyCode(alice,probe,'VIBE-00000000000000000000'),{status:422});
   await pool.execute('UPDATE promotion_codes SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE code=?',[code.code]);
   await assert.rejects(applyCode(alice,probe,code.code),{status:422});
   await pool.execute('UPDATE promotion_codes SET expires_at=DATE_ADD(NOW(),INTERVAL 24 HOUR) WHERE code=?',[code.code]);
   const original=pool.getConnection.bind(pool);let failed=false;
   pool.getConnection=async()=>{const c=await original(),execute=c.execute.bind(c);c.execute=async(sql,...args)=>{
    if(!failed && /^UPDATE orders SET total_amount/.test(sql)){failed=true;const e=Error('injected');e.code='TEST_PROMO_WRITE';throw e;}
    return execute(sql,...args);
   };return c;};
   try{await assert.rejects(applyCode(alice,probe,code.code),{code:'TEST_PROMO_WRITE'});}finally{pool.getConnection=original;}
   const [[coupon]]=await pool.execute('SELECT reserved_order_id FROM promotion_codes WHERE code=?',[code.code]);
   assert.equal(coupon.reserved_order_id,null);assert.equal((await getOwnOrder(alice,probe)).total,'123.45');
  });
  await t.test('并发兑换只占用一个订单，不重复叠加且支付取消保留占用',async()=>{
   const a=await makeOrder(alice,2,true),b=await makeOrder(alice,2,true);
   const results=await Promise.allSettled([applyCode(alice,a,code.code),applyCode(alice,b,code.code)]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);paid=results[0].status==='fulfilled'?a:b;
   const o=await getOwnOrder(alice,paid);net=formatCents(19752n-toCents(code.amount));
   assert.equal(o.total,net);assert.equal(o.flashDiscount,'49.38');assert.equal(o.originalAmount,'246.90');assert.equal(o.itemsAmount,'197.52');
   await applyCode(alice,paid,code.code);assert.equal((await getOwnOrder(alice,paid)).total,net);
   await simulatePayment(alice,paid,'cancel');assert.equal((await getOwnOrder(alice,paid)).payment.amount,net);
  });
  await t.test('支付幂等、兑换码只核销一次、邮件和回执使用优惠后金额',async()=>{
   const r=await Promise.all([simulatePayment(alice,paid,'success'),simulatePayment(alice,paid,'success')]);assert(r.includes('paid'));assert(r.includes('already_paid'));
   const o=await getOwnOrder(alice,paid);assert.equal(o.payment.amount,net);assert.equal(o.total,net);
   const [[c]]=await pool.execute('SELECT redeemed_at FROM promotion_codes WHERE code=?',[code.code]);assert(c.redeemed_at);
   const fresh=await makeOrder(alice);await assert.rejects(applyCode(alice,fresh,code.code),{status:409});
   let message;
   await deliverOrderEmail(alice,paid,{transport:{sendMail:async m=>{message=m;return{accepted:[m.to]}}}});
   assert(message.text.includes('模拟支付金额：¥'+net));assert(message.text.includes('兑换码抵扣：¥'+code.amount));
  });
  await t.test('取消及超时释放未核销兑换码，金额不足时抵扣到零',async()=>{
   const c=await issueCode(bob),a=await makeOrder(bob);await applyCode(bob,a,c.code);await cancelOrder(bob,a);
   const b=await makeOrder(bob);await applyCode(bob,b,c.code);await pool.execute('UPDATE orders SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE id=?',[b]);await getOwnOrder(bob,b);
   const [[released]]=await pool.execute('SELECT reserved_order_id,redeemed_at FROM promotion_codes WHERE code=?',[c.code]);assert.equal(released.reserved_order_id,null);assert.equal(released.redeemed_at,null);
   await pool.execute("UPDATE products SET price='1.23' WHERE id=?",[productId]);
   const zero=await makeOrder(bob);await applyCode(bob,zero,c.code);const order=await getOwnOrder(bob,zero);assert.equal(order.total,'0.00');assert.equal(order.couponDiscount,'1.23');
   await simulatePayment(bob,zero,'success');assert.equal((await getOwnOrder(bob,zero)).payment.amount,'0.00');
  });
  await t.test('过期活动不能加购，旧八折快照不能按原价悄悄下单',async()=>{
   await addItem(alice,productId,'1',String(offerId));const cart=await getCart(alice),token=randomUUID();
   await pool.execute('UPDATE flash_offers SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE id=?',[offerId]);
   await assert.rejects(addItem(bob,productId,'1',String(offerId)),{status:409});
   await assert.rejects(createOrder(alice,token,{token,fingerprint:cartFingerprint(cart.items)},shipping),{status:409});
  });
 }finally{
  for(const id of sessions)await pool.execute('DELETE FROM sessions WHERE session_id=?',[id]);
  for(const user of users){
   await pool.execute('DELETE FROM promotion_codes WHERE user_id=?',[user]);
   for(const table of ['payments','order_items'])await pool.execute(`DELETE FROM ${table} WHERE order_id IN(SELECT id FROM orders WHERE user_id=?)`,[user]);
   await pool.execute('DELETE FROM orders WHERE user_id=?',[user]);await pool.execute('DELETE FROM cart_items WHERE user_id=?',[user]);await pool.execute('DELETE FROM users WHERE id=?',[user]);
  }
  if(offerId)await pool.execute('DELETE FROM flash_offers WHERE id=?',[offerId]);
  if(productId)await pool.execute('DELETE FROM products WHERE id=?',[productId]);if(catId)await pool.execute('DELETE FROM categories WHERE id=?',[catId]);
 }
};
