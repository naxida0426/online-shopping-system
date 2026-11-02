# 拾光商城

基于 Node.js、Express、EJS 和 MySQL 的在线购物系统，包含顾客购物流程、商品与订单管理、销售统计及订单确认邮件。页面以中文为主，支持桌面和移动设备。

支付为课程模拟，不接入真实支付平台。

## 功能

| 模块 | 功能 |
| --- | --- |
| 商品浏览 | 分类、关键词搜索、分页、商品详情、快速预览 |
| 用户账户 | 注册、用户名或邮箱登录、退出、账户信息、持久会话 |
| 购物车 | 添加、修改数量、删除、库存检查、金额计算 |
| 订单 | 收货信息、订单快照、事务扣库存、重复提交防护、历史查询 |
| 模拟支付 | 模拟付款、取消本次支付、取消未支付订单并恢复库存 |
| 超时关闭 | 默认 30 分钟支付期限、倒计时、自动关闭与库存回补 |
| 地址簿 | 地址增删改、默认地址、结算选择与自动填充 |
| 管理后台 | 商品新增、编辑、上下架、软删除，订单发货与完成 |
| 销售统计 | 日期筛选、已支付销售额、商品销量、图表 |
| 确认邮件 | SMTP 发送、任务状态、失败提示、限次重试 |

## 技术栈

- 服务端：Node.js、Express 5、EJS
- 数据库：MySQL 8、mysql2、InnoDB 事务
- 前端：Bootstrap 5、原生 JavaScript、Chart.js
- 账户：express-session、MySQL 会话存储、bcryptjs、CSRF 校验、登录限流
- 邮件：Nodemailer

## 安装与运行

运行环境：Node.js 20+、npm、MySQL 8.0.19+。

### Windows 便携环境

```powershell
npm install
npm run mysql:setup
npm start
```

访问 [http://localhost:3000](http://localhost:3000)。

`mysql:setup` 下载并配置 MySQL 8.4.13，创建运行库、测试库及示例商品，将数据库凭据和会话密钥写入 `.env`。默认数据库端口为 3307，端口冲突时自动选择空闲端口。

后续启动：

```powershell
npm run mysql:start
npm start
```

按 Ctrl+C 停止网站，使用 `npm run mysql:stop` 关闭数据库。数据库文件位于 `.local/mysql-data`。

### 已有 MySQL

首次配置时将 `.env.example` 复制为 `.env`，填写数据库连接信息。运行账号需要项目库的读写权限；初始化使用单独账号时，设置 `DB_INIT_USER` 和 `DB_INIT_PASSWORD`。

```powershell
npm install
npm run session:setup
npm run db:init
npm run db:check
npm start
```

初始化创建 10 张表、4 个分类和 6 件示例商品，不创建默认用户或管理员。详见 [数据库配置](docs/database.md)。

### 版本更新

停止网站后执行：

```powershell
npm install
npm run db:init
npm run db:check
npm start
```

`db:init` 可重复执行，保留已有商品、账户和订单数据，并补齐地址簿表、订单截止时间、关闭原因及索引。初始化账号需要 ALTER 权限。旧待支付订单按“创建时间 + 30 分钟”设置截止时间，网站重启后自动关闭已超时订单并恢复库存。

## 环境变量

配置项见 [.env.example](.env.example)。`.env`、`.local`、`node_modules` 和数据库备份不纳入版本控制。

| 配置 | 说明 |
| --- | --- |
| `PORT` | 网站端口，默认 3000 |
| `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD` | 数据库连接 |
| `DB_INIT_USER`、`DB_INIT_PASSWORD` | 可选的数据库初始化账号 |
| `DB_TEST_NAME` | 独立测试库，名称以 `_test` 结尾，且与运行库不同 |
| `SESSION_SECRET` | 至少 32 字节的会话密钥，可用 `npm run session:setup` 生成 |
| `NODE_ENV` | 本地使用 `development`，生产环境使用 `production` |
| `TRUST_PROXY` | 默认 0；部署在受信任的一层反向代理后时设为 1 |
| `BOOTSTRAP_ADMIN_*` | 首位管理员的用户名、邮箱和密码 |
| `ORDER_PAYMENT_TIMEOUT_SECONDS` | 新订单支付期限，默认 1800 秒，范围 1–86400 |
| `MAIL_ENABLED`、`SMTP_*` | 邮件开关和 SMTP 配置 |

生产环境的会话 Cookie 使用 Secure，需要 HTTPS。环境变量修改后须重启网站。

## 使用说明

### 顾客

1. 注册账户并登录，浏览或搜索商品。
2. 将商品加入购物车，调整数量后进入结算。
3. 选择已保存地址或填写收货信息，提交订单。
4. 在支付期限内完成模拟支付，或取消未支付订单。
5. 在“我的账户 → 我的订单”查询订单状态和历史记录。

加入购物车不预留库存，提交订单时扣减库存。订单金额由后端计算，商品名称、价格和收货信息保存为订单快照。

待支付订单默认保留 30 分钟，后台每 15 秒扫描一批超时订单，每批最多 100 笔。服务停止期间任务暂停，重启后补关。支付和取消操作也会检查截止时间，库存只恢复一次。详见 [订单与支付](docs/orders.md)。

“我的账户 → 收货地址簿”支持保存最多 20 个地址。默认地址自动填入结算页，可切换或临时修改；地址簿的后续修改不影响历史订单。详见 [订单超时与地址簿](docs/bonus-features.md)。

### 管理后台

在 `.env` 中设置 `BOOTSTRAP_ADMIN_USERNAME`、`BOOTSTRAP_ADMIN_EMAIL` 和 `BOOTSTRAP_ADMIN_PASSWORD`，执行：

```powershell
npm run admin:create
```

管理员密码至少 12 个字符。脚本只创建首位管理员，已有管理员时不覆盖账号。创建后可移除初始化密码配置。

登录后通过账户页或 `/admin` 进入后台：

- `/admin/products`：管理商品；图片使用 `public/images` 下的本地文件。
- `/admin/orders`：查询订单，将已支付订单依次标记为已发货、已完成。
- `/admin/stats`：按日期查看销售额、订单数量和商品销量。

销售额和销量按支付日期统计，不计入未支付或已取消订单。详见 [后台与统计](docs/admin.md)。

### 订单确认邮件

邮件默认关闭。配置 `SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM`，设置 `MAIL_ENABLED=true` 并重启网站。

```powershell
npm run mail:check
```

此命令检查 SMTP 连接与认证；实际投递通过收件箱确认。发送失败不影响订单和支付，可在订单详情重试，间隔 60 秒、最多 5 次。详见 [邮件配置](docs/mail.md)。

## 测试

```powershell
npm run db:check
npm test
```

数据库集成测试使用 `DB_TEST_NAME` 指定的独立测试库；未配置时跳过相关用例。测试关闭外部邮件发送，结束后清理测试数据。

测试覆盖账户权限、购物车、订单事务、并发库存、重复支付、超时关闭、地址隔离、订单快照、后台管理、销售统计和邮件失败重试。

## 目录

```text
app.js          应用入口
config/         环境变量、数据库、会话及事务配置
routes/         账户、商品、购物车、地址、订单与后台路由
services/       业务逻辑
middleware/     登录与角色验证
utils/          参数校验与通用方法
views/          EJS 页面
public/         样式、脚本与图片
sql/            表结构与示例数据
scripts/        数据库初始化、升级及配置检查
tests/         单元测试与集成测试
docs/          模块说明
```

## 当前限制

- 尚未完成公网部署及服务器环境验收。
- 支付仅为模拟，暂不支持真实付款和退款。
- 邮件不支持自动重试、退信处理和邮箱所有权验证。
- 暂不支持密码找回、顾客自主注销及商品图片上传。
- 登录限流保存在单个进程中，多实例部署需要共享存储。
