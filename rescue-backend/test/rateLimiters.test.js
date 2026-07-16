const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { sosLimiter } = require('../rateLimiters');

test('sosLimiter allows 5 requests then blocks the 6th within the window', async () => {
  const app = express();
  app.post('/test', sosLimiter, (req, res) => res.status(200).json({ ok: true }));
  const server = app.listen(0);
  const port = server.address().port;

  try {
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/test`, { method: 'POST' });
      assert.strictEqual(res.status, 200, `request ${i + 1} should succeed`);
    }
    const blocked = await fetch(`http://127.0.0.1:${port}/test`, { method: 'POST' });
    assert.strictEqual(blocked.status, 429);
  } finally {
    server.close();
  }
});
