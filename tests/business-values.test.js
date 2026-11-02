const test=require('node:test'),assert=require('node:assert/strict');
const {productInput,dateRange}=require('../utils/admin');
const {readOrderOptions,orderUrl,orderListUrl}=require('../utils/orders');
const {smtpOptions,confirmationMessage}=require('../services/mailService');
test('商品金额、库存、图片与状态校验拒绝无效输入',()=>{
 const valid={sku:'TEST-1',name:'测试商品',categoryId:'1',description:'商品说明',price:'12.3',stock:'5',imagePath:'/images/lamp.svg',status:'active',tag:'示例',color:'sand'};
 assert.deepEqual(productInput(valid).errors,[]);assert.equal(productInput(valid).values.price,'12.30');
 for(const change of [{price:'-1'},{price:'1e2'},{stock:'1.5'},{stock:'4294967296'},{imagePath:'https://evil.invalid/a.svg'},{imagePath:'/images/../../.env'},{status:'deleted'},{categoryId:['1']}])assert.ok(productInput({...valid,...change}).errors.length);
});
test('统计日期范围与订单查询拒绝数组、无效日期和超长区间',()=>{
 for(const value of [{start:'2050-02-30',end:'2050-03-01'},{start:'2051-01-01',end:'2050-01-01'},{start:'2050-01-01',end:'2052-01-01'},{start:['2050-01-01']}])assert.throws(()=>dateRange(value));
 assert.deepEqual(dateRange({start:'2050-03-01',end:'2050-03-01'}),{start:'2050-03-01',end:'2050-03-01'});
 assert.equal(readOrderOptions({page:['2'],status:'constructor'}).page,1);assert.equal(readOrderOptions({status:'constructor'}).status,'all');
 const options={query:'SG<test>',status:'unpaid',page:2};assert.ok(orderUrl(1,options,'pay').startsWith('/orders/1/pay?q=SG%3Ctest%3E'));assert.ok(orderListUrl(options).includes('page=2'));
});
test('邮件配置默认关闭，不接收非法发信地址或宽松 TLS 配置',()=>{
 assert.equal(smtpOptions({}),null);
 assert.throws(()=>smtpOptions({MAIL_ENABLED:'true',SMTP_HOST:'smtp.example.invalid',SMTP_PORT:'587'}));
 const o=smtpOptions({MAIL_ENABLED:'true',SMTP_HOST:'smtp.example.invalid',SMTP_PORT:'587',SMTP_USER:'test',SMTP_PASSWORD:'private',SMTP_FROM:'test@example.invalid'});
 assert.equal(o.requireTLS,true);assert.equal(o.disableUrlAccess,true);
 for(const SMTP_FROM of ['Name<test@example.invalid>','test@example.invalid,','test@-example.invalid'])assert.throws(()=>smtpOptions({MAIL_ENABLED:'true',SMTP_HOST:'smtp.example.invalid',SMTP_PORT:'465',SMTP_USER:'test',SMTP_PASSWORD:'private',SMTP_FROM}));
 const m=confirmationMessage({id:1,order_no:'SG1',total_amount:'12.34',email:'to@example.invalid'},[{product_name:'台灯',quantity:1,subtotal:'12.34'}],'test@example.invalid');
 assert.ok(m.subject.includes('模拟支付'));assert.ok(m.text.includes('未发生真实资金扣款'));assert.ok(!m.text.includes('private'));
});
