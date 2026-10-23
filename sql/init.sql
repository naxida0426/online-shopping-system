-- 由 npm run db:init 创建并选中 .env 中的数据库后，逐条执行本文件。
-- 要求 MySQL 8.0.19+，推荐 8.4 LTS，所有表使用 InnoDB 与 utf8mb4。
-- 不包含 DROP、TRUNCATE 或默认管理员密码，可重复执行，但不是表结构迁移工具。

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(50) NOT NULL,
  email VARCHAR(191) NOT NULL,
  password_hash VARCHAR(255) NOT NULL COMMENT '仅保存 bcrypt 等算法生成的密码哈希',
  role ENUM('customer', 'admin') NOT NULL DEFAULT 'customer',
  status ENUM('active', 'disabled', 'deleted') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS categories (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(50) NOT NULL,
  name VARCHAR(80) NOT NULL,
  icon VARCHAR(30) NOT NULL DEFAULT 'grid',
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_slug (slug),
  CONSTRAINT chk_categories_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS products (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  category_id INT UNSIGNED NOT NULL,
  sku VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  stock INT UNSIGNED NOT NULL DEFAULT 0,
  image_path VARCHAR(500) NOT NULL,
  tag VARCHAR(30) NOT NULL DEFAULT '',
  color VARCHAR(20) NOT NULL DEFAULT 'sand',
  status ENUM('active', 'inactive', 'deleted') NOT NULL DEFAULT 'active',
  is_demo BOOLEAN NOT NULL DEFAULT FALSE COMMENT '示例商品标记，不代表真实交易商品',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_sku (sku),
  KEY idx_products_category_status (category_id, status),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
  CONSTRAINT chk_products_price CHECK (price >= 0),
  CONSTRAINT chk_products_stock CHECK (stock >= 0),
  CONSTRAINT chk_products_demo CHECK (is_demo IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cart_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cart_user_product (user_id, product_id),
  CONSTRAINT fk_cart_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cart_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT chk_cart_quantity CHECK (quantity BETWEEN 1 AND 999)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS orders (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_no VARCHAR(32) NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  checkout_token CHAR(36) NOT NULL COMMENT '同一用户同一次结算的幂等标识',
  total_amount DECIMAL(12,2) NOT NULL,
  order_status ENUM('pending', 'confirmed', 'shipped', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
  payment_status ENUM('unpaid', 'paid', 'cancelled', 'refunded') NOT NULL DEFAULT 'unpaid',
  recipient_name VARCHAR(80) NOT NULL,
  recipient_phone VARCHAR(30) NOT NULL,
  recipient_address VARCHAR(500) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  paid_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_no (order_no),
  UNIQUE KEY uq_orders_checkout (user_id, checkout_token),
  KEY idx_orders_user_created (user_id, created_at),
  KEY idx_orders_payment_created (payment_status, created_at),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_orders_total CHECK (total_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id INT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NOT NULL,
  product_name VARCHAR(120) NOT NULL COMMENT '下单时的名称快照',
  unit_price DECIMAL(10,2) NOT NULL COMMENT '下单时的单价快照',
  quantity INT UNSIGNED NOT NULL,
  subtotal DECIMAL(12,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_order_items_order (order_id),
  KEY idx_order_items_product (product_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT chk_order_items_price CHECK (unit_price >= 0),
  CONSTRAINT chk_order_items_quantity CHECK (quantity BETWEEN 1 AND 999),
  CONSTRAINT chk_order_items_subtotal CHECK (subtotal = unit_price * quantity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS payments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id INT UNSIGNED NOT NULL,
  payment_no VARCHAR(40) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  method ENUM('simulated') NOT NULL DEFAULT 'simulated' COMMENT '仅模拟支付，不保存银行卡信息',
  status ENUM('pending', 'succeeded', 'cancelled', 'failed', 'refunded') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  paid_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_order (order_id),
  UNIQUE KEY uq_payments_no (payment_no),
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  CONSTRAINT chk_payments_amount CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 建表是 MySQL DDL，可能隐式提交。示例数据单独放在事务中。
START TRANSACTION;

INSERT INTO categories (slug, name, icon, sort_order) VALUES
  ('home', '居家生活', 'home', 10),
  ('digital', '数码配件', 'headphones', 20),
  ('daily', '日常出行', 'bag', 30),
  ('stationery', '文具手账', 'book', 40)
ON DUPLICATE KEY UPDATE slug = categories.slug;

-- SKU 唯一，重复执行只保留旧记录，不覆盖手动修改的价格、库存或状态。
INSERT INTO products (category_id, sku, name, description, price, stock, image_path, tag, color, is_demo)
SELECT id, 'DEMO-LAMP', '暖光蘑菇台灯', '一盏柔光，陪你度过安静的夜晚。', 129.00, 30, '/images/lamp.svg', '人气之选', 'sand', TRUE
FROM categories WHERE slug = 'home'
ON DUPLICATE KEY UPDATE sku = products.sku;

INSERT INTO products (category_id, sku, name, description, price, stock, image_path, tag, color, is_demo)
SELECT id, 'DEMO-MUG', '随行陶瓷马克杯', '温润的触感，装下每天的第一杯温暖。', 59.00, 50, '/images/mug.svg', '日常灵感', 'sage', TRUE
FROM categories WHERE slug = 'home'
ON DUPLICATE KEY UPDATE sku = products.sku;

INSERT INTO products (category_id, sku, name, description, price, stock, image_path, tag, color, is_demo)
SELECT id, 'DEMO-HEADPHONES', '轻享无线耳机', '给日常按下播放键，留一点时间给自己。', 199.00, 20, '/images/headphones.svg', '编辑推荐', 'stone', TRUE
FROM categories WHERE slug = 'digital'
ON DUPLICATE KEY UPDATE sku = products.sku;

INSERT INTO products (category_id, sku, name, description, price, stock, image_path, tag, color, is_demo)
SELECT id, 'DEMO-TOTE', '简约帆布托特包', '轻装出门，把喜欢和日常一起装进去。', 79.00, 40, '/images/tote.svg', '轻松出行', 'peach', TRUE
FROM categories WHERE slug = 'daily'
ON DUPLICATE KEY UPDATE sku = products.sku;

INSERT INTO products (category_id, sku, name, description, price, stock, image_path, tag, color, is_demo)
SELECT id, 'DEMO-NOTEBOOK', '留白方格手账本', '写下灵感，也记录那些平凡的小美好。', 35.00, 60, '/images/notebook.svg', '记录生活', 'paper', TRUE
FROM categories WHERE slug = 'stationery'
ON DUPLICATE KEY UPDATE sku = products.sku;

INSERT INTO products (category_id, sku, name, description, price, stock, image_path, tag, color, is_demo)
SELECT id, 'DEMO-CLOCK', '原木静音小闹钟', '让时间慢一点，让生活多一点从容。', 89.00, 25, '/images/clock.svg', '温柔陪伴', 'clay', TRUE
FROM categories WHERE slug = 'home'
ON DUPLICATE KEY UPDATE sku = products.sku;

COMMIT;
