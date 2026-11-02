(() => {
  const element = document.querySelector("[data-order-countdown]");
  if (!element) return;
  const remaining = Number(element.dataset.remaining);
  if (!Number.isFinite(remaining)) return;
  const end = performance.now() + remaining * 1000;
  const label = element.querySelector("[data-countdown-text]");
  let timer;
  function update() {
    const seconds = Math.max(0, Math.ceil((end - performance.now()) / 1000));
    label.textContent = `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
    if (seconds === 0) {
      clearInterval(timer);
      document.querySelectorAll('form[action*="/pay"] button').forEach(button => { button.disabled = true; });
      element.setAttribute("role", "status");
      element.replaceChildren(document.createTextNode("支付时间已到，请刷新查看订单关闭结果。"));
      const link = document.createElement("a");
      link.href = window.location.pathname.replace(/\/(pay|cancel)\/?$/, "") + window.location.search;
      link.textContent = "刷新订单状态";
      link.className = "ms-2";
      element.append(link);
    }
  }
  timer = setInterval(update, 1000);
  update();
})();
