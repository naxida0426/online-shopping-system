const bcrypt = require("bcryptjs");
const { withUserTransaction } = require("../config/transaction");
const { retiredIdentity } = require('../utils/account-identity');
class AccountError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}
async function deleteAccount(userId, password, confirmDeletion) {
  if (confirmDeletion !== "yes") throw new AccountError("请确认注销账号及清除个人清单。", 422);
  if (typeof password !== "string" || !password || Buffer.byteLength(password) > 72) throw new AccountError("请输入当前账号的密码。", 422);
  return withUserTransaction(userId, async c => {
    const [[user]] = await c.execute("SELECT role, password_hash FROM users WHERE id = ?", [userId]);
    if (user.role !== "customer") throw new AccountError("管理员账号不支持自助注销。");
    if (!await bcrypt.compare(password, user.password_hash)) throw new AccountError("密码不正确，账号未注销。", 422);
    const retired=retiredIdentity(userId);
    await c.execute("UPDATE users SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP, username = ?, email = ? WHERE id = ?", [retired.username,retired.email,userId]);
    await c.execute("DELETE FROM cart_items WHERE user_id = ?", [userId]);
    await c.execute("DELETE FROM favorites WHERE user_id = ?", [userId]);
    await c.execute("DELETE FROM addresses WHERE user_id = ?", [userId]);
    await c.execute("DELETE FROM sessions WHERE JSON_EXTRACT(IF(JSON_VALID(data), data, '{}'), '$.userId') = ?", [userId]);
  });
}
module.exports = { deleteAccount, AccountError };
