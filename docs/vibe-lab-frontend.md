# VIBE LAB 前端重构

全部 EJS 模板（含新增共享组件）已接入统一的暖米白、点阵、黑色粗框与硬阴影设计系统。旧 `/css/style.css` 不再加载；新样式为 `/css/vibe-lab.css`。Bootstrap 保留布局和弹窗运行时，Tailwind CDN 按要求引入并关闭 preflight，避免覆盖现有表单基础样式。

## 交互

- 首页从全部在售、有库存商品中随机选择主推，全部商品仍使用 EJS 循环输出。
- 目录通过已有 `GET /products?page=N` 逐页同步全部在售商品，支持实时关键词、分类和全量价格排序；失败保留原分页、GET 搜索及重试按钮。
- 商品卡片和详情支持图片背景配色预览。数据库没有商品颜色/规格变体，因此不伪造可下单规格，预览不会改变提交数据。
- 购物车入口打开侧拉购物袋抽屉，保留数量更新、删除、失效库存提示和结算限制，并提供完整购物车页面回退。
- 首页闪购成功加购后随机切换另一件商品，后端核算八折价格；旧购物袋优惠保留至当日零点结束。
- 盲盒兑换码由后端生成，每天可领取一张 ¥50–100 的兑换码，在支付页实际抵扣金额。完整规则及数据库部署见 `promotions.md`。
- 购物车、结算和购物袋抽屉仅展示商品金额，不展示运费提示或进度。
- 订单详情为热敏回执视觉，完整保留支付倒计时、取消、收货、评价入口及 SMTP 状态和重试。
- 账户、注册登录、注销、地址簿、收藏、评价、商品管理、订单管理和销售统计统一样式。

## 保留的表单契约

原有表单路径与字段继续保留；新增兑换码发行及应用接口，并扩展订单金额计算。详见 `promotions.md`。

| 用途 | POST 路径 | 主要字段 |
| --- | --- | --- |
| 登录 | `/login` | `_csrf`, `next`, `identifier`, `password` |
| 注册 | `/register` | `_csrf`, `next`, `username`, `email`, `password`, `confirmPassword` |
| 退出 | `/logout` | `_csrf` |
| 加购 | `/cart/items` | `_csrf`, `productId`, `quantity` |
| 数量 | `/cart/items/:id/quantity` | `_csrf`, `quantity` |
| 移除 | `/cart/items/:id/delete` | `_csrf` |
| 下单 | `/orders` | `_csrf`, `checkoutToken`, `recipientName`, `recipientPhone`, `recipientAddress` |
| 模拟支付 | `/orders/:id/pay`（保留浏览参数） | `_csrf`, `outcome=success/cancel` |
| 邮件重试 | `/orders/:id/email`（保留浏览参数） | `_csrf` |

## 验证记录

- `npm test`：137 项全部通过，包括真实独立 MySQL 测试库、认证、库存、订单、模拟支付、邮件内容与重试、地址簿、收藏、评价和后台权限。
- 41 个 EJS 模板全部编译通过。
- Chrome 浏览器检查：实时搜索、分类、排序、弹窗、配色、抽券、无横向溢出的响应式布局。
- 独立测试库浏览器流程：创建临时第 7 件商品，验证跨两页加载和全量排序；登录、加购、数量更新、结算、演示码验证、模拟支付及回执 SMTP 状态全部通过。测试结束删除临时账号、商品和订单，并恢复对应库存。
- 浏览器验收关闭外发邮件，未向真实收件人发信。真实 SMTP 投递保持现有配置与逻辑，本次未执行外发验证。

运行：`npm start`，访问 `http://localhost:3000`。
