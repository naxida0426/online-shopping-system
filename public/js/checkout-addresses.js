(() => {
  const select = document.getElementById("saved-address");
  if (!select) return;
  const form = select.closest("form");
  const token = form.elements.checkoutToken.value;
  const draftKey = `checkout-address:${token}`;
  const fields = ["recipientName", "recipientPhone", "recipientAddress"];
  if (token && new URLSearchParams(location.search).get("from") === "addresses") {
    try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey));
      sessionStorage.removeItem(draftKey);
      if (draft && fields.every(field => typeof draft[field] === "string")) {
        fields.forEach(field => { form.elements[field].value = draft[field]; });
        select.value = Array.from(select.options).some(option => option.value === draft.selected) ? draft.selected : "";
      }
    } catch { /* 浏览器禁用存储时仍可正常选择地址。 */ }
  }
  document.getElementById("manage-addresses")?.addEventListener("click", () => {
    if (!token) return;
    try {
      const draft = Object.fromEntries(fields.map(field => [field, form.elements[field].value]));
      draft.selected = select.value;
      sessionStorage.setItem(draftKey, JSON.stringify(draft));
    } catch { /* 不影响地址簿导航。 */ }
  });
  select.addEventListener("change", () => {
    const option = select.selectedOptions[0];
    const custom = !option.value;
    document.getElementById("recipient-name").value = custom ? "" : option.dataset.name;
    document.getElementById("recipient-phone").value = custom ? "" : option.dataset.phone;
    document.getElementById("recipient-address").value = custom ? "" : option.dataset.address;
  });
})();
