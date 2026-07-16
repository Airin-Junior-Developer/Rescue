const test = require('node:test');
const assert = require('node:assert');
const { isAllowedOrigin } = require('../corsConfig');

test('isAllowedOrigin allows requests with no origin (mobile apps, curl)', () => {
  assert.strictEqual(isAllowedOrigin(undefined), true);
});

test('isAllowedOrigin allows known localhost dev origins', () => {
  assert.strictEqual(isAllowedOrigin('http://localhost:5173'), true);
  assert.strictEqual(isAllowedOrigin('http://127.0.0.1:3002'), true);
});

test('isAllowedOrigin allows any vercel.app subdomain', () => {
  assert.strictEqual(isAllowedOrigin('https://rescue-frontend-abc123.vercel.app'), true);
});

test('isAllowedOrigin allows any railway.app subdomain', () => {
  assert.strictEqual(isAllowedOrigin('https://rescue-backend-production.up.railway.app'), true);
});

test('isAllowedOrigin rejects unknown origins', () => {
  assert.strictEqual(isAllowedOrigin('https://evil.com'), false);
});
