import test from 'node:test';
import assert from 'node:assert/strict';
import { readIncident, persistPendingIncident, recoverIncident } from '../src/incidentSession.js';
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
test('a pending SOS retains its access token across reload', () => {
  const store = storage();
  persistPendingIncident(store, { incident_id: 42, citizen_token: 'secret' });
  assert.deepEqual(readIncident(store), { id: 42, citizen_token: 'secret', status: 'Pending' });
});
test('temporary network failure retains the pending case for retry', async () => {
  const store = storage();
  persistPendingIncident(store, { incident_id: 42, citizen_token: 'secret' });
  await assert.rejects(recoverIncident(store, async () => { throw new Error('offline'); }));
  assert.equal(readIncident(store).id, 42);
});
test('recovering after a missed socket event hydrates the assigned driver', async () => {
  const store = storage();
  persistPendingIncident(store, { incident_id: 42, citizen_token: 'secret' });
  const result = await recoverIncident(store, async (id, token) => {
    assert.equal(id, 42); assert.equal(token, 'secret');
    return { status: 'Accepted', driver_name: 'Rescuer', driver_phone: '0812345678' };
  });
  assert.equal(result.status, 'Accepted');
  assert.equal(readIncident(store).driver_phone, '0812345678');
});
test('resolved case and revoked access clear the saved case', async () => {
  const store = storage();
  persistPendingIncident(store, { incident_id: 42, citizen_token: 'secret' });
  assert.equal(await recoverIncident(store, async () => ({ status: 'Resolved' })), null);
  assert.equal(readIncident(store), null);
  persistPendingIncident(store, { incident_id: 43, citizen_token: 'revoked' });
  await recoverIncident(store, async () => { throw { response: { status: 403 } }; });
  assert.equal(readIncident(store), null);
});
test('corrupt saved state does not crash the SOS screen', () => {
  const store = storage(); store.setItem('activeCitizenIncident', '{broken');
  assert.equal(readIncident(store), null);
});
test('a late denial for an old case does not delete a newer SOS', async () => {
  const store = storage();
  persistPendingIncident(store, { incident_id: 42, citizen_token: 'old' });
  let reject;
  const pending = recoverIncident(store, () => new Promise((resolve, fail) => { reject = fail; }));
  persistPendingIncident(store, { incident_id: 43, citizen_token: 'new' });
  reject({ response: { status: 403 } });
  await pending;
  assert.equal(readIncident(store).id, 43);
});
test('a delayed Pending snapshot cannot undo an accepted case', async () => {
  const store = storage();
  persistPendingIncident(store, { incident_id: 42, citizen_token: 'secret' });
  let resolve;
  const pending = recoverIncident(store, () => new Promise(done => { resolve = done; }));
  await recoverIncident(store, async () => ({ status: 'Accepted', driver_name: 'Rescuer' }));
  resolve({ status: 'Pending' });
  await pending;
  assert.equal(readIncident(store).status, 'Accepted');
});
