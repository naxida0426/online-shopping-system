// 图片文件丢失时显示通用占位图，不用其他商品的图片冒充。
document.querySelectorAll("img[data-product-image]").forEach(image => {
  const fallback = () => {
    if (image.getAttribute("src") !== "/images/product-placeholder.svg") image.src = "/images/product-placeholder.svg";
  };
  image.addEventListener("error", fallback);
  // defer 脚本执行前可能已经发生图片加载失败。
  if (image.complete && image.naturalWidth === 0) fallback();
});
