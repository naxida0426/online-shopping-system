const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const admin = require('../services/adminService');

module.exports = async function verifyProductUploads(t, { pool, base, staff, alice, adminId, body }) {
  const prefix = `UPLOAD-${randomUUID().slice(0,8)}`;
  const directory = path.join(__dirname, '..', 'public', 'images');
  const before = new Set(await fs.readdir(directory));
  const jpeg = await fs.readFile(path.join(directory, 'electronics-keyboard.jpg'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
  let productId, originalImage;
  function form(fields = {}, image = jpeg, filename = '本地商品.jpg', type = 'image/jpeg') {
    const data = new FormData();
    for (const [key, value] of Object.entries({ ...body, sku: prefix, ...fields })) {
      if (key !== 'imagePath') data.set(key, value);
    }
    if (image) data.set('productImage', new Blob([image], { type }), filename);
    return data;
  }
  const files = async () => (await fs.readdir(directory)).filter(name => name.startsWith('product-upload-') && !before.has(name)).sort();
  try {
    await t.test('商品表单提供本地文件选择，移除地址输入和课程示例选项', async () => {
      const page = await staff.request('/admin/products/new');
      assert.equal(page.status, 200);
      assert.match(page.body, /enctype="multipart\/form-data"/);
      assert.match(page.body, /type="file"[^>]+name="productImage"/);
      assert.doesNotMatch(page.body, /name="(?:isDemo|imagePath)"|标记为课程示例商品|本地图片地址/);
    });
    await t.test('本地图片随商品上传，前台真实可访问，新增不带课程示例标记', async () => {
      assert.equal((await staff.post('/admin/products', form({ isDemo: '1' }))).status, 303);
      const [[row]] = await pool.execute('SELECT id,image_path,is_demo FROM products WHERE sku=?', [prefix]);
      productId = row.id; originalImage = row.image_path;
      assert.equal(row.is_demo, 0);
      assert.match(row.image_path, /^\/images\/product-upload-[a-f0-9-]{36}\.jpg$/);
      assert.deepEqual(Buffer.from(await (await fetch(base + row.image_path)).arrayBuffer()), jpeg);
      const page = await alice.request(`/products/${productId}`);
      assert.equal(page.status, 200);
      assert.ok(page.body.includes(row.image_path));
    });
    await t.test('编辑不选择新图会保留原图，既有示例标记不会被无关编辑更改', async () => {
      await pool.execute('UPDATE products SET is_demo=1 WHERE id=?', [productId]);
      const current = await admin.getProduct(adminId, productId);
      assert.equal((await staff.post(`/admin/products/${productId}`, form({ version: current.version, name: '更新后的商品' }, null))).status, 303);
      const saved = await admin.getProduct(adminId, productId);
      assert.equal(saved.imagePath, originalImage);
      assert.equal(saved.name, '更新后的商品');
      assert.equal(saved.isDemo, true);
    });
    await t.test('编辑上传新图会替换展示图片，原图仍然可访问', async () => {
      const current = await admin.getProduct(adminId, productId);
      assert.equal((await staff.post(`/admin/products/${productId}`, form({ version: current.version }, png, '换图.png', 'image/png'))).status, 303);
      const saved = await admin.getProduct(adminId, productId);
      assert.notEqual(saved.imagePath, originalImage);
      assert.ok(saved.imagePath.endsWith('.png'));
      assert.equal((await fetch(base + originalImage)).status, 200);
      assert.deepEqual(await fs.readFile(path.join(directory, path.basename(saved.imagePath))), png);
    });
    await t.test('上传必须有管理员权限和有效 CSRF，拒绝超大、伪装及多图文件', async () => {
      const existing = await files();
      assert.equal((await alice.post('/admin/products', form())).status, 403);
      assert.equal((await staff.post('/admin/products', form({ _csrf: 'bad' }))).status, 403);
      assert.equal((await staff.post('/admin/products', form({}, null))).status, 422);
      assert.equal((await staff.post('/admin/products', form({}, Buffer.from('<svg onload="alert(1)"></svg>'), 'fake.jpg'))).status, 422);
      assert.equal((await staff.post('/admin/products', form({}, Buffer.alloc(5 * 1024 * 1024 + 1)))).status, 422);
      const multiple = form(); multiple.append('productImage', new Blob([jpeg], { type: 'image/jpeg' }), 'other.jpg');
      assert.equal((await staff.post('/admin/products', multiple)).status, 422);
      assert.deepEqual(await files(), existing);
    });
    await t.test('字段校验、重复 SKU 或并发版本冲突会清理本次上传并保留原商品', async () => {
      const existing = await files();
      const invalid = await staff.post('/admin/products', form({ sku: prefix + '-BAD', price: '-1' }));
      assert.equal(invalid.status, 422);
      assert.ok(invalid.body.includes('新图片尚未保存，请重新选择'));
      assert.equal((await staff.post('/admin/products', form())).status, 409);
      const current = await admin.getProduct(adminId, productId);
      assert.equal((await staff.post(`/admin/products/${productId}`, form({ version: 'stale' }))).status, 409);
      assert.equal((await admin.getProduct(adminId, productId)).imagePath, current.imagePath);
      assert.deepEqual(await files(), existing);
    });
  } finally {
    await pool.execute('DELETE FROM products WHERE sku LIKE ?', [prefix + '%']);
    for (const filename of await files()) await fs.unlink(path.join(directory, filename));
  }
};
