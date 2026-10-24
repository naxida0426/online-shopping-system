# 数据库配置说明

## 使用自己的 MySQL

数据库服务需要单独安装。`mysql2` 是 Node.js 驱动，不会安装 MySQL 服务器。

1. 启动 MySQL，复制 `.env.example` 为 `.env`，已有 `.env` 时不要覆盖。
2. 填写 `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD`。库名只使用字母、数字和下划线，不能以数字开头。密码包含空格或 `#` 时用引号包裹。
3. 运行账号没有建表权限时，另外填写 `DB_INIT_USER` 和 `DB_INIT_PASSWORD`。初始化命令使用这组账号，网站仍使用运行账号。
4. 执行 `npm run session:setup`、`npm run db:init`、`npm run db:check`。

可在 MySQL Workbench 等客户端为运行账号授权。下面仅为模板，请在本机替换密码和库名：

```sql
CREATE USER 'shopping_app'@'127.0.0.1' IDENTIFIED BY '请替换为本机强密码';
GRANT SELECT, INSERT, UPDATE, DELETE ON online_shopping.* TO 'shopping_app'@'127.0.0.1';
```

测试需要单独的数据库，例如 `online_shopping_test`。在 `.env` 中设置 `DB_TEST_NAME`，为初始化账号授予该库建表权限，为运行账号授予该库读写权限。测试会检查库名以 `_test` 结尾并拒绝使用运行库。

SQL 文件不指定库名。`db:init` 根据配置创建并选择数据库，再执行 `sql/init.sql`；也可在客户端先选中数据库再执行 SQL。种子数据使用事务，但 MySQL 建表语句会隐式提交，初始化失败后可以修复原因再重试。

## Windows 便携环境

`npm run mysql:setup` 使用官方 MySQL 8.4.13 ZIP，只监听 `127.0.0.1`，不注册系统服务、不修改 PATH，也不设置开机启动。数据库端口通常为 3307，实际端口以本机 `.env` 为准。

| 命令 | 用途 |
| --- | --- |
| `npm run mysql:setup` | 首次下载与配置；已有环境则保留数据并补齐数据表和会话密钥 |
| `npm run mysql:start` | 启动本项目的便携 MySQL |
| `npm run mysql:stop` | 正常关闭本项目的便携 MySQL |
| `npm run mysql:status` | 查看本地端口是否响应 |
| `npm run db:check` | 实际验证账号、连接和所需 8 张表 |

程序、数据和日志在 `.local/`，凭据在 `.env`，两者已被 Git 忽略。`shopping_app` 只有项目运行库和测试库的 SELECT、INSERT、UPDATE、DELETE 权限；`shopping_setup` 用于初始化和停止本机实例，不是网站管理员。初始化不会创建默认网站用户。

如果 setup 没有完成，在本机检查 `.local/mysql-error.log`。脚本发现旧数据目录时不会自动重建，不要通过删除 `.local/mysql-data` 排障，也不要上传包含凭据或用户信息的原始日志及数据库备份。

官方资料：[MySQL 下载](https://dev.mysql.com/downloads/mysql/8.4.html?os=3)、[Windows ZIP 安装说明](https://dev.mysql.com/doc/refman/8.4/en/windows-installation.html)。

## 会话配置与部署

`npm run session:setup` 生成 32 字节随机密钥，写入 `.env` 的 `SESSION_SECRET`；已有有效密钥时保留原值。不要在每次启动时更换密钥，否则现有登录 Cookie 会失效。多进程部署需要使用同一个密钥与同一个会话数据库。

会话表由 `db:init` 创建，网站运行账号无需建表权限。会话中仅保存用户 ID、CSRF 令牌和 Cookie 信息，不存储密码、哈希或邮箱；每次请求重新读取用户状态和角色。过期会话由会话存储适配器定时清理。

公网部署需使用 HTTPS，并设置 `NODE_ENV=production`，此时会话 Cookie 启用 Secure。仅在网站确实位于受信任的一层反向代理之后设置 `TRUST_PROXY=1`，同时限制外部绕过代理直连 Node.js，否则客户端地址识别和限流可能不准确。本地 HTTP 演示保持 `NODE_ENV=development` 和 `TRUST_PROXY=0`。

会话存储使用 `express-mysql-session`，驱动统一复用项目的 `mysql2` 版本（见 `package.json` 中的 overrides），避免适配器固定的旧驱动产生重复依赖。密码使用 `bcryptjs`，工作因子为 12。登录每个网络地址 15 分钟最多 10 次失败，注册每小时最多 5 次请求；目前限流计数在单个 Node.js 进程内，重启会重置，多实例部署前需使用共享计数存储。
