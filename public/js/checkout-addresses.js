(() => {
  const select = document.getElementById("saved-address");
  if (!select) return;
  select.addEventListener("change", () => {
    const option = select.selectedOptions[0];
    const custom = !option.value;
    document.getElementById("recipient-name").value = custom ? "" : option.dataset.name;
    document.getElementById("recipient-phone").value = custom ? "" : option.dataset.phone;
    document.getElementById("recipient-address").value = custom ? "" : option.dataset.address;
  });
})();
