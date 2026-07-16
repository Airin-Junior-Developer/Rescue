const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcrypt');
const { verifyPassword } = require('../auth');

test('verifyPassword returns true for a correct bcrypt hash', async () => {
  const hash = await bcrypt.hash('correct-password', 10);
  assert.strictEqual(await verifyPassword('correct-password', hash), true);
});

test('verifyPassword returns false for a wrong password', async () => {
  const hash = await bcrypt.hash('correct-password', 10);
  assert.strictEqual(await verifyPassword('wrong-password', hash), false);
});

test('verifyPassword returns false when the stored value is plaintext, not a hash', async () => {
  // This is the regression this fix prevents: a plaintext-stored password must
  // never authenticate, even if the submitted password string matches it exactly.
  assert.strictEqual(await verifyPassword('password', 'password'), false);
});
