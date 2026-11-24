const test = require('node:test');
const assert = require('node:assert/strict');

const { seedDemoAccounts } = require('../scripts/seedDemoAccounts');
const { createAdmin, parseArguments } = require('../scripts/createAdmin');
const { verifyPassword } = require('../auth');

function makeDatabase(initial = {}) {
  const state = {
    foundations: [...(initial.foundations || [])],
    users: [...(initial.users || [])],
    incidents: [...(initial.incidents || [])],
    vehicles: [...(initial.vehicles || [])],
    citizens: [...(initial.citizens || [])],
    chat_messages: [...(initial.chat_messages || [])],
    committed: false,
    rolledBack: false,
  };

  const connection = {
    async beginTransaction() {},
    async commit() { state.committed = true; },
    async rollback() { state.rolledBack = true; },
    release() {},
    async query(sql, params = []) {
      const countMatch = sql.match(/^SELECT COUNT\(\*\) AS count FROM (foundations|users|incidents|vehicles|citizens|chat_messages)$/);
      if (countMatch) return [[{ count: state[countMatch[1]].length }]];

      if (sql === 'INSERT INTO foundations (name, contact_info) VALUES (?, ?)') {
        const id = state.foundations.length + 1;
        state.foundations.push({ id, name: params[0], contact_info: params[1] });
        return [{ insertId: id }];
      }

      if (sql === 'SELECT id FROM foundations WHERE id = ?') {
        return [state.foundations.filter((foundation) => foundation.id === params[0])];
      }

      if (sql === 'SELECT id FROM users WHERE username = ?') {
        return [state.users.filter((user) => user.username === params[0]).map(({ id }) => ({ id }))];
      }

      if (sql === 'INSERT INTO users (username, password, role, foundation_id, phone, is_approved) VALUES (?, ?, ?, ?, ?, ?)') {
        const id = state.users.length + 1;
        state.users.push({
          id,
          username: params[0],
          password: params[1],
          role: params[2],
          foundation_id: params[3],
          phone: params[4],
          is_approved: params[5],
        });
        return [{ insertId: id }];
      }

      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  };

  return {
    state,
    pool: {
      async getConnection() { return connection; },
      async query(sql, params) { return connection.query(sql, params); },
    },
  };
}

test('demo seed requires an exact rescue_demo confirmation before connecting', async () => {
  const database = makeDatabase();

  await assert.rejects(
    seedDemoAccounts({ pool: database.pool, databaseName: 'production', confirmation: 'production' }),
    /restricted to DB_NAME=rescue_demo/,
  );
  await assert.rejects(
    seedDemoAccounts({ pool: database.pool, databaseName: 'rescue_demo', confirmation: '' }),
    /DEMO_SEED_CONFIRM=rescue_demo/,
  );

  assert.deepEqual(database.state.users, []);
  assert.equal(database.state.committed, false);
});

test('demo seed refuses a database containing application data', async () => {
  const existing = { id: 19, username: 'existing-user' };
  const database = makeDatabase({ users: [existing] });

  await assert.rejects(
    seedDemoAccounts({
      pool: database.pool,
      databaseName: 'rescue_demo',
      confirmation: 'rescue_demo',
    }),
    /must be empty/i,
  );

  assert.deepEqual(database.state.users, [existing]);
  assert.equal(database.state.committed, false);
  assert.equal(database.state.rolledBack, true);
});

test('demo seed treats operational tables as part of the empty database check', async () => {
  const database = makeDatabase({ vehicles: [{ id: 1, license_plate: 'existing' }] });

  await assert.rejects(
    seedDemoAccounts({
      pool: database.pool,
      databaseName: 'rescue_demo',
      confirmation: 'rescue_demo',
    }),
    /must be empty.*vehicles/i,
  );

  assert.equal(database.state.foundations.length, 0);
  assert.equal(database.state.rolledBack, true);
});

test('demo seed creates four login-compatible accounts only on an empty demo database', async () => {
  const database = makeDatabase();

  const result = await seedDemoAccounts({
    pool: database.pool,
    databaseName: 'rescue_demo',
    confirmation: 'rescue_demo',
  });

  assert.equal(result.accounts.length, 4);
  assert.deepEqual(
    database.state.users.map(({ username, role, is_approved }) => ({ username, role, is_approved })),
    [
      { username: 'demo.admin', role: 'Admin', is_approved: 1 },
      { username: 'demo.rescue1', role: 'Rescue', is_approved: 1 },
      { username: 'demo.rescue2', role: 'Rescue', is_approved: 1 },
      { username: 'demo.rescue3', role: 'Rescue', is_approved: 1 },
    ],
  );
  for (const user of database.state.users) {
    assert.equal(await verifyPassword('RescueDemo!2026', user.password), true);
    assert.notEqual(user.password, 'RescueDemo!2026');
  }
  assert.equal(database.state.foundations.length, 1);
  assert.equal(database.state.committed, true);
});

test('admin helper creates an approved Admin with a bcrypt password', async () => {
  const database = makeDatabase({ foundations: [{ id: 7, name: 'Foundation' }] });

  const result = await createAdmin({
    pool: database.pool,
    username: 'teacher.admin',
    password: 'UniqueAdmin!2026',
    foundationId: 7,
  });

  assert.equal(result.username, 'teacher.admin');
  assert.deepEqual(
    database.state.users.map(({ username, role, foundation_id, is_approved }) => ({ username, role, foundation_id, is_approved })),
    [{ username: 'teacher.admin', role: 'Admin', foundation_id: 7, is_approved: 1 }],
  );
  assert.equal(await verifyPassword('UniqueAdmin!2026', database.state.users[0].password), true);
});

test('admin helper preserves an existing username', async () => {
  const existing = { id: 1, username: 'teacher.admin', role: 'Rescue' };
  const database = makeDatabase({
    foundations: [{ id: 7, name: 'Foundation' }],
    users: [existing],
  });

  await assert.rejects(
    createAdmin({
      pool: database.pool,
      username: 'teacher.admin',
      password: 'UniqueAdmin!2026',
      foundationId: 7,
    }),
    /already exists/i,
  );

  assert.deepEqual(database.state.users, [existing]);
});

test('admin CLI requires password input through stdin', () => {
  assert.throws(
    () => parseArguments(['--username', 'teacher.admin', '--foundation-id', '7']),
    /--password-stdin/,
  );
  assert.deepEqual(
    parseArguments(['--username', 'teacher.admin', '--foundation-id', '7', '--password-stdin']),
    { username: 'teacher.admin', foundationId: '7', passwordStdin: true },
  );
});
