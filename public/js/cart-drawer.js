(() => {
  const drawer=document.getElementById('cart-drawer');
  if(!drawer || typeof drawer.showModal!=='function')return;
  const content=drawer.querySelector('[data-drawer-content]');
  const checkout=drawer.querySelector('[data-drawer-summary]');
  let busy=false, opener;
  const prepare = doc => {
    if(!doc.querySelector('.cart-page'))throw Error('购物袋暂不可用，请打开完整购物车重试。');
    const fragment=document.createDocumentFragment();checkout.replaceChildren();checkout.hidden=true;
    for(const notice of doc.querySelectorAll('.cart-page>.alert'))fragment.append(document.importNode(notice,true));
    const items=doc.querySelector('.cart-items');
    if(items){
      const list=document.importNode(items,true);list.classList.add('drawer-items');
      list.querySelectorAll('.cart-quantity-form').forEach(form=>{
        const input=form.querySelector('[name=quantity]');
        const group=document.createElement('div');group.className='drawer-stepper';
        for(const [label,step] of [['−',-1],['+',1]]){
          const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.cartStep=String(step);button.setAttribute('aria-label',step>0?'增加数量':'减少数量');button.disabled=input.disabled || (step<0?Number(input.value)<=1:Number(input.value)>=Number(input.max));group.append(button);
        }
        group.insertBefore(input,group.lastChild);form.querySelector('label').classList.add('visually-hidden');form.prepend(group);
        // Keep the original explicit submit control as a keyboard/manual-entry fallback.
        form.querySelector('button[type=submit]').textContent='更新';
      });fragment.append(list);
      const summary=doc.querySelector('.cart-summary');if(summary){const node=document.importNode(summary,true);node.classList.add('drawer-summary');checkout.append(node);checkout.hidden=false;}
    } else {const empty=doc.querySelector('.cart-empty');if(empty)fragment.append(document.importNode(empty,true));}
    content.replaceChildren(fragment);
    content.querySelectorAll('[id]').forEach(node=>{
      const previous=node.id;node.id='drawer-'+previous;
      content.querySelectorAll('label[for]').forEach(label=>{if(label.htmlFor===previous)label.htmlFor=node.id;});
      content.querySelectorAll('[aria-labelledby]').forEach(target=>{if(target.getAttribute('aria-labelledby')===previous)target.setAttribute('aria-labelledby',node.id);});
    });prepareProductImages(content);
    const count=doc.querySelector('.cart-count')?.textContent || '0';
    document.querySelectorAll('.site-header .cart-count,[data-drawer-count]').forEach(node=>node.textContent=count);
    document.querySelectorAll('.site-header .cart-link').forEach(link=>link.setAttribute('aria-label',`购物袋，${count} 件商品`));
  };
  const show = () => {if(drawer.open)return;opener=document.activeElement;drawer.showModal();document.body.classList.add('cart-drawer-open');};
  const showError = message => {
    const alert=document.createElement('p');alert.className='alert alert-danger';alert.setAttribute('role','alert');alert.textContent=message;
    content.prepend(alert);
  };
  async function request(form) {
    if(busy)return;busy=true;content.setAttribute('aria-busy','true');
    const submit=form?.querySelector('button[type=submit]');const wasDisabled=submit?.disabled;if(submit)submit.disabled=true;
    try {
      const response=await fetch(form?form.action:'/cart',form?{method:'POST',headers:{Accept:'text/html'},body:new URLSearchParams(new FormData(form))}:{headers:{Accept:'text/html'}});
      const doc=new DOMParser().parseFromString(await response.text(),'text/html');
      if(new URL(response.url).pathname==='/login'){
        const section=document.createElement('section');section.className='empty-state';
        const title=document.createElement('h3');title.textContent='登录，装下你的灵感';
        const text=document.createElement('p');text.textContent='登录后可查看和同步购物袋。';
        const link=document.createElement('a');link.href='/login?next=%2Fcart';link.className='btn btn-brand';link.textContent='登录 / 注册 ↗';section.append(title,text,link);content.replaceChildren(section);checkout.replaceChildren();checkout.hidden=true;return;
      }
      prepare(doc);if(!response.ok && !doc.querySelector('.cart-page>.alert'))throw Error('操作未完成，请重试。');
      if((response.ok || response.status===409) && form?.elements.flashOfferId?.value)document.dispatchEvent(new CustomEvent('flash:refresh'));
    } catch(error){showError(error.message || '网络连接失败，请重试或打开完整购物车。');}
    finally {busy=false;content.setAttribute('aria-busy','false');if(submit?.isConnected)submit.disabled=wasDisabled;}
  }
  document.addEventListener('click',event=>{
    const link=event.target.closest('.site-header .cart-link');
    if(link && event.button===0 && !event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){event.preventDefault();show();request();}
    if(event.target.closest('[data-close-cart]'))drawer.close();
    const step=event.target.closest('[data-cart-step]');
    if(step && !busy){const form=step.closest('form'),input=form.elements.quantity;input.value=String(Math.min(Number(input.max),Math.max(1,Number(input.value)+Number(step.dataset.cartStep))));form.requestSubmit();}
  });
  document.addEventListener('submit',event=>{
    const form=event.target;
    if(!(form instanceof HTMLFormElement))return;
    const add=new URL(form.action).pathname==='/cart/items' && form.method.toLowerCase()==='post';
    if(!add && !drawer.contains(form))return;
    event.preventDefault();if(busy)return;show();request(form);
  });
  drawer.addEventListener('click',event=>{if(event.target!==drawer)return;const box=drawer.getBoundingClientRect();if(event.clientX<box.left || event.clientX>box.right)drawer.close();});
  drawer.addEventListener('close',()=>{document.body.classList.remove('cart-drawer-open');if(opener?.isConnected)opener.focus();});
  drawer.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const controls=[...drawer.querySelectorAll('a,button,input,select,textarea,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);
    const first=controls[0],last=controls.at(-1);if(!first)return;
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
})();
