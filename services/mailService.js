const nodemailer = require("nodemailer");
const { getPool } = require("../config/db");
const { isValidEmail } = require("../utils/email");

function smtpOptions(env = process.env) {
  if (env.MAIL_ENABLED !== "true") return null;
  const port = Number(env.SMTP_PORT), secure = env.SMTP_SECURE === "true";
  if (!/^[a-zA-Z0-9.-]+$/.test(env.SMTP_HOST || "") || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !env.SMTP_USER || !env.SMTP_PASSWORD || !isValidEmail(env.SMTP_FROM) || /[\r\n]/.test(env.SMTP_USER)) throw new Error("SMTP_CONFIG_INVALID");
  return { host: env.SMTP_HOST, port, secure, requireTLS: !secure, auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 8000, disableFileAccess: true, disableUrlAccess: true };
}

function confirmationMessage(order, items, from) {
  return { from, to: order.email, subject: `拾光商城 · 订单 ${order.order_no} 模拟支付确认`,
    messageId: `<shiguang-order-${order.id}@${from.split("@")[1]}>`,
    text: [`这是一封课程演示订单确认邮件，未发生真实资金扣款。`, `订单编号：${order.order_no}`, `模拟支付金额：¥${order.total_amount}`,
      ...items.map(item => `${item.product_name} × ${item.quantity}：¥${item.subtotal}`), "可登录商城查看订单详情。请勿向任何人提供密码或验证码。"].join("\n"),
    disableFileAccess: true, disableUrlAccess: true };
}

async function deliverOrderEmail(userId, orderId, { transport, env = process.env } = {}) {
  const pool = getPool();
  const [[order]] = await pool.execute(`SELECT o.id, o.order_no, o.total_amount, u.email, e.status FROM orders o
    JOIN users u ON u.id = o.user_id JOIN order_emails e ON e.order_id = o.id
    WHERE o.id = ? AND o.user_id = ? AND o.payment_status = 'paid' AND o.order_status <> 'cancelled' AND u.status = 'active'`, [orderId, userId]);
  if (!order) return "unavailable";
  if (order.status === "sent") return "sent";
  // 兼容旧数据：历史账号可能在收紧校验前保存了非普通地址，禁止发信。
  if (!isValidEmail(order.email)) {
    await pool.execute("UPDATE order_emails SET status = 'failed', last_error = 'RECIPIENT_INVALID' WHERE order_id = ? AND status NOT IN ('sent','sending')", [orderId]);
    return "failed";
  }
  let options;
  try { options = smtpOptions(env); } catch {
    await pool.execute("UPDATE order_emails SET status = 'failed', last_error = 'SMTP_CONFIG_INVALID' WHERE order_id = ? AND status <> 'sent' AND status <> 'sending'", [orderId]);
    return "failed";
  }
  if (!options && !transport) {
    await pool.execute("UPDATE order_emails SET status = 'skipped', last_error = 'SMTP_NOT_CONFIGURED' WHERE order_id = ? AND status IN ('pending','failed','skipped')", [orderId]);
    return "skipped";
  }
  const [claim] = await pool.execute(`UPDATE order_emails SET status = 'sending', attempts = attempts + 1, last_error = NULL
    WHERE order_id = ? AND attempts < 5 AND (status = 'pending' OR
      (status IN ('failed','skipped') AND updated_at < DATE_SUB(NOW(), INTERVAL 60 SECOND)) OR
      (status = 'sending' AND updated_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)))`, [orderId]);
  if (!claim.affectedRows) return "deferred";
  const sender = transport || nodemailer.createTransport(options);
  try {
    const [items] = await pool.execute("SELECT product_name, quantity, subtotal FROM order_items WHERE order_id = ? ORDER BY id", [orderId]);
    const info = await sender.sendMail(confirmationMessage(order, items, env.SMTP_FROM || "course@example.invalid"));
    if (!Array.isArray(info.accepted) || !info.accepted.some(address => String(address).toLowerCase() === order.email.toLowerCase())) throw new Error("SMTP_NOT_ACCEPTED");
    await pool.execute("UPDATE order_emails SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL WHERE order_id = ?", [orderId]);
    return "sent";
  } catch {
    console.error("[mail] 确认邮件未发送，订单及支付状态已保留。");
    await pool.execute("UPDATE order_emails SET status = 'failed', last_error = 'SMTP_SEND_FAILED' WHERE order_id = ?", [orderId]).catch(() => {});
    return "failed";
  } finally { if (!transport) sender.close(); }
}
module.exports = { smtpOptions, confirmationMessage, deliverOrderEmail };
