(() => {
  const toast = document.getElementById('lab-toast');
  let toastTimer;
  const tell = message => { if (!toast) return; toast.textContent = message; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4000); };
  let code='';
  const drawForm=document.querySelector('[data-draw-coupon-form]');
  drawForm?.addEventListener('submit',async event=>{
    event.preventDefault();const button=drawForm.querySelector('button');if(button.disabled)return;button.disabled=true;
    const feedback=document.querySelector('[data-draw-feedback]');feedback.textContent='正在抽取…';
    try{
      const response=await fetch(drawForm.action,{method:'POST',headers:{Accept:'application/json'},body:new URLSearchParams(new FormData(drawForm))});
      if(response.redirected && new URL(response.url).pathname==='/login'){location.href='/login?next=%2F';return;}
      if(!response.ok || !response.headers.get('content-type')?.includes('application/json'))throw Error('抽取失败，请刷新后重试。');
      const coupon=await response.json();code=coupon.code;
      document.querySelector('[data-coupon-output]').textContent=code;
      document.querySelector('[data-copy-coupon]').disabled=false;
      feedback.textContent=coupon.redeemedAt?'今日兑换码已使用。':`已抽中 ¥${coupon.amount}，可在支付页抵扣。`;
      button.textContent='今日已领取';
      try{sessionStorage.setItem('vibe-demo-coupon',code);}catch{}
    }catch(error){feedback.textContent=error.message;button.disabled=false;}
  });
  document.querySelector('[data-copy-coupon]')?.addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(code);tell('兑换码已复制。');}catch{tell('请选中兑换码手动复制。');}
  });
  const coupon=document.getElementById('payment-coupon');
  if(coupon){try{const saved=sessionStorage.getItem('vibe-demo-coupon');if(/^VIBE-[A-F0-9]{20}$/.test(saved||''))coupon.value=saved;}catch{}}
  let featuredRequest;
  function refreshFeatured(){
    if(featuredRequest)return featuredRequest;
    const current=document.querySelector('.hero-product');
    if(!current?.dataset.featuredId)return Promise.resolve();
    current.setAttribute('aria-busy','true');
    featuredRequest=(async()=>{
      try{
        const response=await fetch('/promotions/featured?exclude='+encodeURIComponent(current.dataset.featuredId),{headers:{Accept:'text/html'},cache:'no-store'});
        if(!response.ok)throw Error('featured refresh failed');
        const doc=new DOMParser().parseFromString(await response.text(),'text/html'),next=doc.querySelector('.hero-product');
        if(!next)throw Error('invalid featured product');
        const node=document.importNode(next,true);current.replaceWith(node);prepareProductImages(node);
        try{if(node.dataset.featuredId)sessionStorage.setItem('vibe-featured-product',node.dataset.featuredId);}catch{}
      }finally{current.removeAttribute('aria-busy');featuredRequest=null;}
    })();
    return featuredRequest;
  }
  const initialFeatured=document.querySelector('.hero-product');
  if(initialFeatured?.dataset.featuredId){
    let previous;
    try{previous=sessionStorage.getItem('vibe-featured-product');}catch{}
    if(previous===initialFeatured.dataset.featuredId)refreshFeatured().catch(()=>tell('主推商品更新失败，请刷新页面重试。'));
    else{try{sessionStorage.setItem('vibe-featured-product',initialFeatured.dataset.featuredId);}catch{}}
  }
  function updateFlashClock(){
    const clock=document.querySelector('[data-flash-countdown]');if(!clock)return;
    const seconds=Math.max(0,Math.floor((Number(clock.dataset.expiresAt)-Date.now())/1000));
    clock.textContent=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
    if(seconds===0)document.querySelector('[data-flash-buy]')?.setAttribute('disabled','');
  }
  if(document.querySelector('.flash-card')){
    updateFlashClock();setInterval(updateFlashClock,1000);
    document.addEventListener('flash:refresh',async()=>{
      const featuredRefresh=refreshFeatured().catch(()=>tell('主推商品更新失败，请刷新页面重试。'));
      try{
        const response=await fetch('/promotions/flash',{headers:{Accept:'text/html'},cache:'no-store'});
        if(!response.ok)throw Error('refresh failed');
        const doc=new DOMParser().parseFromString(await response.text(),'text/html'),next=doc.querySelector('.flash-card');
        if(!next)throw Error('invalid flash card');
        document.querySelector('.flash-card')?.replaceWith(document.importNode(next,true));
        document.querySelector('[data-flash-refresh-error]')?.setAttribute('hidden','');
        updateFlashClock();
      }catch{
        const note=document.querySelector('[data-flash-refresh-error]');
        if(note){note.hidden=false;note.textContent='商品已加入购物袋，闪购更新失败，请刷新查看下一件商品。';}
      }finally{await featuredRefresh;}
    });
  }
  document.addEventListener('click', event => {
    const jump = event.target.closest('[data-scroll-products]');
    if (jump && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
      event.preventDefault(); document.getElementById('products')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}); return;
    }
    const button = event.target.closest('[data-preview-color]'); if (!button) return;
    const palette = button.closest('.preview-palette');
    const art = button.closest('.product-card,.modal-content,.detail-product')?.querySelector('.product-visual,.modal-product-image,.detail-art');
    if (!art) return;
    art.style.backgroundColor = button.dataset.previewColor;
    palette.querySelectorAll('button').forEach(control => { control.classList.toggle('selected', control === button); control.setAttribute('aria-pressed', String(control === button)); });
    palette.querySelector('[data-preview-label]').textContent = button.getAttribute('aria-label').replace('背景预览', '');
  });
})();
