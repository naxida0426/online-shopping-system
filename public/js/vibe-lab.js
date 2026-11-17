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
  const clock = document.querySelector('[data-flash-countdown]');
  if (clock) {
    const tick = () => { const now = new Date(); const end = Number(clock.dataset.expiresAt); const s = Math.max(0, Math.floor((end - now) / 1000)); if(s===0){document.querySelector('[data-flash-buy]')?.setAttribute('disabled','');} clock.textContent = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':'); };
    tick(); setInterval(tick, 1000);
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
