# 电子产品目录与购物袋抽屉

目录现有 12 件不同电子商品，四个分类各 3 件。原有六件商品为机械键盘、无线鼠标、头戴耳机、蓝牙音箱、智能腕表和微单相机；新增播客麦克风、轻薄笔记本电脑、真无线耳机、VR 头显、航拍无人机和变焦镜头。名称、描述、价格、分类和图片统一来自数据库记录；没有在模板中覆盖商品信息。商品编号 ID、当前库存、收藏和购物车关联保持不变，历史订单使用原有快照。

分类为声音实验室、桌面美学、潮流穿戴、影像实验室，保留已有分类 slug，因此原分类链接依然有效。

## 数据部署

已有环境已执行更新。在新环境先照常初始化数据库，然后执行：

```powershell
node scripts/apply-electronics-catalog.js
```

脚本读取 `data/electronics-catalog.json`，在事务内更新六件原始示例商品并插入六件新增商品，并在 `.local/catalog-backups/` 保存执行前的商品与分类备份。脚本支持重复执行，不覆盖当前库存，不修改表结构或业务路由。原始 SQL 种子保持兼容；仅初始化 SQL 时需要额外执行此内容更新脚本。

商品名称中的 VIBE 型号为课程展示编号，售价为模拟售价；真实摄影图用于外观展示，不代表照片品牌的授权销售或真实规格。

## 摄影素材

商品摄影图均已下载并逐张视觉检查。下列原有六张图片，保存在 `public/images/`。页面加载本地 JPG，无需运行时请求外部图片服务。

| 本地文件 | 原始照片 |
| --- | --- |
| electronics-keyboard.jpg | [蓝色机械键盘，Aleksandr Eremin / Unsplash](https://unsplash.com/photos/a-blue-keyboard-sitting-on-top-of-a-white-table-l2j_4LHyIro) |
| electronics-mouse.jpg | [无线鼠标 / Unsplash](https://images.unsplash.com/photo-1527814050087-3793815479db) |
| electronics-headphones.jpg | [头戴耳机 / Unsplash](https://images.unsplash.com/photo-1546435770-a3e426bf472b) |
| electronics-speaker.jpg | [蓝牙音箱 / Unsplash](https://images.unsplash.com/photo-1608043152269-423dbba4e7e1) |
| electronics-watch.jpg | [智能腕表 / Unsplash](https://images.unsplash.com/photo-1546868871-7041f2a55e12) |
| electronics-camera.jpg | [微单相机 / Unsplash](https://images.unsplash.com/photo-1516035069371-29a1b244cc32) |

素材使用条款见 [Unsplash License](https://unsplash.com/license)。

## 购物袋抽屉

- 点击导航购物袋在当前页右侧打开，背景遮罩、关闭按钮、Esc、键盘焦点限制及焦点恢复均已接入。
- 登录后加购自动打开抽屉，数量、删除、库存校验、合计使用已有 `/cart` 和 POST 表单路由，保留 CSRF 字段。
- 抽屉底部固定显示合计与结算入口，中间商品列表可独立滚动。保留完整购物车链接作为普通导航和无脚本回退。
- 未登录显示登录入口；空购物袋、失效商品、网络错误均有明确状态。
- 不显示运费进度或说明，合计直接使用后端商品金额。

## 验证

137 项现有测试通过，42 个 EJS 模板编译通过。Chrome 独立测试库验收覆盖抽屉加购、加减数量、删除、角标同步、Esc 关闭、手机布局及抽屉进入结算后的下单与模拟支付。临时测试账号、商品和订单已清理。

## 扩充到 12 件

已有六件电子商品的环境执行 `node scripts/expand-electronics-catalog.js`，只补充缺失的新商品，不更新原商品或分类。重复执行不会重复插入，也不会重置价格、库存或上架状态。四个分类的名称、slug、排序均保持不变，各包含三件商品。

新增图片同样使用本地摄影 JPG：

| 文件 | 来源 |
| --- | --- |
| electronics-microphone.jpg | [播客麦克风 / Unsplash](https://images.unsplash.com/photo-1590602847861-f357a9332bbc) |
| electronics-laptop.jpg | [笔记本电脑 / Unsplash](https://images.unsplash.com/photo-1496181133206-80ce9b88a853) |
| electronics-earbuds.jpg | [真无线耳机 / Unsplash](https://images.unsplash.com/photo-1606220945770-b5b6c2c55bf1) |
| electronics-vr.jpg | [VR 头显 / Unsplash](https://images.unsplash.com/photo-1622979135225-d2ba269cf1ac) |
| electronics-drone.jpg | [无人机 / Unsplash](https://images.unsplash.com/photo-1473968512647-3e447244af8f) |
| electronics-lens.jpg | [变焦镜头 / Unsplash](https://images.unsplash.com/photo-1617005082133-548c4dd27f35) |

商品区重复搜索框已移除，仅保留顶部搜索。浏览器验证覆盖全部 12 件商品的跨页加载、四分类筛选、顶部搜索、价格排序、图片加载及 1440/390/320px 布局；同时对比更新前数据，确认原有六件商品和全部分类记录未发生变化。
