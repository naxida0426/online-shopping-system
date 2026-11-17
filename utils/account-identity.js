const { randomBytes } = require('node:crypto');

// Keep the old user ID for order/review ownership while releasing public login identifiers.
function retiredIdentity(userId) {
  const suffix = randomBytes(12).toString('hex');
  return {
    username: `deleted_${userId}_${suffix}`,
    email: `deleted-${userId}-${suffix}@account.invalid`
  };
}

module.exports = { retiredIdentity };
