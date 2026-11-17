const{randomInt,randomBytes}=require('node:crypto');
const{getPool}=require('../config/db');
const{withUserTransaction}=require('../config/transaction');
const{flashPrice,couponDiscount,promotionDay}=require('../utils/promotions');
const{toCents,formatCents}=require('../utils/money');
const{OrderError}=require('../utils/order-error');
const{lockOrder,ensureUnpaid,expireLockedOrder}=require('./orderLifecycle');

// The daily row is the current spotlight. Cart rows already validated on entry
// retain its expiry/discount even after the spotlight moves to another product.
async function rotateFlashOffer(connection,offerId,previousProductId){
  const[candidates]=await connection.execute(`SELECT p.id FROM products p JOIN categories c ON c.id=p.category_id
    WHERE p.id<>? AND p.status='active' AND p.deleted_at IS NULL AND p.stock>0 AND c.is_active=1 ORDER BY p.id`,[previousProductId]);
  if(!candidates.length)return false;
  const selected=candidates[randomInt(candidates.length)].id;
  await connection.execute('UPDATE flash_offers SET product_id=? WHERE id=?',[selected,offerId]);
  return true;
}

async function getFlashOffer() {
  const pool=getPool(),day=promotionDay();
  // The persisted current spotlight is shared across visitors and server processes.
  const [existing]=await pool.execute(`SELECT f.id,p.id AS productId,p.name,p.price AS originalPrice,f.expires_at,
    UNIX_TIMESTAMP(f.expires_at)*1000 AS expiresAt FROM flash_offers f JOIN products p ON p.id=f.product_id
    JOIN categories c ON c.id=p.category_id WHERE f.offer_day=? AND f.expires_at>NOW()
    AND p.status='active' AND p.deleted_at IS NULL AND p.stock>0 AND c.is_active=1`,[day]);
  if(existing.length)return{...existing[0],price:flashPrice(existing[0].originalPrice)};
  const [[pointer]]=await pool.execute('SELECT id,product_id FROM flash_offers WHERE offer_day=? AND expires_at>NOW()',[day]);
  if(pointer){
    const connection=await pool.getConnection();
    try{
      await connection.beginTransaction();
      const [[locked]]=await connection.execute('SELECT id,product_id FROM flash_offers WHERE id=? FOR UPDATE',[pointer.id]);
      if(locked)await rotateFlashOffer(connection,locked.id,locked.product_id);
      await connection.commit();
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
    const [[replacement]]=await pool.execute(`SELECT f.id,p.id AS productId,p.name,p.price AS originalPrice,
      UNIX_TIMESTAMP(f.expires_at)*1000 AS expiresAt FROM flash_offers f JOIN products p ON p.id=f.product_id
      JOIN categories c ON c.id=p.category_id WHERE f.id=? AND f.expires_at>NOW()
      AND p.status='active' AND p.deleted_at IS NULL AND p.stock>0 AND c.is_active=1`,[pointer.id]);
    return replacement?{...replacement,price:flashPrice(replacement.originalPrice)}:null;
  }
  const [candidates]=await pool.execute(`SELECT p.id FROM products p JOIN categories c ON c.id=p.category_id
    WHERE p.status='active' AND p.deleted_at IS NULL AND p.stock>0 AND c.is_active=1 ORDER BY p.id`);
  if(!candidates.length)return null;
  const selected=candidates[randomInt(candidates.length)].id;
  // UTC literal stored/read in the database's existing wall-clock convention via FROM_UNIXTIME.
  const expiresAt=Date.parse(day+'T00:00:00+08:00')+86400000;
  await pool.execute('INSERT IGNORE INTO flash_offers(offer_day,product_id,expires_at) VALUES(?,?,FROM_UNIXTIME(?))',[day,selected,expiresAt/1000]);
  const [[row]]=await pool.execute(`SELECT f.id,p.id AS productId,p.name,p.price AS originalPrice,
    UNIX_TIMESTAMP(f.expires_at)*1000 AS expiresAt FROM flash_offers f JOIN products p ON p.id=f.product_id
    JOIN categories c ON c.id=p.category_id WHERE f.offer_day=? AND f.expires_at>NOW()
    AND p.status='active' AND p.deleted_at IS NULL AND p.stock>0 AND c.is_active=1`,[day]);
  return row?{...row,price:flashPrice(row.originalPrice)}:null;
}
async function issueCode(userId) {
  return withUserTransaction(userId,async c=>{
    const day=promotionDay();
    const [[old]]=await c.execute('SELECT code,amount,redeemed_at AS redeemedAt,expires_at AS expiresAt FROM promotion_codes WHERE user_id=? AND issued_day=?',[userId,day]);
    if(old)return old;
    const code='VIBE-'+randomBytes(10).toString('hex').toUpperCase(),amount=randomInt(50,101)+'.00';
    await c.execute('INSERT INTO promotion_codes(user_id,code,issued_day,amount,expires_at) VALUES(?,?,?,?,DATE_ADD(NOW(),INTERVAL 24 HOUR))',[userId,code,day,amount]);
    return{code,amount,redeemedAt:null};
  });
}
async function applyCode(userId,orderId,input) {
  if(typeof input!=='string' || !/^VIBE-[A-F0-9]{20}$/i.test(input.trim()))throw new OrderError('请输入有效的兑换码。',422);
  const code=input.trim().toUpperCase();
  return withUserTransaction(userId,async c=>{
    const{order:o,payment:p}=await lockOrder(c,userId,orderId);
    if(await expireLockedOrder(c,o,p))return'order_expired';
    ensureUnpaid(o,p);
    const [[current]]=await c.execute('SELECT * FROM order_promotions WHERE order_id=? FOR UPDATE',[o.id]);
    if(current?.coupon_code===code)return'coupon_applied';
    if(current?.coupon_code)throw new OrderError('每笔订单限用一张兑换码。',409);
    const [[coupon]]=await c.execute('SELECT *,expires_at<=NOW() AS expired FROM promotion_codes WHERE code=? AND user_id=? FOR UPDATE',[code,userId]);
    if(!coupon)throw new OrderError('兑换码不存在或不属于当前账户。',422);
    if(coupon.expired)throw new OrderError('兑换码已过期。',422);
    if(coupon.redeemed_at || (coupon.reserved_order_id && coupon.reserved_order_id!==o.id))throw new OrderError('兑换码已使用或已被其他订单占用。',409);
    const items=current?.items_amount || o.total_amount,discount=couponDiscount(items,coupon.amount),total=formatCents(toCents(items)-toCents(discount));
    await c.execute(`INSERT INTO order_promotions(order_id,items_amount,coupon_discount,coupon_code) VALUES(?,?,?,?)
      ON DUPLICATE KEY UPDATE coupon_discount=VALUES(coupon_discount),coupon_code=VALUES(coupon_code)`,[o.id,items,discount,code]);
    await c.execute('UPDATE promotion_codes SET reserved_order_id=? WHERE id=?',[o.id,coupon.id]);
    await c.execute('UPDATE orders SET total_amount=? WHERE id=?',[total,o.id]);
    if(p)await c.execute('UPDATE payments SET amount=? WHERE order_id=?',[total,o.id]);
    return'coupon_applied';
  });
}
module.exports={getFlashOffer,rotateFlashOffer,issueCode,applyCode};
