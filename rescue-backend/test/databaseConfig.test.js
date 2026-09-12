const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseConfig } = require('../databaseConfig');

test('local MySQL retains the default port without TLS', () => {
  const config = databaseConfig({ DB_HOST: 'localhost' });
  assert.equal(config.port, 3306);
  assert.equal(config.ssl, undefined);
});

test('hosted MySQL uses its assigned port and verifies its CA', () => {
  const config = databaseConfig({ DB_PORT: '12345', DB_SSL: 'true', DB_SSL_CA: 'certificate' });
  assert.equal(config.port, 12345);
  assert.deepEqual(config.ssl, { ca: 'certificate', rejectUnauthorized: true });
});

test('TLS cannot silently fall back to plaintext without a CA', () => {
  assert.throws(() => databaseConfig({ DB_SSL: 'true' }), /DB_SSL_CA/);
});
