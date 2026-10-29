const express=require("express");
const admin=require("../services/adminService");
const {OrderError}=require("../services/orderService");
const {productInput}=require("../utils/admin");
const {requireAdmin}=require("../middleware/auth");
const {verifyCsrf}=require("../utils/auth");
const router=express.Router();
router.use(requireAdmin);
router.use((req,res,next)=>{
  res.locals.activePage="admin";res.locals.query="";
  res.locals.adminPage=req.path.startsWith("/products")?"products":req.path.startsWith("/orders")?"orders":"stats";
  res.locals.orderLabels={pending:"待确认",confirmed:"已确认",shipped:"已发货",completed:"已完成",cancelled:"已取消"};
  res.locals.paymentLabels={unpaid:"未支付",paid:"已支付",cancelled:"已取消",refunded:"已退款"};
  res.locals.adminPageUrl=(base,options,page)=>{const p=new URLSearchParams();if(options.query)p.set("q",options.query);if(options.status!=="all")p.set("status",options.status);if(page>1)p.set("page",page);return `${base}${p.size?`?${p}`:""}`;};
  next();
});
router.get("/",(req,res)=>res.redirect(303,"/admin/stats"));
router.get("/products",async(req,res)=>res.render("admin/products",{title:"商品管理 · 拾光商城",...await admin.listProducts(req.user.id,req.query)}));
async function productForm(req,res,id,{status=200,errorMessage="",values}={}){
  const stored=id?await admin.getProduct(req.user.id,id):{sku:"",name:"",categoryId:"",description:"",price:"0.00",stock:0,imagePath:"/images/product-placeholder.svg",status:"inactive",tag:"精选好物",color:"sand",isDemo:false,version:""};
  if(stored.status==="deleted")throw new OrderError("商品已软删除，不能直接编辑。",404);
  res.status(status).render("admin/product-form",{title:`${id?"编辑":"新增"}商品 · 拾光商城`,id,values:values||stored,version:status===422&&id?req.body.version:stored.version,categories:await admin.categories(req.user.id),errorMessage});
}
router.get("/products/new",(req,res)=>productForm(req,res,null));
router.get("/products/:id/edit",(req,res)=>productForm(req,res,req.params.id));
function save(idFromReq){return async(req,res,next)=>{
  const id=idFromReq?req.params.id:null;
  try{await admin.saveProduct(req.user.id,id,req.body,req.body.version);res.redirect(303,"/admin/products");}
  catch(error){if(error instanceof OrderError && [422,409].includes(error.status))return productForm(req,res,id,{status:error.status,errorMessage:error.message,values:error.status===409&&id?undefined:productInput(req.body).values});next(error);}
};}
router.post("/products",verifyCsrf,save(false));
router.post("/products/:id",verifyCsrf,save(true));
router.get("/products/:id/delete",async(req,res)=>res.render("admin/product-delete",{title:"确认软删除 · 拾光商城",product:await admin.getProduct(req.user.id,req.params.id)}));
router.post("/products/:id/delete",verifyCsrf,async(req,res)=>{
  if(req.body.confirmDelete!=="yes")throw new OrderError("请在确认页面提交软删除。",422);
  await admin.deleteProduct(req.user.id,req.params.id,req.body.version);res.redirect(303,"/admin/products");
});
router.get("/orders",async(req,res)=>res.render("admin/orders",{title:"订单管理 · 拾光商城",...await admin.listOrders(req.user.id,req.query)}));
router.get("/orders/:id",async(req,res)=>res.render("admin/order",{title:"后台订单详情 · 拾光商城",order:await admin.adminOrder(req.user.id,req.params.id)}));
router.post("/orders/:id/status",verifyCsrf,async(req,res)=>{await admin.advanceOrder(req.user.id,req.params.id,req.body.nextStatus,req.body.expectedStatus);res.redirect(303,`/admin/orders/${encodeURIComponent(req.params.id)}`);});
router.get("/stats",async(req,res)=>res.render("admin/stats",{title:"销售统计 · 拾光商城",stats:await admin.salesStats(req.user.id,req.query)}));
router.get("/stats/data",async(req,res)=>res.json(await admin.salesStats(req.user.id,req.query)));
router.use((error,req,res,next)=>{
  if(!(error instanceof OrderError))return next(error);
  res.status(error.status).render("message",{title:"管理操作未完成",icon:"info",message:"管理操作未完成",description:error.message,activePage:"admin",query:"",actionUrl:"/admin",actionLabel:"返回管理后台"});
});
module.exports=router;
