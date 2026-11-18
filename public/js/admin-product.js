(() => {
  const upload = document.querySelector('[data-product-image-upload]');
  if (!upload) return;
  const input = upload.querySelector('input[type="file"]');
  const preview = upload.querySelector('[data-image-preview]');
  const feedback = upload.querySelector('[data-image-feedback]');
  const original = preview.getAttribute('src');
  let previewUrl;

  function resetPreview() {
    preview.onload = preview.onerror = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
    preview.src = original;
  }
  function reject(message) {
    resetPreview();
    input.value = '';
    input.setCustomValidity(message);
    feedback.textContent = message;
    feedback.classList.add('is-error');
  }
  input.addEventListener('change', () => {
    resetPreview();
    input.setCustomValidity('');
    feedback.textContent = '';
    feedback.classList.remove('is-error');
    const file = input.files[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      reject('请选择 JPG、PNG 或 WebP 图片。');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      reject('图片不能超过 5 MB，请重新选择。');
      return;
    }
    previewUrl = URL.createObjectURL(file);
    preview.onerror = () => reject('图片无法读取，请重新选择。');
    preview.src = previewUrl;
    feedback.textContent = '已选择图片，保存商品后上传。';
  });
  window.addEventListener('pagehide', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });
})();
