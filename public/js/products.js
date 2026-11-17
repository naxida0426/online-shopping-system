// Existing EJS responses are the source of truth; no new API or business rules.
function prepareProductImages(root = document) {
  root.querySelectorAll('img[data-product-image]').forEach(image => {
    if (image.dataset.fallbackReady) return;
    image.dataset.fallbackReady = 'true';
    const fallback = () => { if (image.getAttribute('src') !== '/images/product-placeholder.svg') image.src = '/images/product-placeholder.svg'; };
    image.addEventListener('error', fallback);
    if (image.complete && !image.naturalWidth) fallback();
  });
}
prepareProductImages();
(() => {
  const results = document.getElementById('products');
  const grid = document.querySelector('[data-product-grid]');
  if (!results || !grid) return;
  const categories = document.querySelector('.category-list');
  const status = results.querySelector('[data-catalog-status]');
  const search = document.getElementById('site-search');
  const sort = document.getElementById('price-sort');
  let selected = new URL(location.href).searchParams.get('category') || 'all';
  let keyword = search.value;
  let ready = false;
  let loadPromise;
  const originals = new Map();
  grid.querySelectorAll('[data-product-id]').forEach(card => originals.set(card.dataset.productId,card));
  function apply() {
    const term = keyword.trim().toLocaleLowerCase();
    const cards = [...originals.values()];
    if (sort.value !== 'default') cards.sort((a,b) => (Number(a.dataset.price) - Number(b.dataset.price)) * (sort.value === 'asc' ? 1 : -1));
    let count = 0;
    cards.forEach(card => {
      const show = (selected === 'all' || card.dataset.categoryId === selected) && (!term || card.dataset.search.toLocaleLowerCase().includes(term));
      card.hidden = !show; if (show) count++; grid.append(card);
      const updateLink = link => {
        const url = new URL(link.href); url.search = '';
        if (keyword.trim()) url.searchParams.set('q',keyword.trim());
        if (selected !== 'all') url.searchParams.set('category',selected);
        link.href = url.pathname + url.search;
      };
      card.querySelectorAll('a[href^="/products/"]').forEach(updateLink);
      document.getElementById('product-'+card.dataset.productId)?.querySelectorAll('a[href^="/products/"]').forEach(updateLink);
    });
    categories.querySelectorAll('[data-category]').forEach(link => { const active = link.dataset.category === selected; link.classList.toggle('is-active', active); if (active) link.setAttribute('aria-current','true'); else link.removeAttribute('aria-current'); });
    results.querySelector('[data-catalog-empty]').hidden = count > 0;
    status.hidden = true;
    status.replaceChildren();
    results.querySelector('[data-catalog-count]').textContent = `${count} 件`;
    search.value = keyword;
  }
  function saveUrl() {
    const url = new URL(location.href); url.search = ''; if (keyword.trim()) url.searchParams.set('q', keyword.trim()); if (selected !== 'all') url.searchParams.set('category', selected); if (sort.value !== 'default') url.searchParams.set('sort', sort.value); history.replaceState(null, '', url);
  }
  async function loadAll() {
    if (ready) return true;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      results.setAttribute('aria-busy', 'true');
      status.hidden = true;
      try {
        const fresh = new Map(); const previews = new Map(); let pages = 1;
        for (let page = 1; page <= pages; page++) {
          const response = await fetch(`/products?page=${page}`, {headers:{Accept:'text/html'}});
          if (!response.ok) throw new Error('加载失败');
          const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
          const nextGrid = doc.querySelector('[data-product-grid]');
          if (!nextGrid) throw new Error('商品响应无效');
          pages = Number(nextGrid.dataset.pages);
          if (!Number.isSafeInteger(pages) || pages < 1) throw new Error('分页信息无效');
          nextGrid.querySelectorAll('[data-product-id]').forEach(card => fresh.set(card.dataset.productId, document.importNode(card,true)));
          doc.querySelectorAll('[data-previews]>.modal').forEach(modal => previews.set(modal.id, document.importNode(modal,true)));
        }
        originals.clear(); fresh.forEach((card,id) => originals.set(id,card));
        grid.replaceChildren(...fresh.values());
        results.querySelector('[data-previews]').replaceChildren(...previews.values());
        results.querySelector('.catalog-pagination')?.setAttribute('hidden','');
        ready = true; grid.dataset.catalogReady = 'true'; prepareProductImages(results); apply(); return true;
      } catch {
        status.hidden = false;
        status.replaceChildren(document.createTextNode('完整仓库加载失败，仍可使用原有分页和搜索。 '));
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'text-action'; retry.textContent = '重试加载'; retry.addEventListener('click',loadAll); status.append(retry); return false;
      } finally { results.removeAttribute('aria-busy'); loadPromise = null; }
    })();
    return loadPromise;
  }
  document.addEventListener('click', async event => {
    const link = event.target.closest('[data-category],[data-header-category]');
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); if (!await loadAll()) { location.href = link.href; return; }
    selected = link.dataset.category || link.dataset.headerCategory; apply(); saveUrl();
    categories.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  });
  document.querySelectorAll('form[role=search]').forEach(form => {
    form.addEventListener('submit', event => { if (!ready) return; event.preventDefault(); keyword = form.querySelector('[name=q]').value; apply(); saveUrl(); });
    const input = form.querySelector('[name=q]'); let delay;
    input.addEventListener('input', () => { if (!ready) return; clearTimeout(delay); delay = setTimeout(() => { keyword = input.value; apply(); saveUrl(); },160); });
  });
  sort.addEventListener('change',async () => { if (await loadAll()) { apply(); saveUrl(); } });
  const initialSort = new URL(location.href).searchParams.get('sort'); if (['asc','desc'].includes(initialSort)) sort.value = initialSort;
  window.addEventListener('popstate', () => { const params = new URL(location.href).searchParams; selected = params.get('category') || 'all'; keyword = params.get('q') || ''; sort.value = ['asc','desc'].includes(params.get('sort')) ? params.get('sort') : 'default'; if (ready) apply(); });
  loadAll();
})();
