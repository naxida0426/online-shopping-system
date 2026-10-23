// Windows 本机便携开发环境：程序、数据与凭据均留在 Git 忽略目录中。
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const mysql = require("mysql2/promise");
const dotenv = require("dotenv");

const root = path.join(__dirname, "..");
const local = path.join(root, ".local");
const version = "8.4.13";
const fileName = `mysql-${version}-winx64.zip`;
const archive = path.join(local, "downloads", fileName);
const baseDir = path.join(local, `mysql-${version}-winx64`);
const executable = path.join(baseDir, "bin", "mysqld.exe");
const configPath = path.join(local, "my.ini");
const metadataPath = path.join(local, "mysql-runtime.json");
const envPath = path.join(root, ".env");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

class LocalMysqlError extends Error {}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = result => { socket.destroy(); resolve(result); };
    socket.setTimeout(1000);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new LocalMysqlError("本机数据库准备命令未成功完成。")));
  });
}

function launch(bootstrapPath) {
  const ps = "$arguments = '--defaults-file=\"' + $env:SHOP_MYSQL_CONFIG + '\"'; if ($env:SHOP_MYSQL_BOOTSTRAP) { $arguments += ' --init-file=\"' + $env:SHOP_MYSQL_BOOTSTRAP + '\"' }; $process = Start-Process -FilePath $env:SHOP_MYSQL_EXECUTABLE -ArgumentList $arguments -WindowStyle Hidden -PassThru; Write-Output $process.Id";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
    cwd: root, windowsHide: true, encoding: "utf8",
    env: { ...process.env, SHOP_MYSQL_CONFIG: configPath, SHOP_MYSQL_EXECUTABLE: executable, SHOP_MYSQL_BOOTSTRAP: bootstrapPath || "" }
  });
  if (result.status !== 0) throw new LocalMysqlError("无法启动本机 MySQL，请检查 .local 中的程序与日志。");
}

async function ready(port) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await portOpen(port)) return;
    await wait(500);
  }
  throw new LocalMysqlError("MySQL 未在 30 秒内就绪，请在本机查看 .local/mysql-error.log。");
}

async function readMetadata() {
  if (!await exists(metadataPath)) throw new LocalMysqlError("尚未配置便携 MySQL，请先执行 npm run mysql:setup。");
  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  if (!Number.isInteger(metadata.port) || metadata.port < 1024 || metadata.port > 65535 || metadata.version !== version) {
    throw new LocalMysqlError("本机 MySQL 运行记录不匹配，请先查看 README。");
  }
  return metadata;
}

async function setup() {
  if (await exists(metadataPath)) {
    console.log("本机环境已配置，保留现有账号和数据。");
    const metadata = await readMetadata();
    const configured = dotenv.parse(await fs.readFile(envPath, "utf8"));
    if (configured.DB_HOST !== "127.0.0.1" || Number(configured.DB_PORT) !== metadata.port) {
      throw new LocalMysqlError(".env 已切换到其他数据库，不重复初始化便携环境。请按 README 使用现有数据库。");
    }
    await start();
    await run(process.execPath, [path.join(__dirname, "init-db.js")]);
    await run(process.execPath, [path.join(__dirname, "check-db.js")]);
    return;
  }
  const currentText = await exists(envPath) ? await fs.readFile(envPath, "utf8") : await fs.readFile(path.join(root, ".env.example"), "utf8");
  const current = dotenv.parse(currentText);
  if (current.DB_PASSWORD && !/^replace_with_|^change_me|^your_/i.test(current.DB_PASSWORD)) {
    throw new LocalMysqlError(".env 已有实际数据库配置，为保留你的配置，本机安装未继续。请使用现有 MySQL，或先自行备份并调整 .env。");
  }
  const dataDir = path.join(local, "mysql-data");
  if (await exists(dataDir)) throw new LocalMysqlError("发现已有数据目录，停止重复初始化。请保留数据并检查本机运行记录。");
  await fs.mkdir(path.dirname(archive), { recursive: true });
  if (!await exists(archive) || crypto.createHash("md5").update(await fs.readFile(archive)).digest("hex") !== "7b94489d5524dea9b27097068bea25a8") {
    console.log("正在下载官方 MySQL ZIP（约 268 MB），支持断点续传。");
    await run("curl.exe", ["--location", "--fail", "--retry", "2", "--continue-at", "-", "--silent", "--show-error", "--output", archive, `https://cdn.mysql.com/Downloads/MySQL-8.4/${fileName}`]);
  }
  const checksum = crypto.createHash("md5").update(await fs.readFile(archive)).digest("hex");
  if (checksum !== "7b94489d5524dea9b27097068bea25a8") throw new LocalMysqlError("文件校验不匹配，停止执行下载的程序。");
  if (!await exists(executable)) {
    console.log("官方文件校验通过，正在解压。");
    await run("powershell.exe", ["-NoProfile", "-Command", "Expand-Archive -LiteralPath $env:SHOP_MYSQL_ARCHIVE -DestinationPath $env:SHOP_MYSQL_LOCAL -Force"], {
      env: { ...process.env, SHOP_MYSQL_ARCHIVE: archive, SHOP_MYSQL_LOCAL: local }
    });
  }
  let port = 3307;
  while (port <= 3317 && await portOpen(port)) port++;
  if (port > 3317) throw new LocalMysqlError("开发端口 3307–3317 均被占用，请先查看本机服务。");
  const iniPath = value => `"${value.replace(/\\/g, "/")}"`;
  const settings = ["[mysqld]", `basedir=${iniPath(baseDir)}`, `datadir=${iniPath(dataDir)}`, "bind-address=127.0.0.1", `port=${port}`, "mysqlx=OFF", "skip-name-resolve", "character-set-server=utf8mb4", "collation-server=utf8mb4_0900_ai_ci", "innodb-buffer-pool-size=64M", "max-connections=50", `log-error=${iniPath(path.join(local, "mysql-error.log"))}`, `pid-file=${iniPath(path.join(local, "mysql.pid"))}`, ""];
  await fs.writeFile(configPath, settings.join("\n"));
  console.log("正在初始化新的本机数据目录。");
  await run(executable, [`--defaults-file=${configPath}`, "--initialize-insecure"], { stdio: "ignore" });
  const appPassword = crypto.randomBytes(24).toString("hex");
  const adminPassword = crypto.randomBytes(24).toString("hex");
  const bootstrapPath = path.join(local, "bootstrap.sql");
  // 启动初始化文件在接受连接之前设置密码，仅首次启动使用。
  const bootstrap = [
    `ALTER USER 'root'@'localhost' IDENTIFIED BY '${adminPassword}';`,
    "CREATE DATABASE IF NOT EXISTS online_shopping CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;",
    "CREATE DATABASE IF NOT EXISTS online_shopping_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;",
    `CREATE USER 'shopping_app'@'127.0.0.1' IDENTIFIED BY '${appPassword}';`,
    "GRANT SELECT, INSERT, UPDATE, DELETE ON online_shopping.* TO 'shopping_app'@'127.0.0.1';",
    "GRANT SELECT, INSERT, UPDATE, DELETE ON online_shopping_test.* TO 'shopping_app'@'127.0.0.1';",
    `CREATE USER 'shopping_setup'@'127.0.0.1' IDENTIFIED BY '${adminPassword}';`,
    "GRANT ALL PRIVILEGES ON online_shopping.* TO 'shopping_setup'@'127.0.0.1';",
    "GRANT ALL PRIVILEGES ON online_shopping_test.* TO 'shopping_setup'@'127.0.0.1';",
    "GRANT SHUTDOWN ON *.* TO 'shopping_setup'@'127.0.0.1';"
  ];
  await fs.writeFile(bootstrapPath, bootstrap.join("\n"), { mode: 0o600 });
  launch(bootstrapPath);
  await ready(port);
  const connection = await mysql.createConnection({ host: "127.0.0.1", port, user: "shopping_app", password: appPassword, database: "online_shopping" });
  await connection.execute("SELECT 1");
  await connection.end();
  const values = { DB_HOST: "127.0.0.1", DB_PORT: String(port), DB_NAME: "online_shopping", DB_USER: "shopping_app", DB_PASSWORD: appPassword, DB_INIT_USER: "shopping_setup", DB_INIT_PASSWORD: adminPassword, DB_TEST_NAME: "online_shopping_test" };
  let updated = currentText;
  for (const [key, value] of Object.entries(values)) {
    const matcher = new RegExp(`^${key}=.*$`, "m");
    updated = matcher.test(updated) ? updated.replace(matcher, `${key}=${value}`) : `${updated.trimEnd()}\n${key}=${value}\n`;
  }
  await fs.writeFile(envPath, updated, { mode: 0o600 });
  await fs.writeFile(metadataPath, JSON.stringify({ version, port }, null, 2));
  await fs.unlink(bootstrapPath);
  await run(process.execPath, [path.join(__dirname, "init-db.js")]);
  await run(process.execPath, [path.join(__dirname, "check-db.js")]);
  console.log(`本机 MySQL 已配置（127.0.0.1:${port}），随机凭据仅写入被忽略的 .env。`);
}

async function start() {
  const { port } = await readMetadata();
  if (await portOpen(port)) {
    console.log(`本机数据库端口 ${port} 已响应，可执行 npm run db:check 验证。`);
    return;
  }
  // TCP 端口会先于 InnoDB 文件锁释放，必须等旧进程完整退出再启动。
  for (let attempt = 0; attempt < 120 && await exists(path.join(local, "mysql.pid")); attempt++) await wait(250);
  if (await exists(path.join(local, "mysql.pid"))) throw new LocalMysqlError("旧 MySQL 进程尚未完整退出，请等待后重试，不要删除数据目录。");
  launch();
  await ready(port);
  console.log(`MySQL 已启动：127.0.0.1:${port}。`);
}

async function stop() {
  const { port } = await readMetadata();
  if (!await portOpen(port)) return console.log("本机 MySQL 当前未运行。");
  require("../config/environment");
  const { readDatabaseConfig } = require("../config/database-config");
  const options = readDatabaseConfig(process.env, { initialize: true });
  if (options.host !== "127.0.0.1" || options.port !== port) throw new LocalMysqlError(".env 未指向本项目的本机实例，停止操作未继续。");
  const connection = await mysql.createConnection(options);
  try { await connection.query("SHUTDOWN"); }
  finally { await connection.end().catch(() => {}); }
  for (let attempt = 0; attempt < 120; attempt++) {
    if (!await portOpen(port) && !await exists(path.join(local, "mysql.pid"))) break;
    await wait(250);
  }
  if (await portOpen(port) || await exists(path.join(local, "mysql.pid"))) throw new LocalMysqlError("停止请求已发送，但进程仍未退出，请在本机检查日志。");
  console.log("本机 MySQL 已正常停止，数据保留在 .local/mysql-data。");
}

async function main() {
  if (process.platform !== "win32") throw new LocalMysqlError("该便携脚本仅适用于 Windows，其他系统请按 README 配置 MySQL。");
  const action = process.argv[2];
  if (action === "setup") return setup();
  if (action === "start") return start();
  if (action === "stop") return stop();
  if (action === "status") {
    const { port } = await readMetadata();
    console.log(await portOpen(port) ? `本机 MySQL 端口 ${port} 已响应。` : "本机 MySQL 未运行。");
    return;
  }
  throw new LocalMysqlError("可用操作：setup、start、stop、status。");
}

main().catch(error => {
  // 不输出数据库驱动错误或子进程环境，避免打印生成的凭据。
  console.error(error instanceof LocalMysqlError ? error.message : "本机 MySQL 操作未完成，请在本机检查 .local/mysql-error.log、运行记录与 README；不会自动删除或重建已有数据。");
  process.exitCode = 1;
});
