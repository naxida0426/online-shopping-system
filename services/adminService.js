const fs = require("node:fs/promises");
const path = require("node:path");
const { getPool } = require("../config/db");
const { withUserTransaction } = require("../config/transaction");
const { OrderError, getOwnOrder } = require("./orderService");
const { isValidProductId } = require("../utils/catalog");
const { orderPagination, readOrderOptions } = require("../utils/orders");
const { productInput, productVersion, productOptions, dateRange } = require("../utils/admin");

function idValue(value) {
  if (!["string","number"].includes(typeof value) || !isValidProductId(value)) throw new OrderError("记录不存在。",404);
  return Number(value);
}
async function assertAdmin(c, userId) {
  const [[user]] = await c.execute("SELECT id FROM users WHERE id = ? AND role = 'admin' AND status = 'active' AND deleted_at IS NULL", [userId]);
  if (!user) throw new OrderError("需要有效管理员权限。",403);
}
const adminTransaction = (userId, work) => withUserTransaction(userId, async c => { await assertAdmin(c,userId); return work(c); });
const dto = row => ({ ...row, categoryId: String(row.category_id), imagePath: row.image_path, isDemo: Boolean(row.is_demo), version: productVersion(row) });
async function categories(adminId) { await assertAdmin(getPool(), adminId); const [rows] = await getPool().execute("SELECT id, name, is_active FROM categories ORDER BY sort_order,id"); return rows; }
async function getProduct(adminId, id) {
  await assertAdmin(getPool(),adminId);
  const [[row]] = await getPool().execute("SELECT * FROM products WHERE id = ?",[idValue(id)]);
  if (!row) throw new OrderError("商品不存在。",404);
  return dto(row);
}
async function listProducts(adminId, input = {}) {
  await assertAdmin(getPool(),adminId);
  const options = productOptions(input), conditions = [], params = [];
  if (options.status !== "all") { conditions.push("p.status = ?"); params.push(options.status); }
  if (options.query) { conditions.push("CONCAT_WS(' ',p.name,p.sku) LIKE ? ESCAPE '!'"); params.push(`%${options.query.replace(/[!%_]/g,"!$&")}%`); }
  const where = `FROM products p JOIN categories c ON c.id=p.category_id ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}`;
  const [[count]] = await getPool().execute(`SELECT COUNT(*) AS total ${where}`,params);
  const pagination = orderPagination(Number(count.total),options.page);
  const [rows] = await getPool().execute(`SELECT p.*,c.name AS categoryName ${where} ORDER BY p.id DESC LIMIT ? OFFSET ?`,[...params,String(pagination.pageSize),String((pagination.page-1)*pagination.pageSize)]);
  return { products: rows.map(dto), options, pagination };
}
async function saveProduct(adminId, id, body, version) {
  const {values:v,errors} = productInput(body);
  if (errors.length) throw new OrderError(errors.join(" "),422);
  try { await fs.access(path.join(__dirname,"..","public",v.imagePath.slice(1))); } catch { throw new OrderError("本地图片不存在，请先将图片放入 public/images。",422); }
  return adminTransaction(adminId,async c => {
    if (id) {
      const [[old]] = await c.execute("SELECT * FROM products WHERE id = ? FOR UPDATE",[idValue(id)]);
      if (!old || old.status === "deleted" || old.deleted_at) throw new OrderError("商品已删除或不存在。",404);
      if (productVersion(old) !== version) throw new OrderError("商品或库存已变化，请核对刷新后的数据再编辑。");
    }
    const [[category]] = await c.execute("SELECT id FROM categories WHERE id = ? FOR SHARE",[Number(v.categoryId)]);
    if (!category) throw new OrderError("分类不存在。",422);
    const fields = [v.sku,v.name,Number(v.categoryId),v.description,v.price,Number(v.stock),v.imagePath,v.status,v.tag,v.color,v.isDemo ? 1 : 0];
    try {
      if (id) { await c.execute("UPDATE products SET sku=?,name=?,category_id=?,description=?,price=?,stock=?,image_path=?,status=?,tag=?,color=?,is_demo=? WHERE id=?",[...fields,Number(id)]); return Number(id); }
      const [result] = await c.execute("INSERT INTO products (sku,name,category_id,description,price,stock,image_path,status,tag,color,is_demo) VALUES (?,?,?,?,?,?,?,?,?,?,?)",fields);
      return result.insertId;
    } catch (error) { if(error.code === "ER_DUP_ENTRY") throw new OrderError("SKU 已被使用，请更换商品编号。",409); throw error; }
  });
}
async function deleteProduct(adminId, id, version) {
  return adminTransaction(adminId,async c => {
    const [[row]] = await c.execute("SELECT * FROM products WHERE id = ? FOR UPDATE",[idValue(id)]);
    if (!row) throw new OrderError("商品不存在。",404);
    if (row.status === "deleted") return;
    if (productVersion(row) !== version) throw new OrderError("商品或库存已变化，请重新确认删除。");
    await c.execute("UPDATE products SET status='deleted',deleted_at=CURRENT_TIMESTAMP WHERE id=?",[Number(id)]);
  });
}
async function listOrders(adminId,input={}) {
  await assertAdmin(getPool(),adminId);
  const options=readOrderOptions(input),conditions=[],params=[];
  const filters={unpaid:"o.order_status='pending' AND o.payment_status='unpaid'",paid:"o.payment_status='paid' AND o.order_status<>'cancelled'",cancelled:"o.order_status='cancelled'"};
  if(filters[options.status]) conditions.push(filters[options.status]);
  if(options.query){conditions.push("CONCAT_WS(' ',o.order_no,u.username) LIKE ? ESCAPE '!'");params.push(`%${options.query.replace(/[!%_]/g,"!$&")}%`);}
  const where=`FROM orders o JOIN users u ON u.id=o.user_id ${conditions.length?`WHERE ${conditions.join(" AND ")}`:""}`;
  const [[count]]=await getPool().execute(`SELECT COUNT(*) AS total ${where}`,params);
  const pagination=orderPagination(Number(count.total),options.page);
  const [orders]=await getPool().execute(`SELECT o.id,o.order_no AS orderNo,o.order_status AS orderStatus,o.payment_status AS paymentStatus,o.total_amount AS total,o.created_at AS createdAt,u.username ${where} ORDER BY o.id DESC LIMIT ? OFFSET ?`,[...params,String(pagination.pageSize),String((pagination.page-1)*pagination.pageSize)]);
  return {orders,options,pagination};
}
async function adminOrder(adminId,id) {
  await assertAdmin(getPool(),adminId);
  const [[row]]=await getPool().execute("SELECT user_id FROM orders WHERE id=?",[idValue(id)]);
  if(!row) throw new OrderError("订单不存在。",404);
  return getOwnOrder(row.user_id,Number(id));
}
async function advanceOrder(adminId,id,next,expected) {
  return adminTransaction(adminId,async c=>{
    const [[order]]=await c.execute("SELECT order_status,payment_status FROM orders WHERE id=? FOR UPDATE",[idValue(id)]);
    if(!order) throw new OrderError("订单不存在。",404);
    if(!["shipped","completed"].includes(next)) throw new OrderError("只支持已确认 → 已发货 → 已完成。",422);
    if(order.order_status === next && order.payment_status === "paid") return;
    if(order.order_status!==expected || order.payment_status!=="paid" || ({confirmed:"shipped",shipped:"completed"})[order.order_status]!==next) throw new OrderError("订单状态已变化，或尚未支付，不能进行此操作。");
    await c.execute("UPDATE orders SET order_status=? WHERE id=?",[next,Number(id)]);
  });
}
async function salesStats(adminId,input={}) {
  await assertAdmin(getPool(),adminId);
  const range=dateRange(input),p=[range.start,range.end],c=await getPool().getConnection();
  try {
    await c.beginTransaction();
    const [[created]]=await c.execute("SELECT COUNT(*) AS orderCount FROM orders WHERE created_at>=? AND created_at<DATE_ADD(?,INTERVAL 1 DAY)",p);
    const paid="o.payment_status='paid' AND o.order_status<>'cancelled' AND o.paid_at>=? AND o.paid_at<DATE_ADD(?,INTERVAL 1 DAY)";
    const [[revenue]]=await c.execute(`SELECT COUNT(*) AS paidCount,COALESCE(SUM(o.total_amount),0.00) AS salesAmount FROM orders o WHERE ${paid}`,p);
    const [daily]=await c.execute(`SELECT DATE(o.paid_at) AS day,COUNT(*) AS orders,SUM(o.total_amount) AS amount FROM orders o WHERE ${paid} GROUP BY DATE(o.paid_at) ORDER BY day`,p);
    const [products]=await c.execute(`SELECT i.product_id AS productId,p.name,SUM(i.quantity) AS quantity,SUM(i.subtotal) AS revenue FROM order_items i JOIN orders o ON o.id=i.order_id JOIN products p ON p.id=i.product_id WHERE ${paid} GROUP BY i.product_id,p.name ORDER BY SUM(i.quantity) DESC,i.product_id LIMIT 20`,p);
    await c.commit();
    const byDay=new Map(daily.map(row=>[row.day,row.amount])),labels=[],sales=[];
    for(let d=Date.parse(range.start);d<=Date.parse(range.end);d+=86400000){const key=new Date(d).toISOString().slice(0,10);labels.push(key);sales.push(byDay.get(key)||"0.00");}
    return {...range,...created,...revenue,products,daily,labels,sales};
  } catch(error){await c.rollback().catch(()=>{});throw error;} finally{c.release();}
}
module.exports={assertAdmin,categories,getProduct,listProducts,saveProduct,deleteProduct,listOrders,adminOrder,advanceOrder,salesStats};
