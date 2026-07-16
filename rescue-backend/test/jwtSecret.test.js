const test = require('node:test');
const assert = require('node:assert');
const { getJwtSecret } = require('../jwtSecret');

test('getJwtSecret throws when JWT_SECRET is missing', () => {
  assert.throws(() => getJwtSecret({}), /JWT_SECRET environment variable is required/);
});

test('getJwtSecret returns the value when present', () => {
  assert.strictEqual(getJwtSecret({ JWT_SECRET: 'abc123' }), 'abc123');
});
