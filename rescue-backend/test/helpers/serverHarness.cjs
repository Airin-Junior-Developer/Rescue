const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const realRequire = createRequire(path.join(root, 'server.js'));
const jwt = realRequire('jsonwebtoken');
const secret = 'test-only-secret-with-enough-entropy';

function loadServer({ query, redisDown = false, lineResponse } = {}) {
  const writes = [];
  const records = new Map();
  const emissions = [];
  const intervals = [];
  const pool = { query: async (sql, params = []) => {
    if (/^(ALTER|CREATE|DELETE FROM chat_messages)/.test(sql.trim())) return [{ affectedRows: 0 }];
    if (query) return query(sql, params);
    return [[]];
  }};
  const redisClient = {
    isReady: !redisDown, on() {}, connect: async () => {},
    get: async key => records.get(key) || null,
    set: async (key, value, options) => { writes.push(['set', key, value, options]); records.set(key, value); },
    // External Redis boundary: simulate compare-and-delete atomically; SQL/routes/socket handlers remain real.
    eval: async (script, { keys, arguments: args }) => {
      const raw = records.get(keys[0]);
      if (script.includes('status-write')) {
        if (!raw) return 0;
        const state = JSON.parse(raw); state.status = args[0];
        records.set(keys[0], JSON.stringify(state)); return 1;
      }
      if (script.includes('presence-write')) {
        if (args[0] && (!raw || JSON.parse(raw).socket_id !== args[0])) return 0;
        records.set(keys[0], args[1]); writes.push(['set', keys[0], args[1], { EX: 60 }]);
        return 1;
      }
      if (raw && JSON.parse(raw).socket_id === args[0]) {
        records.delete(keys[0]); writes.push(['ZREM', keys[1], args[1]]); return 1;
      }
      return 0;
    },
    del: async key => { writes.push(['del', key]); records.delete(key); },
    sendCommand: async args => { if (redisDown) throw new Error('Redis unavailable'); writes.push(args); return []; },
  };
  let connection;
  const io = { on: (event, fn) => { if (event === 'connection') connection = fn; },
    emit: (event, data) => emissions.push({ event, data }),
    to: room => ({ emit: (event, data) => emissions.push({ room, event, data }) }) };
  const overrides = {
    'mysql2/promise': { createPool: () => pool }, redis: { createClient: () => redisClient },
    http: { createServer: () => ({ listen() {} }) }, 'socket.io': { Server: function () { return io; } },
    dotenv: { config() {} }, axios: { post: async () => ({ data: lineResponse || {} }) },
  };
  const module = { exports: {} };
  const context = {
    require: name => overrides[name] || realRequire(name), module, exports: module.exports,
    process: { env: { JWT_SECRET: secret, LINE_LOGIN_CHANNEL_ID: '1234' } },
    console: { log() {}, error() {}, warn() {} }, URLSearchParams,
    setInterval: fn => { intervals.push(fn); return { unref() {} }; },
    setTimeout: () => ({ unref() {} }), clearTimeout() {},
  };
  // getJwtSecret reads the real process environment; isolate the value around module evaluation.
  const old = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  try {
    vm.runInNewContext(fs.readFileSync(path.join(root, 'server.js'), 'utf8') + '\nmodule.exports = { app };', context, { filename: path.join(root, 'server.js') });
  } finally { if (old === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = old; }
  function socket(id = 'socket-one') {
    const handlers = {};
    const rooms = new Set();
    const instance = { id, data: {}, connected: true, on: (event, fn) => { handlers[event] = fn; },
      join: room => rooms.add(room), leave: room => rooms.delete(room),
      emit: (event, data) => emissions.push({ event, data }) };
    connection(instance);
    return { handlers, rooms, instance, emit: async (event, data) => {
      let ack;
      await handlers[event]?.(data, value => { ack = value; });
      return ack;
    }};
  }
  async function request(method, routePath, { body = {}, params = {}, token, query = {} } = {}) {
    const route = module.exports.app.router.stack.find(layer => layer.route?.path === routePath && layer.route.methods[method]).route;
    const req = { body, params, query, headers: token ? { authorization: `Bearer ${token}` } : {} };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
    // Rate limiter behavior is covered by its HTTP test; execute authentication and actual route handlers.
    for (const layer of route.stack) {
      if (['sosLimiter', 'loginLimiter', 'publicWriteLimiter'].includes(layer.handle.name) || layer.handle.name === '') {
        if (layer !== route.stack.at(-1)) continue;
      }
      let next = false;
      await layer.handle(req, res, () => { next = true; });
      if (!next) break;
    }
    return res;
  }
  return { socket, request, writes, records, emissions, intervals, pool, redisClient };
}
const staffToken = (id = 7, role = 'Rescue') => jwt.sign({ id, role }, secret, { expiresIn: '1h' });
module.exports = { loadServer, staffToken };
