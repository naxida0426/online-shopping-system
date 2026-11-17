const router=require('express').Router();
const{requireAuth}=require('../middleware/auth');
const{verifyCsrf}=require('../utils/auth');
const{issueCode,getFlashOffer}=require('../services/promotionService');
router.get('/flash',async(req,res)=>{
  res.set('Cache-Control','no-store');
  res.render('partials/flash-card',{flashOffer:await getFlashOffer()});
});
router.post('/codes',requireAuth,verifyCsrf,async(req,res)=>{
  res.set('Cache-Control','no-store');const coupon=await issueCode(req.user.id);
  if(req.get('Accept')?.includes('application/json'))return res.json(coupon);
  res.redirect(303,'/');
});
module.exports=router;
