const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const bcrypt=require('bcryptjs'),nodemailer=require('nodemailer');
const {addItem,getCart}=require('../services/cartService');
const {createOrder,getOwnOrder,getOrders}=require('../services/orderService');
const {simulatePayment,cancelOrder}=require('../services/paymentService');
const {cartFingerprint}=require('../utils/checkout');
const {toCents,formatCents}=require('../utils/money');
const admin=require('../services/adminService');
const {deliverOrderEmail,confirmationMessage}=require('../services/mailService');
const {createInitialAdmin}=require('../scripts/create-admin');
const createClient=require('./http-client');

module.exports=async function verifyBusiness(t,{pool,base}){
 const suffix=randomUUID().slice(0,8),password=randomUUID(),users=[],sessions=new Set(),products=[];
 const shipping={recipientName:'演示顾客',recipientPhone:'13900000000',recipientAddress:'虚构城市教学区演示路 10 号，仅测试'};
 const body={sku:`BUS-${suffix}-A`,name:'业务测试台灯',categoryId:'',description:'独立测试库商品',price:'12.34',stock:'5000',imagePath:'/images/lamp.svg',status:'active',tag:'演示',color:'sand'};
 let categoryId,adminId,alice,bob,staff,paidId,paidNo,unpaidId;
 async function stocks(){const result=[];for(const id of products){const [[p]]=await pool.execute('SELECT stock FROM products WHERE id=?',[id]);result.push(p.stock);}return result;}
 async function makeOrder(user=users[0],entries=[[0,2],[1,3]]){
  await pool.execute('DELETE FROM cart_items WHERE user_id=?',[user]);for(const [i,q]of entries)await addItem(user,products[i],q);
  const token=randomUUID(),draft={token,fingerprint:cartFingerprint((await getCart(user)).items)};
  return createOrder(user,token,draft,shipping);
 }
 async function payment(id){const [[p]]=await pool.execute('SELECT * FROM payments WHERE order_id=?',[id]);return p;}
 async function version(id){return (await admin.getProduct(adminId,id)).version;}
 async function failOnce(prefix,work){const original=pool.getConnection;let failed=false;
  pool.getConnection=async function(){const c=await original.call(pool);return new Proxy(c,{get(target,key){if(key==='execute')return async(sql,params)=>{if(!failed&&sql.startsWith(prefix)){failed=true;const e=new Error('test only');e.code='TEST_WRITE_FAILED';throw e;}return target.execute(sql,params);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});};
  try{await assert.rejects(work(),{code:'TEST_WRITE_FAILED'});assert.ok(failed);}finally{pool.getConnection=original;}
 }
 try{
  const adminName=`manager_${suffix}`,env={...process.env,BOOTSTRAP_ADMIN_USERNAME:adminName,BOOTSTRAP_ADMIN_EMAIL:`${adminName}@example.invalid`,BOOTSTRAP_ADMIN_PASSWORD:password};
  const created=await createInitialAdmin(env);
  if(!created){const [a]=await pool.execute("INSERT INTO users (username,email,password_hash,role) VALUES (?,?,?,'admin')",[adminName,env.BOOTSTRAP_ADMIN_EMAIL,await bcrypt.hash(password,12)]);adminId=a.insertId;}
  else{const [[a]]=await pool.execute('SELECT id FROM users WHERE username=?',[adminName]);adminId=a.id;}
  users.push(adminId);
  for(const name of ['buyer','other']){const username=`${name}_${suffix}`;const [u]=await pool.execute('INSERT INTO users (username,email,password_hash) VALUES (?,?,?)',[username,`${username}@example.invalid`,await bcrypt.hash(password,12)]);users.push(u.insertId);}
  // 顾客放在首位供下单帮助函数使用，管理员 ID 始终单独保存。
  users.splice(0,1);users.push(adminId);
  alice=await createClient(base,`buyer_${suffix}`,password,sessions);bob=await createClient(base,`other_${suffix}`,password,sessions);staff=await createClient(base,adminName,password,sessions);
  const [cat]=await pool.execute("INSERT INTO categories (slug,name) VALUES (?,'业务测试分类')",[`business-${suffix}`]);categoryId=cat.insertId;body.categoryId=String(categoryId);
  await t.test('管理员初始化有哈希且重复执行不会覆盖账号',async()=>{
   assert.equal(await createInitialAdmin({...env,BOOTSTRAP_ADMIN_USERNAME:`unused_${suffix}`}),false);
   const [[a]]=await pool.execute('SELECT password_hash,role FROM users WHERE id=?',[adminId]);assert.equal(a.role,'admin');assert.notEqual(a.password_hash,password);assert.ok(await bcrypt.compare(password,a.password_hash));
  });
  await t.test('后台所有页面及写入均验证管理员身份',async()=>{
   const guest=await createClient(base);
   for(const path of ['/admin','/admin/products','/admin/products/new','/admin/orders','/admin/stats','/admin/stats/data']){assert.equal((await guest.request(path)).status,303);assert.equal((await alice.request(path)).status,403);assert.equal((await staff.request(path)).status,path==='/admin'?303:200);}
   assert.equal((await alice.post('/admin/products',{...body,role:'admin'})).status,403);
   assert.equal((await staff.request('/admin/products',body)).status,403);
  });
  await t.test('管理员创建商品、校验字段、唯一 SKU，真实前台可见',async()=>{
   assert.equal((await staff.post('/admin/products',{...body,price:'-1'})).status,422);
   assert.equal((await staff.post('/admin/products',body)).status,303);
   const [[p]]=await pool.execute('SELECT id FROM products WHERE sku=?',[body.sku]);products.push(p.id);
   assert.equal((await staff.post('/admin/products',body)).status,409);
   const second={...body,sku:`BUS-${suffix}-B`,name:'业务测试杯子',price:'0.20'};products.push(await admin.saveProduct(adminId,null,second));
   assert.equal((await alice.request(`/products/${products[0]}`)).status,200);
   assert.equal((await staff.post('/admin/products',{...body,sku:`BAD-${suffix}`,imagePath:'https://evil.invalid/a.png'})).status,422);
  });
  await t.test('库存发生变化时拒绝旧编辑表单，上下架立即影响前台',async()=>{
   const old=await version(products[0]);await addItem(users[0],products[0],1);await makeOrder(users[0],[[0,1]]);
   const current=(await stocks())[0];assert.equal((await staff.post(`/admin/products/${products[0]}`,{...body,stock:'5000',version:old})).status,409);assert.equal((await stocks())[0],current);
   const v=await version(products[0]);await admin.saveProduct(adminId,products[0],{...body,stock:String(current),status:'inactive'},v);
   assert.equal((await alice.request(`/products/${products[0]}`)).status,404);
   await admin.saveProduct(adminId,products[0],{...body,stock:String(current)},await version(products[0]));
  });
  await t.test('支付与取消入口要求登录、本人权限和 CSRF，GET 不改状态',async()=>{
   unpaidId=await makeOrder();const guest=await createClient(base);
   for(const action of ['pay','cancel']){assert.equal((await guest.request(`/orders/${unpaidId}/${action}`)).status,303);assert.equal((await bob.request(`/orders/${unpaidId}/${action}`)).status,404);assert.equal((await alice.request(`/orders/${unpaidId}/${action}`)).status,200);assert.equal((await alice.request(`/orders/${unpaidId}/${action}`,{outcome:'success',confirmCancel:'yes'})).status,403);}
   assert.equal(await payment(unpaidId),undefined);assert.equal((await bob.post(`/orders/${unpaidId}/pay`,{outcome:'success',userId:users[0]})).status,404);
   assert.equal((await alice.post(`/orders/${unpaidId}/pay`,{outcome:'unknown'})).status,422);assert.equal((await alice.post(`/orders/${unpaidId}/cancel`,{})).status,422);
  });
  await t.test('模拟支付按订单金额保存唯一记录，不二次扣库存，未配置邮件如实提示',async()=>{
   paidId=unpaidId;const before=await stocks();
   assert.equal((await alice.post(`/orders/${paidId}/pay`,{outcome:'success',amount:'0.01',method:'real',userId:users[1],orderStatus:'completed'})).status,303);
   const p=await payment(paidId),o=await getOwnOrder(users[0],paidId);paidNo=o.orderNo;
   assert.equal(p.amount,'25.28');assert.equal(p.method,'simulated');assert.equal(p.status,'succeeded');assert.ok(p.paid_at);assert.equal(o.orderStatus,'confirmed');assert.equal(o.paymentStatus,'paid');assert.equal(o.emailStatus,'skipped');assert.deepEqual(await stocks(),before);
   const page=await alice.request(`/orders/${paidId}`);assert.ok(page.body.includes('尚未验证发送'));assert.ok(page.body.includes('未发生真实')||page.body.includes('不涉及真实'));
  });
  await t.test('重复支付并发请求幂等，已支付订单不能退回取消',async()=>{
   const original=await payment(paidId),before=await stocks();const replies=await Promise.all(Array.from({length:3},()=>alice.post(`/orders/${paidId}/pay`,{outcome:'success'})));assert.ok(replies.every(r=>r.status===303));
   const current=await payment(paidId);assert.equal(current.id,original.id);assert.equal(current.paid_at,original.paid_at);assert.equal((await alice.post(`/orders/${paidId}/pay`,{outcome:'cancel'})).status,409);assert.equal((await alice.post(`/orders/${paidId}/cancel`,{confirmCancel:'yes'})).status,409);assert.deepEqual(await stocks(),before);
  });
  await t.test('取消本次支付保留订单和库存，重试复用同一支付记录',async()=>{
   const id=await makeOrder(),before=await stocks();await alice.post(`/orders/${id}/pay`,{outcome:'cancel'});
   const first=await payment(id);assert.equal(first.status,'cancelled');assert.equal((await getOwnOrder(users[0],id)).paymentStatus,'unpaid');assert.deepEqual(await stocks(),before);
   await alice.post(`/orders/${id}/pay`,{outcome:'success'});const second=await payment(id);assert.equal(first.id,second.id);assert.equal(second.status,'succeeded');assert.deepEqual(await stocks(),before);
  });
  await t.test('取消订单一次恢复所有库存，重复取消及已取消订单支付都安全',async()=>{
   const before=await stocks(),id=await makeOrder();assert.equal((await alice.post(`/orders/${id}/cancel`,{confirmCancel:'yes'})).status,303);assert.deepEqual(await stocks(),before);
   const replies=await Promise.all([alice.post(`/orders/${id}/cancel`,{confirmCancel:'yes'}),alice.post(`/orders/${id}/cancel`,{confirmCancel:'yes'})]);assert.ok(replies.every(r=>r.status===303));assert.deepEqual(await stocks(),before);assert.equal((await alice.post(`/orders/${id}/pay`,{outcome:'success'})).status,409);assert.equal((await getOwnOrder(users[0],id)).orderStatus,'cancelled');
  });
  await t.test('支付与取消同时提交只允许一个状态生效',async()=>{
   const before=await stocks(),id=await makeOrder(),held=await stocks();const replies=await Promise.all([alice.post(`/orders/${id}/pay`,{outcome:'success'}),alice.post(`/orders/${id}/cancel`,{confirmCancel:'yes'})]);assert.deepEqual(replies.map(r=>r.status).sort(),[303,409]);const o=await getOwnOrder(users[0],id);assert.deepEqual(await stocks(),o.paymentStatus==='paid'?held:before);assert.equal(o.payment.status,o.paymentStatus==='paid'?'succeeded':'cancelled');
  });
  await t.test('支付或恢复库存的中途写入故障会整体回滚',async()=>{
   let id=await makeOrder(),before=await stocks();await failOnce("UPDATE orders SET order_status = 'confirmed'",()=>simulatePayment(users[0],id,'success'));assert.equal(await payment(id),undefined);assert.equal((await getOwnOrder(users[0],id)).paymentStatus,'unpaid');assert.deepEqual(await stocks(),before);
   await failOnce("UPDATE orders SET order_status = 'cancelled'",()=>cancelOrder(users[0],id));assert.equal(await payment(id),undefined);assert.deepEqual(await stocks(),before);assert.equal((await getOwnOrder(users[0],id)).orderStatus,'pending');await cancelOrder(users[0],id);
  });
  await t.test('后台状态只能按已支付确认→发货→完成推进，不能伪造支付',async()=>{
   const unpaid=await makeOrder();assert.equal((await staff.post(`/admin/orders/${unpaid}/status`,{nextStatus:'shipped',expectedStatus:'pending',paymentStatus:'paid'})).status,409);
   assert.equal((await staff.post(`/admin/orders/${paidId}/status`,{nextStatus:'completed',expectedStatus:'confirmed'})).status,409);
   assert.equal((await staff.post(`/admin/orders/${paidId}/status`,{nextStatus:'paid',expectedStatus:'confirmed'})).status,422);
   for(const [expectedStatus,nextStatus]of [['confirmed','shipped'],['shipped','completed']])assert.equal((await staff.post(`/admin/orders/${paidId}/status`,{expectedStatus,nextStatus})).status,303);
   assert.equal((await getOwnOrder(users[0],paidId)).orderStatus,'completed');assert.equal((await staff.post(`/admin/orders/${paidId}/status`,{nextStatus:'shipped',expectedStatus:'completed'})).status,409);
   assert.equal((await alice.request(`/admin/orders/${paidId}`)).status,403);assert.equal((await staff.request(`/admin/orders/${paidId}`)).status,200);
  });
  await t.test('销售统计排除未支付和取消订单，金额、日期和销量可核对',async()=>{
   const range={start:'2050-03-01',end:'2050-03-01'},baseline=await admin.salesStats(adminId,range),ids=[];
   ids.push(await makeOrder());await simulatePayment(users[0],ids[0],'success');ids.push(await makeOrder(users[0],[[0,1]]));await simulatePayment(users[0],ids[1],'success');ids.push(await makeOrder());ids.push(await makeOrder());await cancelOrder(users[0],ids[3]);
   for(let i=0;i<ids.length;i++)await pool.execute("UPDATE orders SET created_at='2050-03-01 10:00:00',paid_at=CASE WHEN payment_status='paid' THEN '2050-03-01 23:59:59' ELSE NULL END WHERE id=?",[ids[i]]);
   const s=await admin.salesStats(adminId,range);assert.equal(s.orderCount,baseline.orderCount+4);assert.equal(s.paidCount,baseline.paidCount+2);assert.equal(s.salesAmount,formatCents(toCents(baseline.salesAmount)+3762n));
   assert.equal(Number(s.products.find(p=>p.productId===products[0]).quantity),3);assert.equal(s.products.find(p=>p.productId===products[0]).revenue,'37.02');assert.deepEqual(s.labels,['2050-03-01']);
   const data=await staff.request('/admin/stats/data?start=2050-03-01&end=2050-03-01');assert.equal(data.status,200);assert.equal(JSON.parse(data.body).salesAmount,s.salesAmount);
   assert.equal((await staff.request('/admin/stats?start=2050-02-30&end=2050-03-01')).status,422);assert.equal((await staff.request('/admin/stats?start=2090-01-01&end=2090-01-01')).status,200);
  });
  await t.test('全部订单历史可分页和筛选，参数注入不扩大结果集，返回保留条件',async()=>{
   for(let i=0;i<21;i++)await makeOrder(users[0],[[1,1]]);
   const first=await getOrders(users[0],{status:'unpaid',q:'SG',page:1}),second=await getOrders(users[0],{status:'unpaid',q:'SG',page:2});assert.equal(first.orders.length,10);assert.equal(second.orders.length,10);assert.equal(new Set([...first.orders,...second.orders].map(o=>o.id)).size,20);
   const last=await getOrders(users[0],{page:999});assert.ok(last.pagination.wasAdjusted);assert.ok(last.orders.some(o=>o.id===paidId));
   for(const q of ["' OR 1=1 --",'%','_'])assert.equal((await getOrders(users[0],{q})).pagination.total,0);
   const id=second.orders[0].id,url=`/orders/${id}?q=SG&status=unpaid&page=2`;const detail=await alice.request(url);assert.equal(detail.status,200);assert.ok(detail.body.includes('status=unpaid&amp;page=2'));assert.ok((await alice.request('/orders?q=%3Cscript%3E')).body.includes('&lt;script&gt;'));
   assert.equal((await bob.request(`/orders/${id}`)).status,404);assert.equal((await getOrders(users[1],{q:paidNo})).pagination.total,0);assert.ok(!(await bob.request(`/orders?q=${paidNo}`)).body.includes(`href="/orders/${paidId}`));
  });
  await t.test('邮件内容经 Nodemailer 本地生成；发送失败与重试不影响支付',async()=>{
   const id=await makeOrder();await simulatePayment(users[0],id,'success');const [[raw]]=await pool.execute('SELECT o.*,u.email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?',[id]);const [items]=await pool.execute('SELECT * FROM order_items WHERE order_id=?',[id]);
   const json=await nodemailer.createTransport({jsonTransport:true}).sendMail(confirmationMessage(raw,items,'course@example.invalid'));assert.ok(JSON.parse(json.message).text.includes('25.28'));
   const before=await stocks();const result=await deliverOrderEmail(users[0],id,{env:{},transport:{sendMail:async()=>{throw new Error('PRIVATE_TEST_DETAIL');}}});assert.equal(result,'failed');assert.equal((await getOwnOrder(users[0],id)).paymentStatus,'paid');assert.deepEqual(await stocks(),before);
   const [[state]]=await pool.execute('SELECT * FROM order_emails WHERE order_id=?',[id]);assert.equal(state.last_error,'SMTP_SEND_FAILED');assert.equal(state.attempts,1);
   let calls=0;const transport={sendMail:async()=>{calls++;return {accepted:[raw.email]};}};assert.equal(await deliverOrderEmail(users[0],id,{transport,env:{}}),'deferred');assert.equal(calls,0);
   await pool.execute('UPDATE order_emails SET updated_at=DATE_SUB(NOW(),INTERVAL 120 SECOND) WHERE order_id=?',[id]);await Promise.all([deliverOrderEmail(users[0],id,{transport,env:{}}),deliverOrderEmail(users[0],id,{transport,env:{}})]);assert.equal(calls,1);assert.equal((await getOwnOrder(users[0],id)).emailStatus,'sent');
   await deliverOrderEmail(users[0],id,{transport,env:{}});assert.equal(calls,1);assert.equal(await deliverOrderEmail(users[1],id,{transport,env:{}}),'unavailable');assert.equal((await bob.post(`/orders/${id}/email`)).status,404);
  });
  await t.test('邮件重试有上限，新进程仍能识别已支付订单而不重复扣库存',async()=>{
   const id=await makeOrder();await simulatePayment(users[0],id,'success');await pool.execute("UPDATE order_emails SET status='failed',attempts=5,updated_at=DATE_SUB(NOW(),INTERVAL 120 SECOND) WHERE order_id=?",[id]);let calls=0;
   assert.equal(await deliverOrderEmail(users[0],id,{env:{},transport:{sendMail:async()=>{calls++;return {accepted:[]};}}}),'deferred');assert.equal(calls,0);
   const before=await stocks(),original=await payment(paidId);
   const script="const {simulatePayment}=require('./services/paymentService');const {getOwnOrder}=require('./services/orderService');const {closePool}=require('./config/db');(async()=>{const result=await simulatePayment(Number(process.env.TEST_USER),Number(process.env.TEST_ORDER),'success');const o=await getOwnOrder(Number(process.env.TEST_USER),Number(process.env.TEST_ORDER));console.log(JSON.stringify({result,status:o.paymentStatus,payment:o.payment.paymentNo}))})().catch(()=>process.exitCode=1).finally(closePool)";
   const child=spawnSync(process.execPath,['-e',script],{cwd:require('node:path').join(__dirname,'..'),env:{...process.env,TEST_USER:String(users[0]),TEST_ORDER:String(paidId)},encoding:'utf8',timeout:15000});assert.equal(child.status,0);assert.deepEqual(JSON.parse(child.stdout.trim()),{result:'already_paid',status:'paid',payment:original.payment_no});assert.deepEqual(await stocks(),before);
  });
  await t.test('软删除保留订单快照，取消仍恢复库存且不会重新上架',async()=>{
   const id=await makeOrder(),p=await admin.getProduct(adminId,products[0]);assert.equal((await staff.post(`/admin/products/${p.id}/delete`,{version:p.version})).status,422);assert.equal((await staff.post(`/admin/products/${p.id}/delete`,{version:p.version,confirmDelete:'yes'})).status,303);assert.equal((await alice.request(`/products/${p.id}`)).status,404);assert.equal((await getOwnOrder(users[0],id)).items[0].name,body.name);
   const before=(await stocks())[0];await cancelOrder(users[0],id);const after=await admin.getProduct(adminId,p.id);assert.equal(after.stock,before+2);assert.equal(after.status,'deleted');assert.ok(after.deleted_at);
  });
  await t.test('管理员角色撤销后现有会话立即失去后台权限',async()=>{
   try{await pool.execute("UPDATE users SET role='customer' WHERE id=?",[adminId]);assert.equal((await staff.request('/admin/stats')).status,403);await assert.rejects(admin.listProducts(adminId),{status:403});}finally{await pool.execute("UPDATE users SET role='admin' WHERE id=?",[adminId]);}
  });
  await t.test('关键路由与 EJS 在游客、顾客、管理员及空数据场景正常渲染',async()=>{
   const guest=await createClient(base);
   const pages=[
    [guest,'/',200],[guest,'/products?q=NO_MATCH_AUDIT',200],[guest,'/login',200],[guest,'/register',200],
    [alice,'/account',200],[alice,'/cart',200],[alice,'/checkout',200],[alice,'/orders?status=invalid',200],
    [alice,`/orders/${paidId}`,200],[alice,`/orders/${paidId}/pay`,303],[alice,'/orders/4294967295',404],
    [staff,'/admin/products/new',200],[staff,`/admin/products/${products[1]}/edit`,200],[staff,`/admin/products/${products[1]}/delete`,200],
    [staff,'/admin/products?q=NO_MATCH_AUDIT',200],[staff,'/admin/orders?q=NO_MATCH_AUDIT',200],[staff,`/admin/orders/${paidId}`,200],
    [staff,'/admin/stats?start=2090-01-01&end=2090-01-01',200],
    [alice,'/ADMIN/PRODUCTS',403],[guest,'/admin/stats/data',303]
   ];
   for(const [client,path,status]of pages){const response=await client.request(path);assert.equal(response.status,status,path);assert.ok(!/ReferenceError|Failed to lookup view|SyntaxError/.test(response.body),path);}
   for(const path of [`/admin/products/${products[1]}`,`/admin/products/${products[1]}/delete`,`/admin/orders/${paidId}/status`]){
    assert.equal((await staff.request(path,{confirmDelete:'yes',nextStatus:'completed'})).status,403,path);
    assert.equal((await alice.post(path,{})).status,403,path);
   }
  });
  await t.test('异常数据库消息不进入响应或日志',async()=>{
   const execute=pool.execute,log=console.error,logs=[];
   const secret='AUDIT_PRIVATE_DB_DETAIL',sqlMarker='AUDIT_PRIVATE_SQL';
   pool.execute=async function(sql,params){if(sql.startsWith('SELECT COUNT(*) AS total FROM products')){const error=new Error(secret);error.code='ER_PARSE_ERROR';error.sql=sqlMarker;throw error;}return execute.call(pool,sql,params);};
   console.error=(...args)=>logs.push(args.join(' '));
   try{const response=await alice.request('/products');assert.equal(response.status,503);for(const value of [secret,sqlMarker,process.cwd()]){assert.ok(!response.body.includes(value));assert.ok(!logs.join('\n').includes(value));}assert.ok(logs.length);}
   finally{pool.execute=execute;console.error=log;}
  });
  await t.test('历史异常邮箱在发送前被拒绝，不调用邮件传输',async()=>{
   const id=await makeOrder(users[1],[[1,1]]);await simulatePayment(users[1],id,'success');
   const [[user]]=await pool.execute('SELECT email FROM users WHERE id=?',[users[1]]);let calls=0;
   try{
    await pool.execute('UPDATE users SET email=? WHERE id=?',[`Name<${user.email}>`,users[1]]);
    assert.equal(await deliverOrderEmail(users[1],id,{env:{},transport:{sendMail:async()=>{calls++;}}}),'failed');assert.equal(calls,0);
    const [[state]]=await pool.execute('SELECT last_error,attempts FROM order_emails WHERE order_id=?',[id]);assert.equal(state.last_error,'RECIPIENT_INVALID');assert.equal(state.attempts,0);assert.equal((await getOwnOrder(users[1],id)).paymentStatus,'paid');
   }finally{await pool.execute('UPDATE users SET email=? WHERE id=?',[user.email,users[1]]);}
  });
 }finally{
  for(const id of sessions)await pool.execute('DELETE FROM sessions WHERE session_id=?',[id]);
  for(const id of users){await pool.execute('DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE user_id=?)',[id]);await pool.execute('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id=?)',[id]);await pool.execute('DELETE FROM orders WHERE user_id=?',[id]);await pool.execute('DELETE FROM cart_items WHERE user_id=?',[id]);await pool.execute('DELETE FROM users WHERE id=?',[id]);}
  if(categoryId){await pool.execute('DELETE FROM products WHERE category_id=?',[categoryId]);await pool.execute('DELETE FROM categories WHERE id=?',[categoryId]);}
 }
};
