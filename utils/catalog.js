function normalizePage(value) {
  const text = String(value ?? "1");
  const page = /^\d+$/.test(text) ? Number(text) : 1;
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function readBrowseOptions(input = {}) {
  return {
    query: typeof input.q === "string" ? input.q.trim().slice(0, 100) : "",
    category: typeof input.category === "string" && /^[a-zA-Z0-9_-]{1,50}$/.test(input.category) ? input.category : "all",
    page: Array.isArray(input.page) ? 1 : normalizePage(input.page)
  };
}

function browseParams({ query = "", category = "all", page = 1 } = {}) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (category !== "all") params.set("category", category);
  if (normalizePage(page) > 1) params.set("page", String(normalizePage(page)));
  return params.size ? `?${params}` : "";
}

function catalogUrl(query = "", category = "all", page = 1) {
  return `/products${browseParams({ query, category, page })}#products`;
}

function productUrl(id, query = "", category = "all", page = 1) {
  return `/products/${encodeURIComponent(id)}${browseParams({ query, category, page })}`;
}

function isValidProductId(value) {
  return /^[1-9]\d{0,9}$/.test(String(value)) && Number(value) <= 4294967295;
}

function paginationItems(page, totalPages) {
  // 大量页码时只显示首尾页与当前页附近，避免生成巨大导航。
  const selected = new Set([1, totalPages]);
  for (let current = Math.max(1, page - 2); current <= Math.min(totalPages, page + 2); current++) selected.add(current);
  const numbers = [...selected].sort((a, b) => a - b);
  const items = [];
  numbers.forEach((number, index) => {
    if (index && number - numbers[index - 1] > 1) items.push(null);
    items.push(number);
  });
  return items;
}

module.exports = { normalizePage, readBrowseOptions, catalogUrl, productUrl, isValidProductId, paginationItems };
