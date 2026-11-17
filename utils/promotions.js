const {toCents,formatCents}=require('./money');
function flashPrice(price) {return formatCents((toCents(price)*80n+50n)/100n);}
function couponDiscount(total,face) {const a=toCents(total),b=toCents(face);return formatCents(a<b?a:b);}
function promotionDay(date=new Date()) {return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
module.exports={flashPrice,couponDiscount,promotionDay};
