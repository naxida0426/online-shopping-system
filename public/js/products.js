// 图片文件丢失时显示通用占位图，不用其他商品的图片冒充。
function prepareProductImages(root = document) {
  root.querySelectorAll("img[data-product-image]").forEach(image => {
    const fallback = () => {
      if (image.getAttribute("src") !== "/images/product-placeholder.svg") image.src = "/images/product-placeholder.svg";
    };
    image.addEventListener("error", fallback);
    // defer 脚本执行前可能已经发生图片加载失败。
    if (image.complete && image.naturalWidth === 0) fallback();
  });
}
prepareProductImages();

(() => {
  const categories = document.querySelector('.category-list');
  const results = document.getElementById('products');
  if (!categories || !results) return;

  let pending;
  let revision = 0;
  const previousRestoration = history.scrollRestoration;
  history.scrollRestoration = 'manual';
  window.addEventListener('pagehide', () => { history.scrollRestoration = previousRestoration; });
  window.addEventListener('pageshow', () => { history.scrollRestoration = 'manual'; });

  async function filterProducts(url, push = true) {
    const currentRevision = ++revision;
    pending?.abort();
    pending = new AbortController();
    results.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(url, { signal: pending.signal, headers: { Accept: 'text/html' } });
      if (!response.ok) throw new Error('Catalog unavailable');
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      const nextResults = page.getElementById('products');
      const nextCategories = page.querySelector('.category-list');
      if (!nextResults || !nextCategories) throw new Error('Invalid catalog response');
      if (currentRevision !== revision) return;

      // 保留视口所需的文档高度，并关闭 DOM 替换时的浏览器滚动锚定。
      const root = document.documentElement;
      root.style.overflowAnchor = 'none';
      const reservedHeight = Math.max(0, window.scrollY + window.innerHeight - (root.scrollHeight - results.getBoundingClientRect().height));
      results.style.minHeight = `${reservedHeight}px`;
      results.replaceChildren(...nextResults.childNodes);
      categories.querySelectorAll('a').forEach(link => {
        const target = new URL(link.href);
        const selected = [...nextCategories.querySelectorAll('a')].some(next =>
          next.hasAttribute('aria-current') && new URL(next.getAttribute('href'), url).search === target.search);
        link.classList.toggle('is-active', selected);
        if (selected) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
      const selectedLink = nextCategories.querySelector('a[aria-current]');
      const category = selectedLink && new URL(selectedLink.getAttribute('href'), url).searchParams.get('category');
      document.querySelectorAll('form[role="search"]').forEach(form => {
        let input = form.querySelector('input[name="category"]');
        if (!category) { input?.remove(); return; }
        if (!input) {
          input = document.createElement('input');
          input.type = 'hidden';
          input.name = 'category';
          form.append(input);
        }
        input.value = category;
      });
      prepareProductImages(results);
      if (push) history.pushState(null, '', url);
    } catch (error) {
      if (error.name === 'AbortError' || currentRevision !== revision) return;
      const notice = results.querySelector('.demo-notice');
      if (notice) {
        notice.textContent = '商品筛选暂时失败，请重新点击分类重试。';
        notice.setAttribute('role', 'alert');
      }
    } finally {
      if (currentRevision === revision) results.removeAttribute('aria-busy');
    }
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
        link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || !['/', '/products', '/products/'].includes(url.pathname)) return;
    if (!categories.contains(link) && !results.contains(link)) return;
    event.preventDefault();
    url.hash = '';
    // 首页筛选保留首页结构；刷新和前进后退也使用同一路径。
    url.pathname = location.pathname;
    filterProducts(url);
  });
  window.addEventListener('popstate', () => filterProducts(new URL(location.href), false));
})();
