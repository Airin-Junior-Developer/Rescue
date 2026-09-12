const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const redis = require('redis');

// Opt-in only. Use a disposable Redis instance, never the production URL.
const url = process.env.RESCUE_TEST_REDIS_URL;
const source = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
const scripts = [...source.matchAll(/redisClient\.eval\(`([\s\S]*?)`/g)].map(match => match[1]);
const statusScript = scripts.find(script => script.includes('-- status-write'));
const writeScript = scripts.find(script => script.includes('-- presence-write'));
const releaseScript = scripts.find(script => !script.includes('--'));

test('real Redis preserves ownership, TTL and GEO across presence transitions', { skip: !url }, async () => {
  const client = redis.createClient({ url, socket: { reconnectStrategy: false } });
  client.on('error', () => {});
  const prefix = `rescue-test:${process.pid}:${Date.now()}`;
  const keys = [`${prefix}:status:7`, `${prefix}:geo`];
  await client.connect();
  try {
    const state = { socket_id: 'old', status: 'available', latitude: 13, longitude: 100, last_seen: Date.now() };
    const publish = (owner, record) => client.eval(writeScript, { keys, arguments: [owner, JSON.stringify(record), record.status, String(record.longitude), String(record.latitude), '7'] });
    assert.equal(await publish('', state), 1);
    assert.ok(await client.pTTL(keys[0]) > 50000);
    assert.equal((await client.sendCommand(['ZRANGE', keys[1], '0', '-1']))[0], '7');
    const fresh = { ...state, socket_id: 'new', latitude: 14 };
    assert.equal(await publish('', fresh), 1);
    assert.equal(await publish('old', { ...state, latitude: 0 }), 0);
    assert.equal(await client.eval(releaseScript, { keys, arguments: ['old', '7'] }), 0);
    assert.equal(JSON.parse(await client.get(keys[0])).socket_id, 'new');

    await client.pExpire(keys[0], 10000);
    const before = await client.pTTL(keys[0]);
    assert.equal(await client.eval(statusScript, { keys, arguments: ['busy', '7'] }), 1);
    assert.equal(await client.zCard(keys[1]), 0);
    assert.equal(JSON.parse(await client.get(keys[0])).socket_id, 'new');
    const after = await client.pTTL(keys[0]);
    assert.ok(after > 0 && after <= before, 'availability preserves the existing lease deadline');
    assert.equal(await client.eval(statusScript, { keys, arguments: ['available', '7'] }), 1);
    assert.equal(await client.zCard(keys[1]), 1);
    assert.equal(await client.eval(releaseScript, { keys, arguments: ['new', '7'] }), 1);
    assert.equal(await client.get(keys[0]), null);
    assert.equal(await client.zCard(keys[1]), 0);
    assert.equal(await client.eval(statusScript, { keys, arguments: ['available', '7'] }), 0);
    assert.equal(await client.get(keys[0]), null, 'completion cannot resurrect a disconnected driver');
  } finally {
    await client.del(keys);
    await client.quit();
  }
});
