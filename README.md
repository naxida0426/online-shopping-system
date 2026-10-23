# 拾光商城 · 在线购物网站课程设计

基于 Node.js、Express、EJS、Bootstrap 5 和 MySQL 的中文在线商城，按两周规划逐步开发。

## 第 2 天的范围

- 新增 mysql2/promise 连接池，通过本机 .env 读取配置。
- 新增 7 张关系表及 4 个分类、6 件示例商品的初始化 SQL。
- 首页、搜索和分类改为读取 MySQL，沿用第 1 天的公共布局与本地 SVG 插画。
- 商品弹窗展示数据库中的价格与库存，示例记录明确标注，暂不支持购买。
- 数据库未配置、连接失败或未建表时明确返回 503，不自动使用内存假数据。
- 提供连接检查、Windows 便携环境命令，以及配置和真实数据库集成测试。

注册、登录、会话、独立商品详情页、购物车、订单、模拟支付、管理员和邮件仍未实现。数据库表是后续功能的基础，不能视为这些功能已经完成。当前未部署公网。

## Windows 快速启动（本项目的便携环境）

需要 Node.js、npm，以及 Windows 自带的 PowerShell 和 curl。数据库使用官方 MySQL 8.4.13 ZIP，不注册系统服务，不修改系统 PATH，仅监听本机 127.0.0.1。

首次安装在项目目录执行：

```powershell
npm install
npm run mysql:setup
npm run db:check
npm start
```

打开 http://localhost:3000。也可用 node app.js 启动网站，Ctrl+C 停止网站。

mysql:setup 首次会下载约 268 MB 的官方 ZIP 并校验、解压、初始化新数据目录，自动创建随机密码的数据库账号和独立测试库，最后创建业务表与示例数据。通常使用端口 3307，如被占用则选择 3308–3317 中的空闲端口，实际值写入 .env。下载需要联网，后续页面资源均从本地加载。

已经配置后，每次重启电脑只需：

```powershell
npm run mysql:start
npm run db:check
npm start
```

结束开发时，先在网站终端按 Ctrl+C，再执行：

```powershell
npm run mysql:stop
```

npm run mysql:status 查看数据库端口状态。启动和停止会保留 .local/mysql-data 中的数据。该便携环境不设置开机自动运行，也不是公网生产部署方案。

程序、数据库文件、运行记录与日志在 .local/；随机密码仅保存在本机 .env，两者已被 Git 忽略。不要删除 .local/mysql-data，否则会丢失本机数据。setup 发现已有数据目录时会停止重复初始化，不自动清库或重置密码。如果安装没有完成，请在本机查看 .local/mysql-error.log，不要公开上传整个目录或原始凭据。

数据库运行账号 shopping_app 只有该项目运行库和测试库的 SELECT、INSERT、UPDATE、DELETE 权限。DB_INIT_USER 和 DB_INIT_PASSWORD 是建表及本机停止命令所用的数据库管理账号，不是商城管理员账号；初始化不会创建任何网站用户或公开管理员密码。

官方包与安装说明：[MySQL Community Server](https://dev.mysql.com/downloads/mysql/8.4.html?os=3)、[Windows ZIP 安装说明](https://dev.mysql.com/doc/refman/8.4/en/windows-installation.html)。

## 使用自己已安装的 MySQL

支持 MySQL 8.0.19+，推荐 8.4 LTS。MySQL 是独立服务，安装 mysql2 这个 npm 包不会自动安装数据库服务器。

1. 启动本机 MySQL 服务。
2. 仅在 .env 不存在时复制示例，避免覆盖已有密码：

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

3. 在本机编辑 .env，填写 DB_HOST、DB_PORT、DB_NAME、DB_USER、DB_PASSWORD。DB_NAME 仅使用字母、数字和下划线且不以数字开头。密码包含空格或 # 时请用引号包裹；不要把密码发送到聊天或提交到 GitHub。
4. 若运行账号无建库、建表权限，额外填写 DB_INIT_USER 和 DB_INIT_PASSWORD，初始化命令会使用该账号。运行程序仍使用 DB_USER。
5. 执行 npm run db:init，由初始化账号创建所选数据库、业务表与种子数据。
6. 使用 MySQL Workbench 等客户端为运行账号授权。以下只是手动操作的占位示例，应在本机替换账号密码和库名：

```sql
CREATE USER 'shopping_app'@'127.0.0.1' IDENTIFIED BY '请替换为本机强密码';
GRANT SELECT, INSERT, UPDATE, DELETE ON online_shopping.* TO 'shopping_app'@'127.0.0.1';
```

7. 执行 npm run db:check，然后 node app.js。自装 MySQL 不需要运行 mysql:setup、mysql:start 或 mysql:stop。

SQL 脚本不内置具体库名，由初始化命令根据 .env 创建并选择数据库；也可以在 Workbench 中先选中自己的库，再执行 sql/init.sql。

端口冲突时，在 PowerShell 临时设置网站端口：

```powershell
$env:PORT = '3001'
node app.js
```

## 表结构与初始化行为

| 表 | 作用及主要约束 |
|---|---|
| users | 用户与角色，用户名、邮箱唯一，密码只允许业务代码写入哈希，支持停用和软删除 |
| categories | 分类，slug 唯一，支持排序和停用 |
| products | 商品，SKU 唯一，DECIMAL 金额、非负库存、分类外键、上下架及示例标记 |
| cart_items | 用户购物车，用户与商品组合唯一，数量 1–999 |
| orders | 收货信息、总金额，订单号及用户结算标识唯一，订单与支付状态分开 |
| order_items | 商品名称、单价快照，数量及小计约束，保留历史订单关系 |
| payments | 每个订单一条支付状态记录，唯一支付单号，仅支持 simulated 模拟支付类型 |

所有表使用 InnoDB、utf8mb4、主键、外键和必要索引。金额保持 DECIMAL 字符串，不转换成 JavaScript 浮点金额。商品、用户和订单的删除策略优先保留历史关系。

- npm run db:init 可重复执行，不包含 DROP 或 TRUNCATE，不覆盖已修改的商品价格、库存和状态。
- 种子数据放在事务中；MySQL 建表 DDL 有隐式提交，因此初始化中断后可能已有部分表，修复原因后可重试。
- CREATE TABLE IF NOT EXISTS 不会自动升级已有表结构，后续变更需要专门迁移，不能靠删除数据库解决。
- 下单事务、库存扣减、会话、支付状态转换和越权检查将在后续阶段实现；当前只有数据结构。
- 首页最多展示 12 件上架商品，只读取启用分类和未软删除商品。分页与独立详情页留到第 3 天。

## 验收与测试

```powershell
npm run db:check
npm test
```

npm test 总会运行配置校验和数据库未配置时的 HTTP 测试。若 .env 配置 DB_TEST_NAME，则额外运行真实 MySQL 集成测试：

- 测试库名称必须以 _test 结尾，并且与 DB_NAME 不同。
- 便携安装会准备 online_shopping_test 测试库和所需账号权限。
- 自装 MySQL 需要自行创建或授权测试库；初始化账号需建库建表权限，运行账号需测试库读写权限。
- 集成测试验证重复初始化不重置库存、外键和唯一约束、非法金额/数量、事务回滚、参数化查询、HTTP 页面和新 Node.js 进程读取持久化数据。
- 测试仅修改专用测试库，并恢复修改过的种子记录；没有测试库时会明确显示 SKIP，不能据此声称真实数据库测试通过。

人工验收：

1. 初始化后检查 7 张表、4 个分类和 6 件示例商品。
2. 首页显示“商品信息来自 MySQL”，预览台灯时显示数据库价格和库存。
3. 搜索“台灯”，或选择“居家生活”后搜索“杯”，确认搜索和组合筛选有效。
4. 在 Workbench 中修改一件示例商品价格或库存，刷新页面观察变化；重新执行 db:init 后修改应仍保留。
5. Ctrl+C 停止网站，再启动，确认商品仍然存在。正常停止并重启 MySQL 后重复检查。
6. 在本机停止数据库，首页应返回明确的数据库不可用说明，不出现演示商品兜底；重新启动后应恢复。
7. 访问 /health/db：连接且 7 张表齐全时 HTTP 200，否则 HTTP 503；接口不返回账号、密码、SQL 或原始错误堆栈。
8. 检查手机导航、商品弹窗及无结果提示；登录、注册、购物车仍显示待开发说明。
9. 提交前检查 git status，确保 .env、node_modules 和 .local 没有进入提交。

## 本机验收记录（2026-10-23）

- 官方 MySQL 8.4.13 ZIP 下载并校验，便携实例仅监听 127.0.0.1:3307。
- 7 张业务表、4 个分类、6 件示例商品初始化成功，运行账号与初始化账号分离。
- npm test 的 11 项测试全部通过，无跳过，包含真实独立 MySQL 测试库。
- 实际停止 MySQL 后，首页及 /health/db 返回 503，未出现内存商品兜底，CSS 仍可加载。
- 正常重启 MySQL 后，6 件商品的 SKU、价格和库存与停止前完全一致，首页及健康接口自动恢复 HTTP 200。
- 以上验证在本机进行，不代表公网部署或后续交易功能已完成。

## 目录说明

```text
app.js                       Express 入口、数据库首页和错误处理
config/environment.js        读取项目根目录 .env
config/database-config.js    数据库配置校验
config/db.js                 连接池、健康检查和安全错误提示
services/catalogService.js   参数化商品与分类查询
sql/init.sql                 7 张表及示例数据（唯一商品数据源）
scripts/init-db.js           可重复执行的初始化入口
scripts/check-db.js          连接及表检查
scripts/local-mysql.js       Windows 便携开发环境管理
views/partials/              公共导航、搜索和页脚
views/index.ejs              保留原风格的数据库商品首页
views/message.ejs            待开发、404 和数据库错误页面
public/                      本地 CSS、Bootstrap 引用与 SVG 插画
tests/                       配置、失败路径和真实 MySQL 集成测试
.env.example                 无真实密码的配置模板
.local/                      本机程序、数据库与日志，不提交 Git
```

第 1 天的 data/demo-products.js 已移除，防止数据库失效时误用内存演示数据。示例商品仍保留课程演示标签，但现在必须从 MySQL 读取。Bootstrap 从 node_modules 的指定静态目录提供，不暴露整个 node_modules。
