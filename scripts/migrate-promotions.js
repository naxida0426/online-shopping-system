require('../config/environment');
async function migratePromotions(c) {
  await c.query(`CREATE TABLE IF NOT EXISTS flash_offers (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, offer_day DATE NOT NULL UNIQUE,
    product_id INT UNSIGNED NOT NULL, expires_at DATETIME NOT NULL,
    CONSTRAINT fk_flash_product FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  const [columns]=await c.execute("SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='cart_items' AND column_name='flash_offer_id'");
  if(!columns.length)await c.query('ALTER TABLE cart_items ADD COLUMN flash_offer_id INT UNSIGNED NULL');
  await c.query(`CREATE TABLE IF NOT EXISTS promotion_codes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id INT UNSIGNED NOT NULL,
    code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    issued_day DATE NOT NULL, amount DECIMAL(10,2) NOT NULL, expires_at DATETIME NOT NULL,
    reserved_order_id INT UNSIGNED NULL, redeemed_at DATETIME NULL,
    UNIQUE KEY uq_daily_code(user_id,issued_day),
    CONSTRAINT fk_code_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_code_order FOREIGN KEY(reserved_order_id) REFERENCES orders(id) ON DELETE SET NULL,
    CONSTRAINT chk_code_amount CHECK(amount BETWEEN 50 AND 100)
  ) ENGINE=InnoDB`);
  await c.query(`CREATE TABLE IF NOT EXISTS order_promotions (
    order_id INT UNSIGNED PRIMARY KEY, items_amount DECIMAL(12,2) NOT NULL,
    flash_discount DECIMAL(12,2) NOT NULL DEFAULT 0,
    coupon_discount DECIMAL(12,2) NOT NULL DEFAULT 0, coupon_code VARCHAR(32) NULL,
    CONSTRAINT fk_promotion_order FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT chk_promotion_amounts CHECK(items_amount>=0 AND flash_discount>=0 AND coupon_discount>=0 AND coupon_discount<=items_amount)
  ) ENGINE=InnoDB`);
}
if(require.main===module){
  const mysql=require('mysql2/promise');
  const{readDatabaseConfig}=require('../config/database-config');
  mysql.createConnection(readDatabaseConfig(process.env,{initialize:true})).then(async c=>{
    try{await migratePromotions(c);console.log('促销表及购物车活动字段升级完成。')}finally{await c.end()}
  }).catch(e=>{console.error(e.message);process.exitCode=1});
}
module.exports={migratePromotions};
