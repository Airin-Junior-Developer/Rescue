const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, staffToken } = require('./helpers/serverHarness.cjs');

const incident = { id: 10, assigned_user_id: 8, parent_incident_id: null, status: 'Accepted', citizen_token: 'citizen-secret' };
const query = async sql => {
  if (sql.includes('FROM users')) return [[{ id: 7, role: 'Rescue', is_approved: 1, username: 'rescuer' }]];
  if (sql.includes('FROM incidents')) return [[incident]];
  return [{ affectedRows: 1, insertId: 10 }];
};

test('anonymous socket cannot register a driver or join their offer room', async () => {
  const server = loadServer({ query });
  const socket = server.socket();
  await socket.emit('go_online', { user_id: 8, latitude: 13, longitude: 100 });
  assert.equal(server.writes.length, 0);
  assert.equal(socket.rooms.has('driver_8'), false);
});
test('anonymous socket cannot remove another driver or overwrite their GPS', async () => {
  const server = loadServer({ query });
  server.records.set('rescuer_status:8', JSON.stringify({ status: 'available' }));
  const socket = server.socket();
  await socket.emit('update_vehicle_location', { vehicle_id: 8, latitude: 0, longitude: 0 });
  await socket.emit('go_offline', { user_id: 8 });
  assert.equal(server.writes.length, 0);
});
test('unassigned staff cannot complete a case', async () => {
  const server = loadServer({ query });
  const res = await server.request('post', '/api/incidents/:id/complete', { token: staffToken(), params: { id: '10' } });
  assert.equal(res.statusCode, 403);
});
test('unassigned staff cannot read a case chat', async () => {
  const server = loadServer({ query });
  const res = await server.request('get', '/api/incidents/:id/chat', { token: staffToken(), params: { id: '10' } });
  assert.equal(res.statusCode, 403);
});
test('unassigned staff cannot join a case socket room or send messages', async () => {
  const server = loadServer({ query });
  const socket = server.socket();
  await socket.emit('join_incident_room', { incident_id: 10, staff_token: staffToken() });
  await socket.emit('send_chat_message', { incident_id: 10, staff_token: staffToken(), message: 'intrusion' });
  assert.equal(socket.rooms.size, 0);
  assert.equal(server.emissions.some(e => e.event === 'new_chat_message'), false);
});
test('raw LINE identity cannot read or overwrite a citizen phone', async () => {
  const server = loadServer({ query });
  for (const route of ['/api/citizen/auth', '/api/citizen/register-phone']) {
    const res = await server.request('post', route, { body: { line_uid: 'victim', phone: '0812345678' } });
    assert.equal(res.statusCode, 401);
  }
});
test('SOS is persisted and acknowledged even when Redis is unavailable', async () => {
  let saved = false;
  const server = loadServer({ redisDown: true, query: async sql => {
    if (sql.startsWith('INSERT INTO incidents')) { saved = true; return [{ insertId: 42 }]; }
    return [[]];
  }});
  const res = await server.request('post', '/api/incidents', { body: { latitude: 13, longitude: 100, citizen_phone: '0812345678' } });
  assert.equal(res.statusCode, 201);
  assert.equal(saved, true);
  assert.equal(res.body.incident_id, 42);
  assert.ok(res.body.citizen_token);
});

test('verified LINE subject is used even if the client sends a different uid', async () => {
  const updates = [];
  const server = loadServer({ lineResponse: { sub: 'verified-user', aud: '1234', iss: 'https://access.line.me', exp: Math.floor(Date.now() / 1000) + 3600, name: 'Verified' }, query: async (sql, params) => {
    if (sql.startsWith('SELECT phone')) return [[{ phone: '0811111111' }]];
    updates.push({ sql, params }); return [{ affectedRows: 1 }];
  }});
  const auth = await server.request('post', '/api/citizen/auth', { body: { id_token: 'line-id-token', line_uid: 'victim' } });
  assert.equal(auth.statusCode, 200);
  const res = await server.request('post', '/api/citizen/register-phone', { token: auth.body.citizen_token, body: { line_uid: 'victim', phone: '0899999999' } });
  assert.equal(res.statusCode, 200);
  assert.equal(updates.at(-1).params[1], 'verified-user');
});
test('tokens for another LINE channel and expired LINE tokens are rejected', async () => {
  for (const claims of [ { aud: 'other', exp: Math.floor(Date.now() / 1000) + 3600 }, { aud: '1234', exp: 1 } ]) {
    const server = loadServer({ lineResponse: { sub: 'user', iss: 'https://access.line.me', ...claims } });
    const res = await server.request('post', '/api/citizen/auth', { body: { id_token: 'token' } });
    assert.equal(res.statusCode, 401);
  }
});
test('approved staff identity is taken from the token and database, not supplied driver id', async () => {
  const server = loadServer({ query });
  const socket = server.socket();
  const ack = await socket.emit('go_online', { staff_token: staffToken(), user_id: 99, username: 'Forged', latitude: 13, longitude: 100 });
  assert.equal(ack.ok, true);
  assert.equal(socket.rooms.has('driver_7'), true);
  assert.equal(socket.rooms.has('driver_99'), false);
  assert.equal(JSON.parse(server.records.get('rescuer_status:7')).username, 'rescuer');
  assert.equal(server.writes.find(w => w[0] === 'set')[3].EX, 60);
});
test('revoked rescuers cannot publish presence using a previously issued token', async () => {
  const server = loadServer({ query: async () => [[{ id: 7, role: 'Rescue', is_approved: 0 }]] });
  const ack = await server.socket().emit('go_online', { staff_token: staffToken(), latitude: 13, longitude: 100 });
  assert.equal(ack.ok, false);
  assert.equal(server.writes.length, 0);
});
test('assigned staff can chat but cannot forge the sender identity', async () => {
  let message;
  const server = loadServer({ query: async (sql, params) => {
    if (sql.includes('FROM users')) return [[{ id: 7, role: 'Rescue', is_approved: 1, username: 'Real staff' }]];
    if (sql.includes('FROM incidents')) return [[{ ...incident, assigned_user_id: 7 }]];
    if (sql.startsWith('INSERT INTO chat_messages')) message = params;
    return [{ affectedRows: 1 }];
  }});
  const ack = await server.socket().emit('send_chat_message', { incident_id: 10, staff_token: staffToken(), sender: 'System', message: 'On my way' });
  assert.equal(ack.ok, true);
  assert.equal(message[1], 'Staff:Real staff');
  assert.equal(server.emissions.at(-1).data.message, 'On my way');
});
test('a valid citizen capability still grants access to its incident room', async () => {
  const server = loadServer({ query });
  const socket = server.socket();
  const ack = await socket.emit('join_incident_room', { incident_id: 10, citizen_token: 'citizen-secret' });
  assert.equal(ack.ok, true);
  assert.equal(socket.rooms.has('incident_room_10'), true);
});
test('unassigned staff cannot request backup for another case', async () => {
  const server = loadServer({ query });
  const res = await server.request('post', '/api/incidents/:id/backup', { token: staffToken(), params: { id: '10' } });
  assert.equal(res.statusCode, 403);
});
test('the assigned driver can complete their case', async () => {
  let completed = false;
  const server = loadServer({ query: async sql => {
    if (sql.includes('FROM users')) return [[{ id: 7, role: 'Rescue', is_approved: 1 }]];
    if (sql.includes('FROM incidents')) return [[{ ...incident, assigned_user_id: 7 }]];
    if (sql.startsWith('UPDATE incidents')) completed = true;
    return [{ affectedRows: 1 }];
  }});
  const res = await server.request('post', '/api/incidents/:id/complete', { token: staffToken(), params: { id: '10' } });
  assert.equal(res.statusCode, 200);
  assert.equal(completed, true);
});

test('driver disconnect removes presence and delayed old disconnect preserves a new session', async () => {
  const server = loadServer({ query });
  const old = server.socket('old');
  await old.emit('go_online', { staff_token: staffToken(), latitude: 13, longitude: 100 });
  await old.emit('disconnect');
  assert.equal(server.records.has('rescuer_status:7'), false);
  await old.emit('go_online', { staff_token: staffToken(), latitude: 13, longitude: 100 });
  const fresh = server.socket('new');
  await fresh.emit('go_online', { staff_token: staffToken(), latitude: 14, longitude: 100 });
  await old.emit('disconnect');
  assert.equal(JSON.parse(server.records.get('rescuer_status:7')).socket_id, 'new');
  await fresh.emit('go_offline', { staff_token: staffToken(), user_id: 99 });
  assert.equal(server.records.has('rescuer_status:7'), false);
});
test('pending polling does not dispatch to an expired driver location', async () => {
  const server = loadServer({ query: async sql => {
    if (sql.includes('FROM incidents')) return [[{ id: 10, status: 'Pending', latitude: 13, longitude: 100 }]];
    return [[]];
  }});
  server.redisClient.sendCommand = async args => args[0] === 'GEORADIUS' ? ['7'] : [];
  server.records.set('rescuer_status:7', JSON.stringify({ status: 'available', last_seen: Date.now() - 120000 }));
  await server.intervals[1]();
  assert.equal(server.emissions.some(e => e.event === 'offer_mission'), false);
  server.records.set('rescuer_status:7', JSON.stringify({ status: 'available', last_seen: Date.now() }));
  await server.intervals[1]();
  assert.equal(server.emissions.some(e => e.event === 'offer_mission' && e.room === 'driver_7'), true);
});
test('GPS events cannot forge another vehicle or access an unrelated case', async () => {
  const server = loadServer({ query });
  const socket = server.socket();
  await socket.emit('go_online', { staff_token: staffToken(), latitude: 13, longitude: 100 });
  const denied = await socket.emit('update_vehicle_location', { staff_token: staffToken(), vehicle_id: 8, active_incident_id: 10, latitude: 0, longitude: 0 });
  assert.equal(denied.ok, false);
  assert.equal(JSON.parse(server.records.get('rescuer_status:7')).latitude, 13);
  assert.equal(server.records.has('rescuer_status:8'), false);
});
test('admin credentials cannot accept a mission as a driver', async () => {
  const server = loadServer({ query: async sql => {
    if (sql.includes('FROM users')) return [[{ id: 7, role: 'Admin', is_approved: 1 }]];
    return [{ affectedRows: 1 }];
  }});
  const res = await server.request('post', '/api/incidents/:id/accept', { token: staffToken(7, 'Admin'), params: { id: '10' } });
  assert.equal(res.statusCode, 403);
});
test('disconnect during a slow presence update does not leave a ghost driver', async () => {
  let releaseQuery;
  let enteredQuery;
  const entered = new Promise(resolve => { enteredQuery = resolve; });
  const server = loadServer({ query: async sql => {
    if (sql.includes('FROM users')) return [[{ id: 7, role: 'Rescue', is_approved: 1 }]];
    if (sql.includes('FROM incidents')) {
      enteredQuery();
      return new Promise(resolve => { releaseQuery = () => resolve([[]]); });
    }
    return [[]];
  }});
  const socket = server.socket();
  const online = socket.emit('go_online', { staff_token: staffToken(), latitude: 13, longitude: 100 });
  await entered;
  socket.instance.connected = false;
  const disconnected = socket.emit('disconnect');
  releaseQuery();
  await Promise.all([online, disconnected]);
  assert.equal(server.records.has('rescuer_status:7'), false);
});
test('a slow old GPS writer cannot overwrite a reconnected driver lease', async () => {
  let delay = false, releaseQuery, enteredQuery;
  const entered = new Promise(resolve => { enteredQuery = resolve; });
  const server = loadServer({ query: async sql => {
    if (sql.includes('FROM users')) return [[{ id: 7, role: 'Rescue', is_approved: 1 }]];
    if (sql.includes('FROM incidents') && delay) {
      delay = false; enteredQuery();
      return new Promise(resolve => { releaseQuery = () => resolve([[]]); });
    }
    return [[]];
  }});
  const old = server.socket('old');
  await old.emit('go_online', { staff_token: staffToken(), latitude: 13, longitude: 100 });
  delay = true;
  const staleWrite = old.emit('update_vehicle_location', { staff_token: staffToken(), latitude: 1, longitude: 1 });
  await entered;
  await server.socket('new').emit('go_online', { staff_token: staffToken(), latitude: 14, longitude: 100 });
  releaseQuery();
  const result = await staleWrite;
  assert.equal(result.ok, false);
  const status = JSON.parse(server.records.get('rescuer_status:7'));
  assert.equal(status.socket_id, 'new');
  assert.equal(status.latitude, 14);
});
test('finishing a backup does not announce that the parent rescue is complete', async () => {
  let notificationLookup = false;
  const server = loadServer({ query: async sql => {
    if (sql.includes('FROM users')) return [[{ id: 7, role: 'Rescue', is_approved: 1 }]];
    if (sql.includes('FROM incidents')) return [[{ ...incident, assigned_user_id: 7, parent_incident_id: 9, citizen_phone: '0812345678' }]];
    if (sql.includes('FROM citizens')) notificationLookup = true;
    return [{ affectedRows: 1 }];
  }});
  const res = await server.request('post', '/api/incidents/:id/complete', { token: staffToken(), params: { id: '10' } });
  assert.equal(res.statusCode, 200);
  assert.equal(server.emissions.some(e => e.event === 'mission_completed'), false);
  assert.equal(notificationLookup, false);
});
test('completion cannot resurrect presence removed just before the Redis write', async () => {
  const server = loadServer({ query: async sql => {
    if (sql.includes('FROM users')) return [[{ id: 7, role: 'Rescue', is_approved: 1 }]];
    if (sql.includes('FROM incidents')) return [[{ ...incident, assigned_user_id: 7 }]];
    return [{ affectedRows: 1 }];
  }});
  server.records.set('rescuer_status:7', JSON.stringify({ socket_id: 'old', status: 'busy', latitude: 13, longitude: 100 }));
  for (const method of ['set', 'eval']) {
    const original = server.redisClient[method];
    server.redisClient[method] = async (...args) => {
      server.records.delete('rescuer_status:7'); // concurrent disconnect immediately before write
      return original(...args);
    };
  }
  const res = await server.request('post', '/api/incidents/:id/complete', { token: staffToken(), params: { id: '10' } });
  assert.equal(res.statusCode, 200);
  assert.equal(server.records.has('rescuer_status:7'), false);
});
