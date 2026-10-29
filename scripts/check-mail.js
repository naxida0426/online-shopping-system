require("../config/environment");
const nodemailer = require("nodemailer");
const { smtpOptions } = require("../services/mailService");
(async () => {
  const options = smtpOptions();
  if (!options) throw new Error("SMTP 未启用，尚未验证发送。请先配置 .env 并设置 MAIL_ENABLED=true。");
  const sender = nodemailer.createTransport(options);
  try { await sender.verify(); console.log("SMTP 连接与认证检查通过；尚未证明邮件实际送达，请再用演示订单验证收件箱。"); }
  finally { sender.close(); }
})().catch(() => { console.error("SMTP 未配置或连接验证失败，尚未验证实际发送。请在本机检查 .env、端口和服务商授权。"); process.exitCode = 1; });
