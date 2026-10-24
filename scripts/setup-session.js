const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const dotenv = require("dotenv");

async function setupSession() {
  const target = path.join(__dirname, "..", ".env");
  let content;
  try { content = await fs.readFile(target, "utf8"); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    content = await fs.readFile(path.join(__dirname, "..", ".env.example"), "utf8");
  }
  const existing = dotenv.parse(content).SESSION_SECRET || "";
  if (Buffer.byteLength(existing) >= 32 && !/^(replace_with_|change_me|your_)/i.test(existing)) return;
  const line = `SESSION_SECRET=${randomBytes(32).toString("hex")}`;
  content = /^SESSION_SECRET=.*$/m.test(content) ? content.replace(/^SESSION_SECRET=.*$/m, line) : `${content.trimEnd()}\n${line}\n`;
  await fs.writeFile(target, content, { mode: 0o600 });
}

if (require.main === module) setupSession().then(() => console.log("本机会话密钥已就绪，保存在 .env，未输出密钥内容。"))
  .catch(() => { console.error("会话密钥配置失败，请检查项目 .env 的写入权限。"); process.exitCode = 1; });
module.exports = { setupSession };
