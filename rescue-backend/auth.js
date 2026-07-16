const bcrypt = require('bcrypt');

async function verifyPassword(plainPassword, storedHash) {
  return bcrypt.compare(plainPassword, storedHash);
}

module.exports = { verifyPassword };
