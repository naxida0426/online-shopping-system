document.addEventListener("submit", async event => {
  const form = event.target.closest("form.favorite-form");
  if (!form || location.pathname.startsWith("/account/favorites")) return;
  event.preventDefault();
  const button = form.querySelector("button");
  if (button.disabled) return;
  button.disabled = true;
  const error = form.querySelector("[data-favorite-error]");
  error.textContent = "";
  try {
    const response = await fetch(form.getAttribute("action"), { method: "POST", headers: { Accept: "application/json" }, body: new URLSearchParams(new FormData(form)) });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("收藏未更新，请刷新页面后重试。");
    const result = await response.json();
    document.querySelectorAll(`form[data-favorite-id="${form.dataset.favoriteId}"]`).forEach(target => {
      target.querySelector('input[name="action"]').value = result.isFavorite ? "remove" : "add";
      const control = target.querySelector("button");
      control.setAttribute("aria-pressed", String(result.isFavorite));
      control.setAttribute("aria-label", result.isFavorite ? "取消收藏" : "收藏");
      control.querySelector("[aria-hidden]").textContent = result.isFavorite ? "♥" : "♡";
      control.querySelector("[data-favorite-label]").textContent = result.isFavorite ? "已收藏" : "收藏";
    });
  } catch (failure) { error.textContent = failure.message; }
  finally { button.disabled = false; }
});
