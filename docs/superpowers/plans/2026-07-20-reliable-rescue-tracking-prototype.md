# Reliable Rescue Tracking Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a presentation-ready research prototype in which Web/LINE citizens confirm an incident location, exactly one fresh rescue unit accepts, all three clients track one canonical lifecycle, and the full flow is recoverable, authorized, and measurable.

**Architecture:** Preserve React, Express, MySQL, Redis, and Socket.IO, but move lifecycle, authorization, dispatch, presence, chat, and transport logic out of `server.js` into dependency-injected modules. MySQL is the source of truth; Redis contains only recoverable live state; Socket.IO broadcasts only after a database commit. Web and LIFF share citizen UI components through separate identity adapters.

**Tech Stack:** Node.js/CommonJS, Express 5, MySQL 8 (`mysql2`), Redis 5 client, Socket.IO 4, React 19, Vite 8, Leaflet, LINE LIFF 2, Node `node:test`, Vitest + Testing Library, Playwright.

**Design spec:** `docs/superpowers/specs/2026-07-20-reliable-rescue-tracking-prototype-design.md`

## Global Constraints

- The product is a Computer Science capstone research prototype for one simulated operating area and two or three demo rescue units.
- It complements but does not connect to or replace 1669; every real-emergency state exposes the Thai-labelled Call 1669 action.
- Citizen Web and LINE LIFF use the same incident components; only identity bootstrapping differs.
- Canonical states are `REPORTED`, `SEARCHING`, `EN_ROUTE`, `ARRIVED`, `COMPLETED`, `NO_UNIT_AVAILABLE`, and `CANCELLED`.
- Search timeout is 120 seconds; offer rounds may repeat every 15 seconds; rescuer heartbeat is every 10 seconds; presence TTL is 30 seconds; REST fallback polling is every 10 seconds.
- A state change is committed to MySQL and appended to `incident_events` before a Socket.IO event is emitted.
- Redis data must be reconstructible from MySQL or a fresh client heartbeat. Never restore in-memory dispatch state.
- Staff identity comes only from a verified JWT. LIFF identity comes only from a LINE token verified by the backend. Web guest incident access uses `X-Incident-Token` and a stored token hash.
- Never trust client-supplied user IDs, vehicle IDs, roles, sender names, or room names.
- Mutation retries use UUID `client_action_id`; report creation uses unique `report_action_id`; chat uses unique `client_message_id`.
- Optional incident media is one JPEG/WebP file, at most 1 MB after client compression, uploaded through HTTP and never embedded in a socket payload.
- Chat and attachments expire after three days; phone numbers and precise completed-incident coordinates expire after seven days; de-identified timing aggregates may remain.
- Service workers cache only versioned static assets, never API, auth, Socket.IO, tracking, or chat traffic.
- Existing security-hardening behaviour (CORS, required JWT secret, bcrypt-only login, rate limiting) must remain passing.
- Backend remains CommonJS. New modules live below `rescue-backend/src/`; `rescue-backend/server.js` becomes bootstrap-only by the end of Task 8.
- Follow TDD for every behaviour change: add one focused failing test, observe the expected failure, implement the minimum behaviour, observe the pass, then run the relevant suite.
- Do not stage or modify unrelated untracked paths: `.DS_Store`, `.claude/`, `.superpowers/`, `Pic/`, `graphify-out/`, or `hatch-pet-runs/`.

## Locked File Structure

### Backend

- `rescue-backend/server.js`: load environment, create the system, listen, and handle shutdown only.
- `rescue-backend/src/createSystem.js`: construct MySQL/Redis repositories and services, Express app, HTTP server, and Socket.IO.
- `rescue-backend/src/config.js`: validated timeout, retention, size, and environment settings.
- `rescue-backend/src/domain/errors.js`: `AppError` and stable error codes.
- `rescue-backend/src/domain/incidentLifecycle.js`: states and pure transition authorization.
- `rescue-backend/src/db/createPool.js`: MySQL pool factory.
- `rescue-backend/src/db/migrate.js`: migration history runner.
- `rescue-backend/src/db/migrations/001-reliable-tracking.js`: schema normalization and new tables/indexes.
- `rescue-backend/src/repositories/incidentRepository.js`: incident and atomic-assignment queries.
- `rescue-backend/src/repositories/citizenRepository.js`: verified LINE citizen upsert and phone update queries.
- `rescue-backend/src/repositories/staffRepository.js`: staff lookup and management queries.
- `rescue-backend/src/repositories/eventRepository.js`: append-only event and audit queries.
- `rescue-backend/src/repositories/chatRepository.js`: idempotent message persistence.
- `rescue-backend/src/repositories/attachmentRepository.js`: bounded binary attachment persistence.
- `rescue-backend/src/services/incidentService.js`: reporting, state changes, cancellation, and REST recovery snapshot.
- `rescue-backend/src/services/citizenAuthService.js`: LIFF verification, citizen session issuance, and capability hashing.
- `rescue-backend/src/services/staffAuthService.js`: bcrypt-only staff login and JWT issuance.
- `rescue-backend/src/services/presenceService.js`: heartbeat, GEO membership, freshness, and cleanup.
- `rescue-backend/src/services/dispatchService.js`: bounded search, offer rounds, atomic acceptance, retry, and restart recovery.
- `rescue-backend/src/services/chatService.js`: message authorization, validation, persistence, and result shaping.
- `rescue-backend/src/services/attachmentService.js`: MIME/size validation and retention-safe access.
- `rescue-backend/src/http/createApp.js`: middleware, route mounting, health, and error boundary.
- `rescue-backend/src/http/middleware/auth.js`: staff/citizen REST authentication.
- `rescue-backend/src/http/routes/authRoutes.js`: login and verified citizen session routes.
- `rescue-backend/src/http/routes/incidentRoutes.js`: report, snapshot, action, chat, and attachment routes.
- `rescue-backend/src/http/routes/rescuerRoutes.js`: active mission, availability-facing reads, and registration routes.
- `rescue-backend/src/http/routes/adminRoutes.js`: command-center reads and audited interventions.
- `rescue-backend/src/realtime/authenticateSocket.js`: handshake identity.
- `rescue-backend/src/realtime/registerSocketHandlers.js`: authorized presence, tracking, room, and chat events.
- `rescue-backend/src/jobs/retentionJob.js`: privacy cleanup.
- `rescue-backend/src/jobs/resumeDispatch.js`: resume `REPORTED`/`SEARCHING` incidents after recovery.
- `rescue-backend/test/unit/**`: pure service/domain tests with fakes.
- `rescue-backend/test/integration/**`: real HTTP/Socket.IO tests against isolated MySQL/Redis.

### Citizen and rescuer frontend

- `rescue-frontend/src/api/client.js`: HTTP client and stable error mapping.
- `rescue-frontend/src/realtime/socket.js`: authenticated Socket.IO factory.
- `rescue-frontend/src/citizen/identity/{webGuest,liff}.js`: identity adapters.
- `rescue-frontend/src/citizen/incidentReducer.js`: canonical citizen UI state.
- `rescue-frontend/src/citizen/useIncidentSession.js`: report, restore, poll, and reconnect orchestration.
- `rescue-frontend/src/citizen/components/{LocationConfirmation,IncidentTimeline,LiveTracking,IncidentChat}.jsx`: focused citizen UI.
- `rescue-frontend/src/CitizenSOS.jsx`: composition only.
- `rescue-frontend/src/rescuer/useRescuerSession.js`: heartbeat, offers, active mission, and reconnect orchestration.
- `rescue-frontend/src/rescuer/components/{AvailabilityPanel,MissionOffer,ActiveMission}.jsx`: focused rescuer UI.
- `rescue-frontend/src/CommandCenter.jsx`: rescuer composition only.
- `rescue-frontend/src/test/**`: Vitest setup and component/hook tests.

### Admin frontend and end-to-end tests

- `rescue-web-admin/src/api/client.js`: authenticated admin HTTP client.
- `rescue-web-admin/src/realtime/socket.js`: authenticated admin socket.
- `rescue-web-admin/src/admin/useCommandCenter.js`: snapshot, realtime merge, and actions.
- `rescue-web-admin/src/admin/components/{IncidentBoard,UnitMap,IncidentTimeline,ResearchMetrics}.jsx`: focused admin UI.
- `rescue-web-admin/src/AdminDashboard.jsx`: command-center composition only.
- `rescue-web-admin/src/test/**`: Vitest setup and admin tests.
- `e2e/package.json`, `e2e/playwright.config.js`, `e2e/tests/rescue-flow.spec.js`: multi-context Web flow.
- `e2e/tests/liff-smoke.md`: physical-device LIFF checklist.
- `rescue-backend/scripts/seed-demo.js`, `rescue-backend/scripts/reset-demo.js`: repeatable protected demo data.

---

### Task 1: Restore a trustworthy baseline and configuration contract

**Files:**
- Modify: `rescue-backend/rateLimiters.js`
- Modify: `rescue-backend/test/rateLimiters.test.js`
- Create: `rescue-backend/src/config.js`
- Create: `rescue-backend/test/unit/config.test.js`
- Modify: `rescue-backend/package.json`

**Interfaces:**
- Produces: `loadConfig(env)` returning `{ dispatchSearchMs, offerRoundMs, heartbeatMs, presenceTtlSeconds, restPollMs, maxAttachmentBytes, chatRetentionDays, personalRetentionDays }`.
- Produces: `RATE_LIMIT_POLICIES`, consumed by the existing limiter exports and unit tests.
- Consumes: existing `express-rate-limit` dependency and Node test runner.

- [ ] **Step 1: Replace the port-binding rate-limit test with a pure failing policy test**

```js
// rescue-backend/test/rateLimiters.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { RATE_LIMIT_POLICIES } = require('../rateLimiters');

test('SOS policy is five requests per ten minutes', () => {
  assert.deepEqual(RATE_LIMIT_POLICIES.sos, { windowMs: 600_000, max: 5 });
});

test('login and public write policies retain their approved limits', () => {
  assert.deepEqual(RATE_LIMIT_POLICIES.login, { windowMs: 900_000, max: 10 });
  assert.deepEqual(RATE_LIMIT_POLICIES.publicWrite, { windowMs: 900_000, max: 20 });
  assert.deepEqual(RATE_LIMIT_POLICIES.media, { windowMs: 600_000, max: 5 });
  assert.deepEqual(RATE_LIMIT_POLICIES.chat, { windowMs: 60_000, max: 30 });
});
```

- [ ] **Step 2: Run the rate-limit test and observe the intended failure**

Run: `cd rescue-backend && node --test test/rateLimiters.test.js`
Expected: FAIL because `RATE_LIMIT_POLICIES` is not exported.

- [ ] **Step 3: Make policies explicit and keep middleware behaviour unchanged**

```js
// rescue-backend/rateLimiters.js
const rateLimit = require('express-rate-limit');

const RATE_LIMIT_POLICIES = Object.freeze({
  sos: { windowMs: 10 * 60 * 1000, max: 5 },
  login: { windowMs: 15 * 60 * 1000, max: 10 },
  publicWrite: { windowMs: 15 * 60 * 1000, max: 20 },
  media: { windowMs: 10 * 60 * 1000, max: 5 },
  chat: { windowMs: 60 * 1000, max: 30 },
});

const buildLimiter = (policy) => rateLimit({
  ...policy,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  RATE_LIMIT_POLICIES,
  sosLimiter: buildLimiter(RATE_LIMIT_POLICIES.sos),
  loginLimiter: buildLimiter(RATE_LIMIT_POLICIES.login),
  publicWriteLimiter: buildLimiter(RATE_LIMIT_POLICIES.publicWrite),
  mediaLimiter: buildLimiter(RATE_LIMIT_POLICIES.media),
};
```

- [ ] **Step 4: Write the failing configuration test**

```js
// rescue-backend/test/unit/config.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../../src/config');

test('loadConfig returns the approved timing and retention defaults', () => {
  assert.deepEqual(loadConfig({}), {
    dispatchSearchMs: 120_000,
    offerRoundMs: 15_000,
    heartbeatMs: 10_000,
    presenceTtlSeconds: 30,
    restPollMs: 10_000,
    maxAttachmentBytes: 1_048_576,
    chatRetentionDays: 3,
    personalRetentionDays: 7,
  });
});

test('loadConfig rejects a presence TTL shorter than two heartbeats', () => {
  assert.throws(
    () => loadConfig({ HEARTBEAT_MS: '10000', PRESENCE_TTL_SECONDS: '15' }),
    /PRESENCE_TTL_SECONDS must cover at least two heartbeats/,
  );
});
```

- [ ] **Step 5: Run the configuration test and observe the intended failure**

Run: `cd rescue-backend && node --test test/unit/config.test.js`
Expected: FAIL with `Cannot find module '../../src/config'`.

- [ ] **Step 6: Implement validated configuration**

```js
// rescue-backend/src/config.js
const integer = (env, name, fallback) => {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};

function loadConfig(env = process.env) {
  const config = {
    dispatchSearchMs: integer(env, 'DISPATCH_SEARCH_MS', 120_000),
    offerRoundMs: integer(env, 'OFFER_ROUND_MS', 15_000),
    heartbeatMs: integer(env, 'HEARTBEAT_MS', 10_000),
    presenceTtlSeconds: integer(env, 'PRESENCE_TTL_SECONDS', 30),
    restPollMs: integer(env, 'REST_POLL_MS', 10_000),
    maxAttachmentBytes: integer(env, 'MAX_ATTACHMENT_BYTES', 1_048_576),
    chatRetentionDays: integer(env, 'CHAT_RETENTION_DAYS', 3),
    personalRetentionDays: integer(env, 'PERSONAL_RETENTION_DAYS', 7),
  };
  if (config.presenceTtlSeconds * 1000 < config.heartbeatMs * 2) {
    throw new Error('PRESENCE_TTL_SECONDS must cover at least two heartbeats');
  }
  return config;
}

module.exports = { loadConfig };
```

- [ ] **Step 7: Make the backend test command deterministic**

Change `rescue-backend/package.json`:

```json
"scripts": {
  "dev": "nodemon server.js",
  "start": "node server.js",
  "test": "node --test test",
  "test:unit": "node --test test/unit test/*.test.js"
}
```

- [ ] **Step 8: Run and commit the baseline**

Run: `cd rescue-backend && npm test`
Expected: all existing security tests and new configuration tests PASS without opening a TCP listener.

```bash
git add rescue-backend/rateLimiters.js rescue-backend/test/rateLimiters.test.js rescue-backend/src/config.js rescue-backend/test/unit/config.test.js rescue-backend/package.json
git commit -m "test: establish reliable backend quality baseline"
```

---

### Task 2: Add versioned migrations and the reliable-tracking schema

**Files:**
- Create: `rescue-backend/src/db/createPool.js`
- Create: `rescue-backend/src/db/migrate.js`
- Create: `rescue-backend/src/db/migrations/001-reliable-tracking.js`
- Create: `rescue-backend/test/unit/migrate.test.js`
- Modify: `rescue-backend/server.js` (remove startup `ALTER TABLE` and `CREATE TABLE` calls only after the runner is wired)
- Modify: `rescue-backend/init.sql` (fresh-install schema and hashed demo passwords only)

**Interfaces:**
- Produces: `createPool(env)`, `runMigrations(pool, migrations)`, and migration objects `{ version, up(db) }`.
- Produces schema required by Tasks 3–12.
- Consumes: `mysql2/promise`.

- [ ] **Step 1: Write a failing migration-runner test with a fake database**

```js
// rescue-backend/test/unit/migrate.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { runMigrations } = require('../../src/db/migrate');

test('runMigrations applies unapplied versions once and records success', async () => {
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push([sql.replace(/\s+/g, ' ').trim(), params]);
      if (sql.includes('SELECT version')) return [[{ version: '001' }]];
      return [[]];
    },
  };
  const migrations = [
    { version: '001', up: async () => calls.push(['old']) },
    { version: '002', up: async () => calls.push(['new']) },
  ];

  await runMigrations(db, migrations);

  assert.equal(calls.some(([name]) => name === 'old'), false);
  assert.equal(calls.some(([name]) => name === 'new'), true);
  assert.equal(calls.some(([sql]) => sql.startsWith('INSERT INTO schema_migrations')), true);
});
```

- [ ] **Step 2: Run it and confirm the module is missing**

Run: `cd rescue-backend && node --test test/unit/migrate.test.js`
Expected: FAIL with `Cannot find module '../../src/db/migrate'`.

- [ ] **Step 3: Implement pool creation and the migration runner**

```js
// rescue-backend/src/db/createPool.js
const mysql = require('mysql2/promise');

function createPool(env = process.env) {
  return mysql.createPool({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
  });
}

module.exports = { createPool };
```

```js
// rescue-backend/src/db/migrate.js
async function runMigrations(db, migrations) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(100) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const [rows] = await db.query('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.version));
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    await migration.up(db);
    await db.query('INSERT INTO schema_migrations (version) VALUES (?)', [migration.version]);
  }
}

module.exports = { runMigrations };
```

- [ ] **Step 4: Add the schema migration using explicit information-schema checks**

```js
// rescue-backend/src/db/migrations/001-reliable-tracking.js
async function columnExists(db, table, column) {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column],
  );
  return rows.length > 0;
}

async function addColumn(db, table, column, definition) {
  if (!(await columnExists(db, table, column))) {
    await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

async function indexExists(db, table, indexName) {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
    [table, indexName],
  );
  return rows.length > 0;
}

module.exports = {
  version: '001-reliable-tracking',
  async up(db) {
    await db.query(`CREATE TABLE IF NOT EXISTS citizens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      line_uid VARCHAR(100) NOT NULL UNIQUE,
      display_name VARCHAR(255) NULL,
      phone VARCHAR(20) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS chat_messages (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      incident_id INT NOT NULL,
      sender VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
    )`);
    await addColumn(db, 'incidents', 'report_action_id', 'CHAR(36) NULL UNIQUE');
    await addColumn(db, 'incidents', 'citizen_token_hash', 'CHAR(64) NULL');
    await addColumn(db, 'incidents', 'location_accuracy_m', 'DECIMAL(8,2) NULL');
    await addColumn(db, 'incidents', 'landmark', 'VARCHAR(255) NULL');
    await addColumn(db, 'incidents', 'reported_at', 'TIMESTAMP NULL');
    await addColumn(db, 'incidents', 'search_started_at', 'TIMESTAMP NULL');
    await addColumn(db, 'incidents', 'accepted_at', 'TIMESTAMP NULL');
    await addColumn(db, 'incidents', 'arrived_at', 'TIMESTAMP NULL');
    await addColumn(db, 'incidents', 'completed_at', 'TIMESTAMP NULL');
    await addColumn(db, 'incidents', 'cancelled_at', 'TIMESTAMP NULL');
    await addColumn(db, 'incidents', 'citizen_id', 'INT NULL');
    await addColumn(db, 'incidents', 'citizen_phone', 'VARCHAR(20) NULL');
    await addColumn(db, 'incidents', 'parent_incident_id', 'INT NULL');
    await addColumn(db, 'incidents', 'cancel_reason', 'VARCHAR(255) NULL');
    await addColumn(db, 'users', 'phone', 'VARCHAR(20) NULL');
    await addColumn(db, 'users', 'is_approved', 'BOOLEAN NOT NULL DEFAULT TRUE');
    await db.query('UPDATE incidents SET reported_at = COALESCE(reported_at, created_at)');
    await db.query('ALTER TABLE incidents MODIFY status VARCHAR(32) NOT NULL');
    await db.query(`UPDATE incidents SET status = CASE status
      WHEN 'Pending' THEN 'REPORTED'
      WHEN 'Accepted' THEN 'EN_ROUTE'
      WHEN 'Resolved' THEN 'COMPLETED'
      ELSE status END`);
    await db.query("ALTER TABLE incidents MODIFY status ENUM('REPORTED','SEARCHING','EN_ROUTE','ARRIVED','COMPLETED','NO_UNIT_AVAILABLE','CANCELLED') NOT NULL DEFAULT 'REPORTED'");
    await db.query('ALTER TABLE incidents MODIFY latitude DECIMAL(10,8) NULL, MODIFY longitude DECIMAL(11,8) NULL');
    await db.query(`CREATE TABLE IF NOT EXISTS incident_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      incident_id INT NOT NULL,
      event_type VARCHAR(64) NOT NULL,
      from_status VARCHAR(32) NULL,
      to_status VARCHAR(32) NULL,
      actor_type VARCHAR(32) NOT NULL,
      actor_id INT NULL,
      client_action_id CHAR(36) NULL,
      correlation_id CHAR(36) NOT NULL,
      metadata JSON NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_incident_action (incident_id, client_action_id),
      INDEX ix_incident_events_time (incident_id, created_at),
      FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS incident_attachments (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      incident_id INT NOT NULL,
      mime_type VARCHAR(32) NOT NULL,
      byte_size INT NOT NULL,
      content MEDIUMBLOB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_incident_attachment (incident_id),
      FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
    )`);
    await addColumn(db, 'chat_messages', 'actor_type', "VARCHAR(32) NOT NULL DEFAULT 'SYSTEM'");
    await addColumn(db, 'chat_messages', 'actor_id', 'INT NULL');
    await addColumn(db, 'chat_messages', 'client_message_id', 'CHAR(36) NULL');
    if (!(await indexExists(db, 'chat_messages', 'uq_chat_client_message'))) {
      await db.query('CREATE UNIQUE INDEX uq_chat_client_message ON chat_messages (incident_id, client_message_id)');
    }
    if (await columnExists(db, 'incidents', 'citizen_token')) {
      await db.query('ALTER TABLE incidents DROP COLUMN citizen_token');
    }
  },
  _test: { columnExists, addColumn, indexExists },
};
```

- [ ] **Step 5: Add a migration test for idempotent column creation**

Extend `rescue-backend/test/unit/migrate.test.js` with a fake `information_schema` response and assert that existing columns do not issue `ALTER TABLE`, while missing columns do. Export `columnExists` and `addColumn` under `_test` from the migration file solely for this test.

```js
const migration = require('../../src/db/migrations/001-reliable-tracking');

test('migration helpers do not suppress unexpected DDL errors', async () => {
  const db = { query: async (sql) => {
    if (sql.includes('information_schema.columns')) return [[]];
    throw new Error('DDL failed');
  }};
  await assert.rejects(() => migration._test.addColumn(db, 'incidents', 'x', 'INT'), /DDL failed/);
});
```

- [ ] **Step 6: Wire migration startup and remove silent auto-migrations**

At startup, call the runner before accepting traffic:

```js
const { createPool } = require('./src/db/createPool');
const { runMigrations } = require('./src/db/migrate');
const reliableTrackingMigration = require('./src/db/migrations/001-reliable-tracking');

const pool = createPool();
await runMigrations(pool, [reliableTrackingMigration]);
```

Delete every startup `pool.query('ALTER TABLE ...').catch(() => {})` and startup `CREATE TABLE ... .catch(() => {})` after the equivalent definitions exist in `init.sql` and the migration. Do not delete data-manipulation helpers yet.

Remove `CREATE DATABASE ...` and `USE ...` from `init.sql`; Docker already selects `MYSQL_DATABASE`, so the same file safely initializes `rescue_db` in development and `rescue_test` in integration tests. Update its table definitions to the final columns/enums above and replace plaintext demo inserts with no user inserts; Tasks 10 and 12 create bcrypt-hashed accounts through code.

- [ ] **Step 7: Verify a fresh database and an existing database**

Run:

```bash
cd rescue-backend
docker compose up -d mysql redis
npm test
node -e "require('dotenv').config(); const {createPool}=require('./src/db/createPool'); const {runMigrations}=require('./src/db/migrate'); const m=require('./src/db/migrations/001-reliable-tracking'); (async()=>{const p=createPool(); await runMigrations(p,[m]); await runMigrations(p,[m]); await p.end();})().catch(e=>{console.error(e);process.exit(1)})"
```

Expected: tests PASS; the migration command exits `0` twice; `schema_migrations` contains one `001-reliable-tracking` row. Existing history rows retain their mapped states, while any active legacy citizen capability is intentionally invalidated because plaintext `citizen_token` is removed; run the guarded demo reset before presenting.

- [ ] **Step 8: Commit the schema boundary**

```bash
git add rescue-backend/src/db rescue-backend/test/unit/migrate.test.js rescue-backend/server.js rescue-backend/init.sql
git commit -m "feat: add versioned reliable tracking schema"
```

---

### Task 3: Implement canonical lifecycle, stable errors, and event idempotency

**Files:**
- Create: `rescue-backend/src/domain/errors.js`
- Create: `rescue-backend/src/domain/incidentLifecycle.js`
- Create: `rescue-backend/test/unit/incidentLifecycle.test.js`
- Create: `rescue-backend/src/repositories/eventRepository.js`
- Create: `rescue-backend/test/unit/eventRepository.test.js`

**Interfaces:**
- Produces: `AppError(code, status, message, details)`, `STATES`, `assertTransition({ from, to, actorRole, ownsIncident })`.
- Produces: `createEventRepository(pool).append(event)` and `.findByAction(incidentId, clientActionId)`.
- Consumes: schema from Task 2.

- [ ] **Step 1: Write the failing lifecycle matrix tests**

```js
// rescue-backend/test/unit/incidentLifecycle.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertTransition, STATES } = require('../../src/domain/incidentLifecycle');

test('assigned rescuer may progress en-route to arrived to completed', () => {
  assert.doesNotThrow(() => assertTransition({ from: STATES.EN_ROUTE, to: STATES.ARRIVED, actorRole: 'RESCUE', ownsIncident: true }));
  assert.doesNotThrow(() => assertTransition({ from: STATES.ARRIVED, to: STATES.COMPLETED, actorRole: 'RESCUE', ownsIncident: true }));
});

test('unassigned rescuer and citizen cannot progress an accepted incident', () => {
  assert.throws(
    () => assertTransition({ from: STATES.EN_ROUTE, to: STATES.ARRIVED, actorRole: 'RESCUE', ownsIncident: false }),
    (error) => error.code === 'FORBIDDEN',
  );
  assert.throws(
    () => assertTransition({ from: STATES.EN_ROUTE, to: STATES.COMPLETED, actorRole: 'CITIZEN', ownsIncident: true }),
    (error) => error.code === 'INVALID_TRANSITION',
  );
});

test('citizen cancellation is limited to reported or searching', () => {
  assert.doesNotThrow(() => assertTransition({ from: STATES.SEARCHING, to: STATES.CANCELLED, actorRole: 'CITIZEN', ownsIncident: true }));
  assert.throws(
    () => assertTransition({ from: STATES.EN_ROUTE, to: STATES.CANCELLED, actorRole: 'CITIZEN', ownsIncident: true }),
    (error) => error.code === 'INVALID_TRANSITION',
  );
});
```

- [ ] **Step 2: Run the lifecycle tests and confirm the missing module failure**

Run: `cd rescue-backend && node --test test/unit/incidentLifecycle.test.js`
Expected: FAIL with `Cannot find module '../../src/domain/incidentLifecycle'`.

- [ ] **Step 3: Implement stable errors and the complete transition matrix**

```js
// rescue-backend/src/domain/errors.js
class AppError extends Error {
  constructor(code, status, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

module.exports = { AppError };
```

```js
// rescue-backend/src/domain/incidentLifecycle.js
const { AppError } = require('./errors');

const STATES = Object.freeze({
  REPORTED: 'REPORTED', SEARCHING: 'SEARCHING', EN_ROUTE: 'EN_ROUTE',
  ARRIVED: 'ARRIVED', COMPLETED: 'COMPLETED',
  NO_UNIT_AVAILABLE: 'NO_UNIT_AVAILABLE', CANCELLED: 'CANCELLED',
});

const NEXT = Object.freeze({
  REPORTED: new Set(['SEARCHING', 'CANCELLED']),
  SEARCHING: new Set(['EN_ROUTE', 'NO_UNIT_AVAILABLE', 'CANCELLED']),
  EN_ROUTE: new Set(['ARRIVED', 'CANCELLED']),
  ARRIVED: new Set(['COMPLETED', 'CANCELLED']),
  NO_UNIT_AVAILABLE: new Set(['SEARCHING', 'CANCELLED']),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
});

function assertTransition({ from, to, actorRole, ownsIncident }) {
  if (!NEXT[from]?.has(to)) throw new AppError('INVALID_TRANSITION', 409, 'ไม่สามารถเปลี่ยนสถานะนี้ได้');
  if (actorRole === 'ADMIN') return;
  if (!ownsIncident) throw new AppError('FORBIDDEN', 403, 'ไม่มีสิทธิ์ดำเนินการ');
  if (actorRole === 'CITIZEN' && !(['REPORTED', 'SEARCHING'].includes(from) && to === 'CANCELLED')) {
    throw new AppError('INVALID_TRANSITION', 409, 'ผู้แจ้งเหตุเปลี่ยนสถานะนี้ไม่ได้');
  }
  if (actorRole === 'RESCUE' && !(
    (from === 'EN_ROUTE' && to === 'ARRIVED') ||
    (from === 'ARRIVED' && to === 'COMPLETED')
  )) throw new AppError('INVALID_TRANSITION', 409, 'หน่วยกู้ภัยเปลี่ยนสถานะนี้ไม่ได้');
}

module.exports = { STATES, NEXT, assertTransition };
```

- [ ] **Step 4: Write a failing event-repository idempotency test**

```js
// rescue-backend/test/unit/eventRepository.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEventRepository } = require('../../src/repositories/eventRepository');

test('append serializes metadata and returns the committed event', async () => {
  const pool = { query: async (_sql, params) => [{ insertId: 9 }, params] };
  const repository = createEventRepository(pool);
  const event = await repository.append({
    incidentId: 4, type: 'ARRIVED', from: 'EN_ROUTE', to: 'ARRIVED',
    actorType: 'RESCUE', actorId: 2, clientActionId: '00000000-0000-4000-8000-000000000001',
    correlationId: '00000000-0000-4000-8000-000000000002', metadata: { source: 'mobile' },
  });
  assert.equal(event.id, 9);
  assert.deepEqual(event.metadata, { source: 'mobile' });
});
```

- [ ] **Step 5: Implement the event repository**

```js
// rescue-backend/src/repositories/eventRepository.js
function createEventRepository(db) {
  return {
    async findByAction(incidentId, clientActionId) {
      if (!clientActionId) return null;
      const [rows] = await db.query(
        'SELECT * FROM incident_events WHERE incident_id = ? AND client_action_id = ? LIMIT 1',
        [incidentId, clientActionId],
      );
      return rows[0] || null;
    },
    async append(event, connection = db) {
      const [result] = await connection.query(
        `INSERT INTO incident_events
         (incident_id,event_type,from_status,to_status,actor_type,actor_id,client_action_id,correlation_id,metadata)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [event.incidentId, event.type, event.from, event.to, event.actorType, event.actorId || null,
          event.clientActionId || null, event.correlationId, JSON.stringify(event.metadata || {})],
      );
      return { id: result.insertId, ...event };
    },
  };
}

module.exports = { createEventRepository };
```

- [ ] **Step 6: Run focused and full backend tests**

Run: `cd rescue-backend && node --test test/unit/incidentLifecycle.test.js test/unit/eventRepository.test.js && npm test`
Expected: all tests PASS.

- [ ] **Step 7: Commit the domain contract**

```bash
git add rescue-backend/src/domain rescue-backend/src/repositories/eventRepository.js rescue-backend/test/unit/incidentLifecycle.test.js rescue-backend/test/unit/eventRepository.test.js
git commit -m "feat: define auditable incident lifecycle"
```

---

### Task 4: Build incident reporting, snapshots, transitions, and REST error handling

**Files:**
- Create: `rescue-backend/src/repositories/incidentRepository.js`
- Create: `rescue-backend/src/db/transaction.js`
- Create: `rescue-backend/src/services/incidentService.js`
- Create: `rescue-backend/src/domain/validation.js`
- Create: `rescue-backend/src/http/routes/incidentRoutes.js`
- Create: `rescue-backend/src/http/createApp.js`
- Create: `rescue-backend/src/http/errorMiddleware.js`
- Create: `rescue-backend/test/unit/incidentService.test.js`
- Create: `rescue-backend/test/unit/validation.test.js`
- Create: `rescue-backend/test/unit/errorMiddleware.test.js`
- Modify: `rescue-backend/server.js` (mount new incident routes; remove replaced handlers)

**Interfaces:**
- Produces: `createTransactionRunner(pool)` and `createIncidentService({ transaction, incidents, events, randomUUID, issueIncidentToken, hashIncidentToken, publishIncident })` with `report`, `snapshot`, `transition`, and `cancel`; `publishIncident` runs only after commit.
- Produces: `createIncidentRoutes({ incidentService, dispatchService, chatService, attachmentService, reportLimiter, mediaLimiter, optionalCitizen, requireCitizenIncident, requireIncidentActor, requireStaff })` after Task 11 adds degraded dispatch startup.
- Consumes: lifecycle and event repository from Task 3; schema from Task 2.

- [ ] **Step 0: Test and implement report validation before repository work**

```js
// rescue-backend/test/unit/validation.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReportInput, requireActionId } = require('../../src/domain/validation');
test('report validation rejects invalid coordinates, accuracy, and long text', () => {
  assert.throws(() => validateReportInput({ reportActionId: '00000000-0000-4000-8000-000000000001', latitude: 91, longitude: 181, accuracy: -1, details: 'x'.repeat(2001) }),
    (error) => error.code === 'INVALID_LOCATION');
});
test('all mutation retry keys must be UUIDs', () => {
  assert.throws(() => requireActionId('predictable-id'), (error) => error.code === 'INVALID_ACTION_ID');
});
test('report validation rejects a malformed phone number', () => {
  assert.throws(() => validateReportInput({ reportActionId: '00000000-0000-4000-8000-000000000001',
    latitude: 13.7, longitude: 100.5, accuracy: 8, citizenPhone: 'call-me' }),
  (error) => error.code === 'INVALID_LOCATION');
});
```

Run: `cd rescue-backend && node --test test/unit/validation.test.js`
Expected: FAIL with `Cannot find module '../../src/domain/validation'`.

```js
// rescue-backend/src/domain/validation.js
const { AppError } = require('./errors');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requireActionId(value) {
  if (!UUID.test(String(value || ''))) throw new AppError('INVALID_ACTION_ID', 400, 'รหัสคำสั่งไม่ถูกต้อง');
  return value;
}
function validateReportInput(value) {
  requireActionId(value.reportActionId);
  const latitude = Number(value.latitude); const longitude = Number(value.longitude); const accuracy = Number(value.accuracy);
  const phone = String(value.citizenPhone || '').trim();
  const valid = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 5_000 &&
    String(value.details || '').length <= 2_000 && String(value.landmark || '').length <= 255 &&
    (!phone || /^\+?[0-9][0-9 -]{7,18}$/.test(phone));
  if (!valid) throw new AppError('INVALID_LOCATION', 400, 'ข้อมูลพิกัดหรือรายละเอียดไม่ถูกต้อง');
  return { ...value, latitude, longitude, accuracy, citizenPhone: phone || null };
}
module.exports = { validateReportInput, requireActionId };
```

Call `validateReportInput(input)` as the first line of `incidentService.report` and use the returned normalized value for persistence.

- [ ] **Step 1: Write failing service tests for report idempotency and commit-before-emit data**

```js
// rescue-backend/test/unit/incidentService.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createIncidentService } = require('../../src/services/incidentService');

function fixtures() {
  const rows = new Map();
  let createdInput;
  const incidents = {
    findByReportAction: async (id) => rows.get(id) || null,
    create: async (input) => { createdInput = input; const value = { id: 41, status: 'REPORTED', ...input }; rows.set(input.reportActionId, value); return value; },
    findById: async () => rows.values().next().value,
  };
  const events = [];
  return { incidents, eventRepository: { findByAction: async () => null, append: async (event) => { events.push(event); return event; } },
    events, getCreatedInput: () => createdInput };
}

test('report returns the same incident for a repeated reportActionId', async () => {
  const f = fixtures();
  const service = createIncidentService({
    incidents: f.incidents, events: f.eventRepository,
    transaction: async (work) => work({}),
    randomUUID: () => '00000000-0000-4000-8000-000000000099',
    issueIncidentToken: (id) => `token:${id}`,
    hashIncidentToken: (value) => `hash:${value}`,
  });
  const input = { reportActionId: '00000000-0000-4000-8000-000000000001', latitude: 13.7, longitude: 100.5, accuracy: 12, details: 'test' };
  const first = await service.report(input, { type: 'CITIZEN', id: null });
  const second = await service.report(input, { type: 'CITIZEN', id: null });
  assert.equal(first.incident.id, second.incident.id);
  assert.equal(f.events.length, 1);
  assert.equal(first.citizenToken, second.citizenToken);
  assert.equal(first.citizenToken, `token:${input.reportActionId}`);
  assert.equal(f.getCreatedInput().citizenTokenHash, `hash:token:${input.reportActionId}`);
  await assert.rejects(
    () => service.cancel({ id: 41, actor: { role: 'CITIZEN', incidentId: 41 }, clientActionId: 'cancel', reason: '' }),
    (error) => error.code === 'INVALID_REASON',
  );
});

test('transition publishes the canonical snapshot only after the transaction commits', async () => {
  const order = []; let row = { id: 41, status: 'EN_ROUTE', assigned_user_id: 8 };
  const service = createIncidentService({
    incidents: { findById: async () => row, updateStatus: async () => { row = { ...row, status: 'ARRIVED' }; return true; } },
    events: { findByAction: async () => null, append: async (event) => event },
    transaction: async (work) => { const value = await work({}); order.push('commit'); return value; },
    randomUUID: () => '00000000-0000-4000-8000-000000000099',
    issueIncidentToken: () => 'unused', hashIncidentToken: () => 'unused',
    publishIncident: async (incident) => { order.push(`publish:${incident.status}`); },
  });
  await service.transition({ id: 41, to: 'ARRIVED', actor: { role: 'RESCUE', id: 8 },
    clientActionId: '00000000-0000-4000-8000-000000000002' });
  assert.deepEqual(order, ['commit', 'publish:ARRIVED']);
});
```

- [ ] **Step 2: Run the focused test and observe the missing service failure**

Run: `cd rescue-backend && node --test test/unit/incidentService.test.js`
Expected: FAIL with `Cannot find module '../../src/services/incidentService'`.

- [ ] **Step 3: Implement the transaction runner and incident repository primitives**

```js
// rescue-backend/src/db/transaction.js
function createTransactionRunner(pool) {
  return async (work) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  };
}

module.exports = { createTransactionRunner };
```

```js
// rescue-backend/src/repositories/incidentRepository.js
function createIncidentRepository(pool) {
  const repository = {
    async findByReportAction(reportActionId, db = pool) {
      const [rows] = await db.query('SELECT * FROM incidents WHERE report_action_id = ? LIMIT 1', [reportActionId]);
      return rows[0] || null;
    },
    async findById(id, db = pool) {
      const [rows] = await db.query(
        `SELECT i.*,u.username AS driver_name,u.phone AS driver_phone
         FROM incidents i LEFT JOIN users u ON u.id = i.assigned_user_id WHERE i.id = ? LIMIT 1`,
        [id],
      );
      return rows[0] || null;
    },
    async create(input, db = pool) {
      const [result] = await db.query(
        `INSERT INTO incidents
         (report_action_id,details,latitude,longitude,location_accuracy_m,landmark,status,citizen_phone,citizen_id,citizen_token_hash)
         VALUES (?,?,?,?,?,?,'REPORTED',?,?,?)`,
        [input.reportActionId, input.details, input.latitude, input.longitude, input.accuracy,
          input.landmark || null, input.citizenPhone || null, input.citizenId || null, input.citizenTokenHash],
      );
      return repository.findById(result.insertId, db);
    },
    async updateStatus(id, from, to, timestampColumn, db = pool) {
      const sql = `UPDATE incidents SET status = ?, \`${timestampColumn}\` = CURRENT_TIMESTAMP WHERE id = ? AND status = ?`;
      const [result] = await db.query(sql, [to, id, from]);
      return result.affectedRows === 1;
    },
  };
  return repository;
}

module.exports = { createIncidentRepository };
```

- [ ] **Step 4: Implement incident reporting and transition orchestration**

```js
// rescue-backend/src/services/incidentService.js
const { AppError } = require('../domain/errors');
const { assertTransition } = require('../domain/incidentLifecycle');
const { validateReportInput, requireActionId } = require('../domain/validation');

const toSnapshot = (incident) => ({
  id: incident.id, status: incident.status, details: incident.details,
  latitude: incident.latitude, longitude: incident.longitude,
  location_accuracy_m: incident.location_accuracy_m, landmark: incident.landmark,
  assigned_user_id: incident.assigned_user_id,
  driver_name: incident.driver_name, driver_phone: incident.driver_phone,
  parent_incident_id: incident.parent_incident_id,
  reported_at: incident.reported_at || incident.created_at,
  search_started_at: incident.search_started_at, accepted_at: incident.accepted_at,
  arrived_at: incident.arrived_at, completed_at: incident.completed_at,
  cancelled_at: incident.cancelled_at, cancel_reason: incident.cancel_reason,
});

function createIncidentService({ transaction, incidents, events, randomUUID, issueIncidentToken, hashIncidentToken, publishIncident = async () => {} }) {
  return {
    async report(input, actor) {
      const validInput = validateReportInput(input);
      const citizenToken = issueIncidentToken(validInput.reportActionId);
      try {
        return await transaction(async (db) => {
          const existing = await incidents.findByReportAction(validInput.reportActionId, db);
          if (existing) return { incident: toSnapshot(existing), citizenToken, replayed: true };
          const incident = await incidents.create({ ...validInput, citizenId: actor.id, citizenTokenHash: hashIncidentToken(citizenToken) }, db);
          await events.append({
            incidentId: incident.id, type: 'REPORTED', from: null, to: 'REPORTED',
            actorType: actor.type, actorId: actor.id, clientActionId: validInput.reportActionId,
            correlationId: randomUUID(), metadata: { accuracy: validInput.accuracy },
          }, db);
          return { incident: toSnapshot(incident), citizenToken, replayed: false };
        });
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        const existing = await incidents.findByReportAction(validInput.reportActionId);
        return { incident: toSnapshot(existing), citizenToken, replayed: true };
      }
    },
    async snapshot(id) {
      const incident = await incidents.findById(id);
      if (!incident) throw new AppError('FORBIDDEN', 403, 'ไม่สามารถเข้าถึงเหตุนี้ได้');
      return toSnapshot(incident);
    },
    async transition({ id, to, actor, clientActionId, reason }) {
      requireActionId(clientActionId);
      const result = await transaction(async (db) => {
        const prior = await events.findByAction(id, clientActionId, db);
        if (prior) {
          const sameRole = prior.actor_type === actor.role;
          const sameActor = prior.actor_id == null ? actor.id == null : Number(prior.actor_id) === Number(actor.id);
          if (!sameRole || !sameActor) throw new AppError('FORBIDDEN', 403, 'รหัสคำสั่งนี้เป็นของผู้ใช้อื่น');
          return { replayed: true, event: prior };
        }
        const incident = await incidents.findById(id, db);
        if (!incident) throw new AppError('FORBIDDEN', 403, 'ไม่สามารถเข้าถึงเหตุนี้ได้');
        const ownsIncident = actor.role === 'ADMIN' || Number(incident.assigned_user_id) === Number(actor.id) || actor.incidentId === id;
        assertTransition({ from: incident.status, to, actorRole: actor.role, ownsIncident });
        const column = { SEARCHING: 'search_started_at', ARRIVED: 'arrived_at', COMPLETED: 'completed_at', CANCELLED: 'cancelled_at' }[to];
        const changed = await incidents.updateStatus(id, incident.status, to, column, db);
        if (!changed) throw new AppError('ASSIGNMENT_CONFLICT', 409, 'สถานะเหตุถูกเปลี่ยนแล้ว');
        const event = await events.append({ incidentId: id, type: to, from: incident.status, to,
          actorType: actor.role, actorId: actor.id, clientActionId, correlationId: randomUUID(), metadata: { reason } }, db);
        return { replayed: false, event };
      });
      const incident = toSnapshot(await incidents.findById(id));
      await publishIncident(incident);
      return { ...result, incident };
    },
    cancel(input) {
      const reason = String(input.reason || '').trim();
      if (reason.length < 3 || reason.length > 255) throw new AppError('INVALID_REASON', 400, 'กรุณาระบุเหตุผล');
      return this.transition({ ...input, reason, to: 'CANCELLED' });
    },
  };
}

module.exports = { createIncidentService, toSnapshot };
```

- [ ] **Step 5: Add stable HTTP error output tests and middleware**

```js
// rescue-backend/test/unit/errorMiddleware.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { toErrorBody } = require('../../src/http/errorMiddleware');
const { AppError } = require('../../src/domain/errors');

test('toErrorBody exposes AppError code but never stack', () => {
  const result = toErrorBody(new AppError('FORBIDDEN', 403, 'ไม่มีสิทธิ์'));
  assert.deepEqual(result, { status: 403, body: { error: { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์' } } });
});

test('toErrorBody hides unexpected database details', () => {
  const result = toErrorBody(new Error('ER_ACCESS_DENIED secret'));
  assert.deepEqual(result, { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'ระบบขัดข้อง กรุณาลองใหม่' } } });
});

test('toErrorBody maps typed database connectivity failures to a redacted 503', () => {
  const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1'), { code: 'ECONNREFUSED' });
  assert.deepEqual(toErrorBody(error), {
    status: 503, body: { error: { code: 'DATABASE_UNAVAILABLE', message: 'ฐานข้อมูลไม่พร้อม กรุณาลองใหม่' } },
  });
});
```

```js
// rescue-backend/src/http/errorMiddleware.js
function toErrorBody(error) {
  if (error.code && error.status) return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  if (['ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ETIMEDOUT'].includes(error.code)) {
    return { status: 503, body: { error: { code: 'DATABASE_UNAVAILABLE', message: 'ฐานข้อมูลไม่พร้อม กรุณาลองใหม่' } } };
  }
  return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'ระบบขัดข้อง กรุณาลองใหม่' } } };
}

function errorMiddleware(error, req, res, _next) {
  req.log?.error?.({ error: error.name, correlationId: req.correlationId });
  const result = toErrorBody(error);
  res.status(result.status).json(result.body);
}

module.exports = { toErrorBody, errorMiddleware };
```

- [ ] **Step 6: Mount report, snapshot, transition, and cancellation routes**

```js
// rescue-backend/src/http/routes/incidentRoutes.js
const express = require('express');

function createIncidentRoutes({ incidentService, dispatchService, chatService, attachmentService, reportLimiter, mediaLimiter, optionalCitizen, requireCitizenIncident, requireIncidentActor, requireStaff }) {
  const router = express.Router();
  router.post('/', reportLimiter, optionalCitizen, async (req, res, next) => {
    try {
      const input = {
        reportActionId: req.body.report_action_id,
        details: req.body.details,
        latitude: Number(req.body.latitude), longitude: Number(req.body.longitude),
        accuracy: Number(req.body.location_accuracy_m), landmark: req.body.landmark,
        citizenPhone: req.body.citizen_phone,
      };
      const result = await incidentService.report(input, req.citizen || { type: 'CITIZEN', id: null });
      res.status(result.replayed ? 200 : 201).json({ incident: result.incident, citizen_token: result.citizenToken });
    } catch (error) { next(error); }
  });
  router.get('/:id', optionalCitizen, requireCitizenIncident, async (req, res, next) => {
    try { res.json(await incidentService.snapshot(Number(req.params.id))); } catch (error) { next(error); }
  });
  router.post('/:id/status', requireStaff, async (req, res, next) => {
    try { res.json(await incidentService.transition({ id: Number(req.params.id), to: req.body.status,
      actor: req.actor, clientActionId: req.body.client_action_id, reason: req.body.reason })); }
    catch (error) { next(error); }
  });
  router.post('/:id/cancel', optionalCitizen, requireCitizenIncident, async (req, res, next) => {
    try { res.json(await incidentService.cancel({ id: Number(req.params.id), actor: { role: 'CITIZEN', id: req.citizen?.id, incidentId: Number(req.params.id) },
      clientActionId: req.body.client_action_id, reason: req.body.reason })); }
    catch (error) { next(error); }
  });
  return router;
}

module.exports = { createIncidentRoutes };
```

Keep compatibility wrappers for old status/chat URLs for one task only; make them call the same service and mark them for deletion in Task 12.

- [ ] **Step 7: Run tests and commit the REST incident slice**

Run: `cd rescue-backend && node --test test/unit/validation.test.js test/unit/incidentService.test.js test/unit/errorMiddleware.test.js && npm test`
Expected: all tests PASS.

```bash
git add rescue-backend/src/db/transaction.js rescue-backend/src/domain/validation.js rescue-backend/src/repositories/incidentRepository.js rescue-backend/src/services/incidentService.js rescue-backend/src/http rescue-backend/test/unit/validation.test.js rescue-backend/test/unit/incidentService.test.js rescue-backend/test/unit/errorMiddleware.test.js rescue-backend/server.js
git commit -m "feat: add canonical incident REST workflow"
```

---
### Task 5: Verify LIFF identity and enforce incident capability access

**Files:**
- Create: `rescue-backend/src/services/citizenAuthService.js`
- Create: `rescue-backend/src/repositories/citizenRepository.js`
- Create: `rescue-backend/src/repositories/staffRepository.js`
- Create: `rescue-backend/src/services/staffAuthService.js`
- Create: `rescue-backend/src/http/middleware/auth.js`
- Create: `rescue-backend/src/http/routes/authRoutes.js`
- Create: `rescue-backend/test/unit/citizenAuthService.test.js`
- Create: `rescue-backend/test/unit/staffAuthService.test.js`
- Create: `rescue-backend/test/unit/authMiddleware.test.js`
- Modify: `rescue-backend/src/http/routes/incidentRoutes.js`
- Modify: `rescue-backend/server.js` (replace raw `line_uid` authentication and token query parameters)

**Interfaces:**
- Produces: `createCitizenAuthService({ citizens, jwtSecret, incidentTokenSecret, verifyLineIdToken })` with `authenticateLiff(idToken)`, `issueSession(citizen)`, `issueIncidentToken(reportActionId)`, and `hashIncidentToken(token)`.
- Produces: `createStaffAuthService({ staff, verifyPassword, jwtSecret }).login(username, password)`.
- Produces: `createAuthMiddleware({ jwtSecret, incidentRepository, hashIncidentToken })` with `requireStaff`, `optionalCitizen`, `requireCitizenIncident`, and `requireIncidentActor`.
- Consumes: incident repository from Task 4 and existing `jsonwebtoken`.

- [ ] **Step 1: Write failing tests that reject raw LINE identity and make incident tokens replayable**

```js
// rescue-backend/test/unit/citizenAuthService.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCitizenAuthService } = require('../../src/services/citizenAuthService');

test('authenticateLiff trusts the verified LINE subject, not client profile fields', async () => {
  const citizens = { upsertLineCitizen: async (profile) => ({ id: 7, ...profile }) };
  const service = createCitizenAuthService({
    citizens,
    jwtSecret: 'staff-and-citizen-test-secret',
    incidentTokenSecret: 'incident-test-secret',
    verifyLineIdToken: async (token) => {
      assert.equal(token, 'real-id-token');
      return { sub: 'U_verified', name: 'Verified Name' };
    },
  });
  const result = await service.authenticateLiff('real-id-token');
  assert.equal(result.citizen.line_uid, 'U_verified');
  assert.match(result.sessionToken, /^[\w-]+\.[\w-]+\.[\w-]+$/);
});

test('incident token is deterministic for one report retry and stored only as a hash', () => {
  const service = createCitizenAuthService({
    citizens: {}, jwtSecret: 'jwt', incidentTokenSecret: 'incident', verifyLineIdToken: async () => ({}),
  });
  const token1 = service.issueIncidentToken('00000000-0000-4000-8000-000000000001');
  const token2 = service.issueIncidentToken('00000000-0000-4000-8000-000000000001');
  assert.equal(token1, token2);
  assert.notEqual(service.hashIncidentToken(token1), token1);
});
```

- [ ] **Step 2: Run the test and confirm the missing service failure**

Run: `cd rescue-backend && node --test test/unit/citizenAuthService.test.js`
Expected: FAIL with `Cannot find module '../../src/services/citizenAuthService'`.

- [ ] **Step 3: Implement verified LIFF sessions and HMAC-derived incident tokens**

```js
// rescue-backend/src/services/citizenAuthService.js
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { AppError } = require('../domain/errors');

function createCitizenAuthService({ citizens, jwtSecret, incidentTokenSecret, verifyLineIdToken }) {
  const hash = (value, key) => crypto.createHmac('sha256', key).update(value).digest('hex');
  return {
    issueIncidentToken: (reportActionId) => hash(`incident:${reportActionId}`, incidentTokenSecret),
    hashIncidentToken: (token) => hash(token, incidentTokenSecret),
    issueSession(citizen) {
      return jwt.sign({ kind: 'citizen', sub: citizen.id }, jwtSecret, { audience: 'rescue-citizen', expiresIn: '12h' });
    },
    async authenticateLiff(idToken) {
      if (!idToken) throw new AppError('SESSION_EXPIRED', 401, 'กรุณาเข้าสู่ระบบ LINE ใหม่');
      let profile;
      try { profile = await verifyLineIdToken(idToken); }
      catch { throw new AppError('SESSION_EXPIRED', 401, 'ไม่สามารถยืนยัน LINE ได้'); }
      const citizen = await citizens.upsertLineCitizen({ line_uid: profile.sub, display_name: profile.name || null });
      return { citizen, sessionToken: this.issueSession(citizen) };
    },
  };
}

async function verifyLineIdTokenWithLine(idToken, channelId, fetchImpl = fetch) {
  const body = new URLSearchParams({ id_token: idToken, client_id: channelId });
  const response = await fetchImpl('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!response.ok) throw new Error('LINE token rejected');
  return response.json();
}

module.exports = { createCitizenAuthService, verifyLineIdTokenWithLine };
```

- [ ] **Step 4: Implement citizen persistence and wire token functions into Task 4**

```js
// rescue-backend/src/repositories/citizenRepository.js
function createCitizenRepository(db) {
  return {
    async upsertLineCitizen({ line_uid, display_name }) {
      await db.query(
        `INSERT INTO citizens (line_uid,display_name) VALUES (?,?)
         ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
        [line_uid, display_name],
      );
      const [rows] = await db.query('SELECT id,line_uid,display_name,phone FROM citizens WHERE line_uid = ?', [line_uid]);
      return rows[0];
    },
    async updatePhone(citizenId, phone) {
      await db.query('UPDATE citizens SET phone = ? WHERE id = ?', [phone, citizenId]);
    },
  };
}

module.exports = { createCitizenRepository };
```

Write the staff login test before implementation:

```js
// rescue-backend/test/unit/staffAuthService.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStaffAuthService } = require('../../src/services/staffAuthService');

test('approved staff receives a signed session and pending rescuer is forbidden', async () => {
  let current = { id: 4, username: 'unit-04', password: 'hash', role: 'Rescue', foundation_id: 1, is_approved: 1 };
  const service = createStaffAuthService({ staff: { findByUsername: async () => current }, verifyPassword: async () => true, jwtSecret: 'jwt-secret' });
  assert.match((await service.login('unit-04', 'correct')).token, /^[\w-]+\.[\w-]+\.[\w-]+$/);
  current = { ...current, is_approved: 0 };
  await assert.rejects(() => service.login('unit-04', 'correct'), (error) => error.code === 'FORBIDDEN');
});
```

Run: `cd rescue-backend && node --test test/unit/staffAuthService.test.js`
Expected: FAIL with `Cannot find module '../../src/services/staffAuthService'`.

Then implement:

```js
// rescue-backend/src/repositories/staffRepository.js
function createStaffRepository(db) {
  return {
    async findByUsername(username) {
      const [rows] = await db.query('SELECT id,username,password,role,foundation_id,phone,is_approved FROM users WHERE username = ? LIMIT 1', [username]);
      return rows[0] || null;
    },
  };
}
module.exports = { createStaffRepository };
```

```js
// rescue-backend/src/services/staffAuthService.js
const jwt = require('jsonwebtoken');
const { AppError } = require('../domain/errors');
function createStaffAuthService({ staff, verifyPassword, jwtSecret }) {
  return {
    async login(username, password) {
      const user = await staff.findByUsername(String(username || ''));
      if (!user || !(await verifyPassword(String(password || ''), user.password))) {
        throw new AppError('INVALID_CREDENTIALS', 401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      }
      if (user.role === 'Rescue' && !user.is_approved) throw new AppError('FORBIDDEN', 403, 'บัญชียังไม่ได้รับอนุมัติ');
      const token = jwt.sign({ id: user.id, role: user.role, foundation_id: user.foundation_id }, jwtSecret, { expiresIn: '12h' });
      return { token, user: { id: user.id, username: user.username, role: user.role, foundation_id: user.foundation_id, phone: user.phone } };
    },
  };
}
module.exports = { createStaffAuthService };
```

When composing services, pass the Task 5 functions directly into the Task 4 constructor:

```js
const incidentService = createIncidentService({
  transaction,
  incidents,
  events,
  randomUUID: crypto.randomUUID,
  issueIncidentToken: citizenAuthService.issueIncidentToken,
  hashIncidentToken: citizenAuthService.hashIncidentToken,
});
```

- [ ] **Step 5: Write failing middleware tests for header-based capability and server-derived staff identity**

```js
// rescue-backend/test/unit/authMiddleware.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthMiddleware } = require('../../src/http/middleware/auth');

test('requireCitizenIncident accepts X-Incident-Token and ignores query token', async () => {
  const middleware = createAuthMiddleware({
    jwtSecret: 'jwt', hashIncidentToken: (value) => `hash:${value}`,
    incidentRepository: { findById: async () => ({ id: 4, citizen_token_hash: 'hash:secret' }) },
  });
  const req = { params: { id: '4' }, headers: { 'x-incident-token': 'secret' }, query: { token: 'wrong' } };
  await new Promise((resolve, reject) => middleware.requireCitizenIncident(req, {}, (error) => error ? reject(error) : resolve()));
  assert.equal(req.citizenIncident.id, 4);
});

test('requireCitizenIncident returns the same forbidden code for missing and wrong access', async () => {
  const middleware = createAuthMiddleware({
    jwtSecret: 'jwt', hashIncidentToken: (value) => `hash:${value}`,
    incidentRepository: { findById: async () => null },
  });
  await assert.rejects(
    new Promise((resolve, reject) => middleware.requireCitizenIncident({ params: { id: '99' }, headers: {} }, {}, (error) => error ? reject(error) : resolve())),
    (error) => error.code === 'FORBIDDEN',
  );
});
```

- [ ] **Step 6: Implement REST authentication middleware**

```js
// rescue-backend/src/http/middleware/auth.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { AppError } = require('../../domain/errors');

const safeEqual = (left, right) => {
  const a = Buffer.from(left || ''); const b = Buffer.from(right || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

function createAuthMiddleware({ jwtSecret, incidentRepository, hashIncidentToken }) {
  const verifyBearer = (req) => {
    const value = req.headers.authorization || '';
    if (!value.startsWith('Bearer ')) throw new AppError('SESSION_EXPIRED', 401, 'กรุณาเข้าสู่ระบบใหม่');
    return jwt.verify(value.slice(7), jwtSecret);
  };
  return {
    requireStaff(req, _res, next) {
      try {
        const claims = verifyBearer(req);
        if (claims.kind === 'citizen') throw new Error('wrong audience');
        req.actor = { id: claims.id, role: String(claims.role).toUpperCase(), foundationId: claims.foundation_id };
        next();
      } catch { next(new AppError('SESSION_EXPIRED', 401, 'กรุณาเข้าสู่ระบบใหม่')); }
    },
    optionalCitizen(req, _res, next) {
      try {
        const claims = verifyBearer(req);
        req.citizen = claims.kind === 'citizen' ? { type: 'CITIZEN', id: Number(claims.sub) } : null;
      } catch { req.citizen = null; }
      next();
    },
    async requireCitizenIncident(req, _res, next) {
      try {
        const incident = await incidentRepository.findById(Number(req.params.id));
        const token = req.headers['x-incident-token'];
        const matchesToken = token && incident && safeEqual(hashIncidentToken(token), incident.citizen_token_hash);
        const matchesSession = req.citizen && incident && req.citizen.id === incident.citizen_id;
        if (!matchesToken && !matchesSession) throw new AppError('FORBIDDEN', 403, 'ไม่สามารถเข้าถึงเหตุนี้ได้');
        req.citizenIncident = incident;
        next();
      } catch (error) { next(error.code ? error : new AppError('FORBIDDEN', 403, 'ไม่สามารถเข้าถึงเหตุนี้ได้')); }
    },
  };
}

module.exports = { createAuthMiddleware };
```

- [ ] **Step 7: Add the verified citizen-session route and remove raw LINE UID writes**

```js
// rescue-backend/src/http/routes/authRoutes.js
const express = require('express');

function createAuthRoutes({ citizenAuthService, staffAuthService, publicWriteLimiter, loginLimiter }) {
  const router = express.Router();
  router.post('/login', loginLimiter, async (req, res, next) => {
    try { res.json(await staffAuthService.login(req.body.username, req.body.password)); }
    catch (error) { next(error); }
  });
  router.post('/citizen/session', publicWriteLimiter, async (req, res, next) => {
    try { res.json(await citizenAuthService.authenticateLiff(req.body.id_token)); }
    catch (error) { next(error); }
  });
  return router;
}

module.exports = { createAuthRoutes };
```

Remove `/api/citizen/auth` behaviour that accepts `{ line_uid, display_name }`. Change phone updates to require the citizen session and derive citizen ID from its JWT.

- [ ] **Step 8: Run security and auth suites, then commit**

Run: `cd rescue-backend && node --test test/unit/citizenAuthService.test.js test/unit/staffAuthService.test.js test/unit/authMiddleware.test.js test/unit/incidentService.test.js && npm test`
Expected: all tests PASS; existing CORS/JWT/bcrypt/rate-limit tests remain green.

```bash
git add rescue-backend/src/services/citizenAuthService.js rescue-backend/src/services/staffAuthService.js rescue-backend/src/repositories/citizenRepository.js rescue-backend/src/repositories/staffRepository.js rescue-backend/src/http/middleware/auth.js rescue-backend/src/http/routes/authRoutes.js rescue-backend/src/http/routes/incidentRoutes.js rescue-backend/src/services/incidentService.js rescue-backend/test/unit rescue-backend/server.js
git commit -m "feat: verify citizen identity and incident access"
```

---

### Task 6: Replace ghost presence and in-memory dispatch with recoverable services

**Files:**
- Create: `rescue-backend/src/services/presenceService.js`
- Create: `rescue-backend/src/services/dispatchService.js`
- Create: `rescue-backend/src/jobs/resumeDispatch.js`
- Create: `rescue-backend/test/unit/presenceService.test.js`
- Create: `rescue-backend/test/unit/dispatchService.test.js`
- Modify: `rescue-backend/src/repositories/incidentRepository.js`
- Modify: `rescue-backend/server.js` (remove `dispatchState` and global polling loop after service wiring)

**Interfaces:**
- Produces: `createPresenceService(redis, config)` with `heartbeat`, `isFreshAvailable`, `setAvailabilityIfFresh`, `goOffline`, `freshCandidates`, and `cleanupGeo`.
- Produces: `createDispatchService({ redis, transaction, incidents, events, presence, config, clock, randomUUID, publishOffer })` with `tick`, `accept`, `retry`, and `requestBackup`.
- Produces: `startResumeDispatch({ dispatchService, intervalMs })` returning a cleanup function.
- Consumes: lifecycle/events/config and MySQL repository.

- [ ] **Step 1: Write failing presence TTL and stale-candidate tests**

```js
// rescue-backend/test/unit/presenceService.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPresenceService } = require('../../src/services/presenceService');

test('heartbeat writes a 30-second presence key and GEO member using server identity', async () => {
  const calls = [];
  const redis = {
    set: async (...args) => calls.push(['set', ...args]),
    geoAdd: async (...args) => calls.push(['geoAdd', ...args]),
  };
  const service = createPresenceService(redis, { presenceTtlSeconds: 30 });
  await service.heartbeat({ rescuerId: 8, username: 'unit-08', latitude: 13.7, longitude: 100.5, availability: 'AVAILABLE' });
  assert.deepEqual(calls[0][3], { EX: 30 });
  assert.equal(calls.some((call) => call[0] === 'geoAdd' && call.at(-1).member === '8'), true);
});

test('freshCandidates excludes GEO members whose presence key expired', async () => {
  const redis = {
    geoSearch: async () => ['8', '9'],
    mGet: async () => [JSON.stringify({ availability: 'AVAILABLE' }), null],
  };
  const service = createPresenceService(redis, { presenceTtlSeconds: 30 });
  assert.deepEqual(await service.freshCandidates({ latitude: 13.7, longitude: 100.5, radiusKm: 50 }), ['8']);
});

test('availability changes only while the rescuer presence key is still fresh', async () => {
  const writes = [];
  const redis = { get: async () => JSON.stringify({ rescuerId: 8, availability: 'AVAILABLE' }),
    set: async (...args) => writes.push(args) };
  const service = createPresenceService(redis, { presenceTtlSeconds: 30 });
  assert.equal(await service.setAvailabilityIfFresh(8, 'BUSY'), true);
  assert.equal(JSON.parse(writes[0][1]).availability, 'BUSY');
  assert.deepEqual(writes[0][2], { XX: true, EX: 30 });
});

test('heartbeat rejects invalid coordinates before writing Redis', async () => {
  const service = createPresenceService({ set: async () => assert.fail('must not write') }, { presenceTtlSeconds: 30 });
  await assert.rejects(
    () => service.heartbeat({ rescuerId: 8, latitude: 999, longitude: 100.5, availability: 'AVAILABLE' }),
    (error) => error.code === 'INVALID_LOCATION',
  );
});
```

- [ ] **Step 2: Implement presence with TTL and GEO filtering**

```js
// rescue-backend/src/services/presenceService.js
const { AppError } = require('../domain/errors');
const AVAILABILITY = new Set(['AVAILABLE', 'BUSY']);
function createPresenceService(redis, config) {
  const key = (id) => `rescuer:${id}:presence`;
  const lastKey = (id) => `rescuer:${id}:last`;
  return {
    async heartbeat(input) {
      const latitude = Number(input.latitude); const longitude = Number(input.longitude);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
          !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !AVAILABILITY.has(input.availability)) {
        throw new AppError('INVALID_LOCATION', 400, 'ข้อมูลตำแหน่งหรือสถานะหน่วยไม่ถูกต้อง');
      }
      input = { ...input, latitude, longitude };
      const value = JSON.stringify({ ...input, recordedAt: new Date().toISOString() });
      await redis.set(key(input.rescuerId), value, { EX: config.presenceTtlSeconds });
      await redis.set(lastKey(input.rescuerId), value, { EX: 86_400 });
      await redis.geoAdd('online_rescuers', { longitude: input.longitude, latitude: input.latitude, member: String(input.rescuerId) });
      return JSON.parse(value);
    },
    async goOffline(rescuerId) {
      await Promise.all([redis.del(key(rescuerId)), redis.zRem('online_rescuers', String(rescuerId))]);
    },
    async setAvailabilityIfFresh(rescuerId, availability) {
      if (!AVAILABILITY.has(availability)) throw new AppError('INVALID_AVAILABILITY', 400, 'สถานะหน่วยไม่ถูกต้อง');
      const raw = await redis.get(key(rescuerId));
      if (!raw) return false;
      const value = JSON.stringify({ ...JSON.parse(raw), availability, recordedAt: new Date().toISOString() });
      const changed = await redis.set(key(rescuerId), value, { XX: true, EX: config.presenceTtlSeconds });
      if (!changed) return false;
      await redis.set(lastKey(rescuerId), value, { EX: 86_400 });
      return true;
    },
    async isFreshAvailable(rescuerId) {
      const raw = await redis.get(key(rescuerId));
      return Boolean(raw && JSON.parse(raw).availability === 'AVAILABLE');
    },
    async freshCandidates({ latitude, longitude, radiusKm }) {
      const ids = await redis.geoSearch('online_rescuers', { longitude, latitude }, { radius: radiusKm, unit: 'km' }, { SORT: 'ASC' });
      if (!ids.length) return [];
      const values = await redis.mGet(ids.map(key));
      return ids.filter((_id, index) => values[index] && JSON.parse(values[index]).availability === 'AVAILABLE');
    },
    async cleanupGeo(ids) {
      const values = await redis.mGet(ids.map(key));
      const stale = ids.filter((_id, index) => !values[index]);
      if (stale.length) await redis.zRem('online_rescuers', stale);
      return stale;
    },
    async listFreshAndStale() {
      const keys = [];
      for await (const value of redis.scanIterator({ MATCH: 'rescuer:*:last', COUNT: 100 })) keys.push(value);
      const lastValues = keys.length ? await redis.mGet(keys) : [];
      return Promise.all(lastValues.filter(Boolean).map(async (raw) => {
        const value = JSON.parse(raw);
        return { ...value, freshness: await redis.exists(key(value.rescuerId)) ? 'FRESH' : 'STALE' };
      }));
    },
  };
}

module.exports = { createPresenceService };
```

- [ ] **Step 3: Write failing dispatch tests for timeout and atomic acceptance**

```js
// rescue-backend/test/unit/dispatchService.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDispatchService } = require('../../src/services/dispatchService');

test('tick marks an expired search NO_UNIT_AVAILABLE', async () => {
  const transitions = [];
  const service = createDispatchService({
    redis: { set: async () => null },
    transaction: async (work) => work({}),
    incidents: {
      findDispatchable: async () => [{ id: 3, status: 'SEARCHING', latitude: 13.7, longitude: 100.5, search_started_at: new Date(0) }],
      transitionSystem: async (id, from, to) => transitions.push({ id, from, to }),
    },
    events: { append: async () => {} }, presence: { freshCandidates: async () => [] },
    config: { dispatchSearchMs: 120_000, offerRoundMs: 15_000 }, clock: { now: () => 121_000 }, randomUUID: () => 'event-id',
  });
  await service.tick();
  assert.deepEqual(transitions, [{ id: 3, from: 'SEARCHING', to: 'NO_UNIT_AVAILABLE' }]);
});

test('accept returns conflict when conditional MySQL assignment loses', async () => {
  const service = createDispatchService({
    redis: { get: async () => '1', set: async () => 'OK', del: async () => {} },
    transaction: async (work) => work({}),
    incidents: { acceptAtomic: async () => null }, events: { findByAction: async () => null, append: async () => {} }, presence: {},
    config: {}, clock: { now: Date.now }, randomUUID: () => 'event-id',
  });
  await assert.rejects(() => service.accept({ incidentId: 3, rescuerId: 9, clientActionId: '00000000-0000-4000-8000-000000000021' }),
    (error) => error.code === 'ASSIGNMENT_CONFLICT');
});

test('accept rejects a rescuer without a live server-issued offer', async () => {
  const service = createDispatchService({
    redis: { get: async () => null }, transaction: async (work) => work({}),
    incidents: {}, events: { findByAction: async () => null }, presence: {}, config: {}, clock: { now: Date.now }, randomUUID: () => 'event-id',
  });
  await assert.rejects(
    () => service.accept({ incidentId: 3, rescuerId: 99, clientActionId: '00000000-0000-4000-8000-000000000022' }),
    (error) => error.code === 'FORBIDDEN',
  );
});
```

- [ ] **Step 4: Add conditional assignment to the incident repository**

```js
async acceptAtomic({ incidentId, rescuerId }, connection = pool) {
  const [result] = await connection.query(
    `UPDATE incidents SET assigned_user_id = ?, status = 'EN_ROUTE', accepted_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'SEARCHING' AND assigned_user_id IS NULL`,
    [rescuerId, incidentId],
  );
  return result.affectedRows === 1 ? repository.findById(incidentId, connection) : null;
},
async findDispatchable(connection = pool) {
  const [rows] = await connection.query("SELECT * FROM incidents WHERE status IN ('REPORTED','SEARCHING') ORDER BY created_at ASC");
  return rows;
},
async transitionSystem(id, from, to, connection = pool) {
  const timestampSql = to === 'SEARCHING' ? ', search_started_at = CURRENT_TIMESTAMP' : '';
  const [result] = await connection.query(
    `UPDATE incidents SET status = ?${timestampSql} WHERE id = ? AND status = ?`,
    [to, id, from],
  );
  return result.affectedRows === 1;
},
```

- [ ] **Step 5: Implement dispatch as an idempotent tick, not a process-local queue**

```js
// rescue-backend/src/services/dispatchService.js
const { AppError } = require('../domain/errors');
const { requireActionId } = require('../domain/validation');

function createDispatchService({ redis, transaction, incidents, events, presence, config, clock, randomUUID, publishOffer = async () => {} }) {
  const commitSystemTransition = (incident, to) => transaction(async (db) => {
    const changed = await incidents.transitionSystem(incident.id, incident.status, to, db);
    if (!changed) return false;
    await events.append({ incidentId: incident.id, type: to, from: incident.status, to,
      actorType: 'SYSTEM', correlationId: randomUUID(), metadata: {} }, db);
    return true;
  });
  const offerKey = (incidentId, rescuerId) => `dispatch:offer:${incidentId}:${rescuerId}`;
  const prepareOfferRound = async (incident) => {
    const roundKey = `dispatch:round:${incident.id}`;
    const acquired = await redis.set(roundKey, randomUUID(), { NX: true, PX: config.offerRoundMs });
    if (!acquired) return null;
    const ids = await presence.freshCandidates({ latitude: incident.latitude, longitude: incident.longitude, radiusKm: 50 });
    if (!ids.length) await redis.del(roundKey);
    await Promise.all(ids.map((id) => redis.set(offerKey(incident.id, id), '1', { EX: Math.ceil(config.offerRoundMs / 1_000) })));
    return ids;
  };
  const start = async (incident) => {
    if (incident.status !== 'REPORTED') return { started: incident.status === 'SEARCHING' };
    let ids;
    try { ids = await prepareOfferRound(incident); }
    catch { throw new AppError('SERVICE_DEGRADED', 503, 'Redis ไม่พร้อม จึงยังไม่เริ่มค้นหาหน่วย'); }
    if (!ids) return { started: false };
    const changed = await commitSystemTransition(incident, 'SEARCHING');
    if (!changed) return { started: false };
    const searching = { ...incident, status: 'SEARCHING', search_started_at: new Date(clock.now()).toISOString() };
    if (ids.length) await publishOffer(ids, searching);
    return { started: true };
  };
  return {
    start,
    async tick() {
      for (const incident of await incidents.findDispatchable()) {
        if (incident.status === 'REPORTED') {
          await start(incident);
          continue;
        }
        const age = clock.now() - new Date(incident.search_started_at).getTime();
        if (age >= config.dispatchSearchMs) {
          await commitSystemTransition(incident, 'NO_UNIT_AVAILABLE');
          continue;
        }
        const ids = await prepareOfferRound(incident);
        if (!ids) continue;
        if (ids.length) await publishOffer(ids, incident);
      }
    },
    async accept({ incidentId, rescuerId, clientActionId }) {
      requireActionId(clientActionId);
      const replay = await events.findByAction(incidentId, clientActionId);
      if (replay) {
        if (replay.actor_type !== 'RESCUE' || Number(replay.actor_id) !== Number(rescuerId)) {
          throw new AppError('FORBIDDEN', 403, 'รหัสคำสั่งนี้เป็นของผู้ใช้อื่น');
        }
        return incidents.findById(incidentId);
      }
      if (!(await redis.get(offerKey(incidentId, rescuerId)))) {
        throw new AppError('FORBIDDEN', 403, 'หน่วยนี้ไม่มีข้อเสนอที่ยังใช้งานได้');
      }
      const lockKey = `dispatch:lock:${incidentId}`;
      const locked = await redis.set(lockKey, String(rescuerId), { NX: true, EX: 5 });
      if (!locked) throw new AppError('ASSIGNMENT_CONFLICT', 409, 'มีหน่วยอื่นรับเหตุแล้ว');
      try {
        return await transaction(async (db) => {
          const duplicate = await events.findByAction(incidentId, clientActionId, db);
          if (duplicate) {
            if (duplicate.actor_type !== 'RESCUE' || Number(duplicate.actor_id) !== Number(rescuerId)) {
              throw new AppError('FORBIDDEN', 403, 'รหัสคำสั่งนี้เป็นของผู้ใช้อื่น');
            }
            return incidents.findById(incidentId, db);
          }
          const incident = await incidents.acceptAtomic({ incidentId, rescuerId }, db);
          if (!incident) throw new AppError('ASSIGNMENT_CONFLICT', 409, 'มีหน่วยอื่นรับเหตุแล้ว');
          await events.append({ incidentId, type: 'EN_ROUTE', from: 'SEARCHING', to: 'EN_ROUTE', actorType: 'RESCUE', actorId: rescuerId, clientActionId, correlationId: randomUUID(), metadata: {} }, db);
          return incident;
        });
      } finally { await redis.del(lockKey); }
    },
  };
}

module.exports = { createDispatchService };
```

- [ ] **Step 6: Preserve the existing backup feature behind assignment and cooldown rules**

Add this failing test to `dispatchService.test.js`:

```js
test('requestBackup rejects an unassigned rescuer before creating a child incident', async () => {
  const service = createDispatchService({
    redis: {}, transaction: async (work) => work({}),
    incidents: { findById: async () => ({ id: 3, assigned_user_id: 8 }) },
    events: {}, presence: {}, config: {}, clock: { now: () => 1_000 }, randomUUID: () => 'event-id',
  });
  await assert.rejects(
    () => service.requestBackup({ incidentId: 3, rescuerId: 9, clientActionId: '00000000-0000-4000-8000-000000000023' }),
    (error) => error.code === 'FORBIDDEN',
  );
});
```

Add these repository methods:

```js
async countActiveBackups(parentId, db = pool) {
  const [rows] = await db.query(
    "SELECT COUNT(*) AS count FROM incidents WHERE parent_incident_id = ? AND status NOT IN ('COMPLETED','CANCELLED')",
    [parentId],
  );
  return Number(rows[0].count);
},
async findLatestBackup(parentId, db = pool) {
  const [rows] = await db.query('SELECT created_at FROM incidents WHERE parent_incident_id = ? ORDER BY id DESC LIMIT 1', [parentId]);
  return rows[0] || null;
},
async createBackup(parent, reportActionId, db = pool) {
  const [result] = await db.query(
    `INSERT INTO incidents
     (report_action_id,details,latitude,longitude,location_accuracy_m,landmark,status,citizen_phone,citizen_id,citizen_token_hash,parent_incident_id)
     VALUES (?,?,?,?,?,?,'REPORTED',?,?,?,?)`,
    [reportActionId, `[BACKUP] ${parent.details}`, parent.latitude, parent.longitude,
      parent.location_accuracy_m, parent.landmark, parent.citizen_phone, parent.citizen_id,
      parent.citizen_token_hash, parent.id],
  );
  return repository.findById(result.insertId, db);
},
```

Add this method to the returned dispatch service:

```js
async requestBackup({ incidentId, rescuerId, clientActionId }) {
  requireActionId(clientActionId);
  return transaction(async (db) => {
    const parent = await incidents.findById(incidentId, db);
    if (!parent || Number(parent.assigned_user_id) !== Number(rescuerId)) {
      throw new AppError('FORBIDDEN', 403, 'เฉพาะหน่วยที่รับผิดชอบเท่านั้นที่ขอกำลังเสริมได้');
    }
    const duplicate = await events.findByAction(incidentId, clientActionId, db);
    if (duplicate) {
      if (duplicate.actor_type !== 'RESCUE' || Number(duplicate.actor_id) !== Number(rescuerId)) {
        throw new AppError('FORBIDDEN', 403, 'รหัสคำสั่งนี้เป็นของผู้ใช้อื่น');
      }
      return incidents.findByReportAction(clientActionId, db);
    }
    if (await incidents.countActiveBackups(incidentId, db) >= 3) {
      throw new AppError('BACKUP_LIMIT', 409, 'ขอกำลังเสริมได้สูงสุดสามหน่วย');
    }
    const latest = await incidents.findLatestBackup(incidentId, db);
    if (latest && clock.now() - new Date(latest.created_at).getTime() < 60_000) {
      throw new AppError('BACKUP_COOLDOWN', 409, 'กรุณารอหนึ่งนาทีก่อนขอกำลังเสริมอีกครั้ง');
    }
    const child = await incidents.createBackup(parent, clientActionId, db);
    await events.append({ incidentId, type: 'BACKUP_REQUESTED', from: parent.status, to: parent.status,
      actorType: 'RESCUE', actorId: rescuerId, clientActionId, correlationId: randomUUID(), metadata: { childIncidentId: child.id } }, db);
    return child;
  });
},
```

- [ ] **Step 7: Add restart recovery job and delete `dispatchState`**

```js
// rescue-backend/src/jobs/resumeDispatch.js
function startResumeDispatch({ dispatchService, intervalMs = 5_000, onError = console.error }) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await dispatchService.tick(); } catch (error) { onError(error); } finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  run();
  return () => clearInterval(timer);
}

module.exports = { startResumeDispatch };
```

Add `retry` to the returned dispatch service as an audited `NO_UNIT_AVAILABLE → SEARCHING` transaction:

```js
async retry({ incidentId, adminId, clientActionId, reason }) {
  requireActionId(clientActionId);
  return transaction(async (db) => {
    const duplicate = await events.findByAction(incidentId, clientActionId, db);
    if (duplicate) {
      if (duplicate.actor_type !== 'ADMIN' || Number(duplicate.actor_id) !== Number(adminId)) {
        throw new AppError('FORBIDDEN', 403, 'รหัสคำสั่งนี้เป็นของผู้ใช้อื่น');
      }
      return incidents.findById(incidentId, db);
    }
    const incident = await incidents.findById(incidentId, db);
    if (!incident || incident.status !== 'NO_UNIT_AVAILABLE') {
      throw new AppError('INVALID_TRANSITION', 409, 'เหตุนี้ยังไม่พร้อมให้ค้นหาใหม่');
    }
    const changed = await incidents.transitionSystem(incidentId, 'NO_UNIT_AVAILABLE', 'SEARCHING', db);
    if (!changed) throw new AppError('ASSIGNMENT_CONFLICT', 409, 'สถานะเหตุถูกเปลี่ยนแล้ว');
    await events.append({ incidentId, type: 'SEARCHING', from: 'NO_UNIT_AVAILABLE', to: 'SEARCHING',
      actorType: 'ADMIN', actorId: adminId, clientActionId, correlationId: randomUUID(), metadata: { reason } }, db);
    return incidents.findById(incidentId, db);
  });
},
```

Delete the global `dispatchState`, `broadcastOffer` timer, and five-second SQL loop only after `startResumeDispatch` is wired to the new service and `publishOffer` emits to authenticated `staff:{id}` rooms.

- [ ] **Step 8: Run suites and commit**

Run: `cd rescue-backend && node --test test/unit/presenceService.test.js test/unit/dispatchService.test.js && npm test`
Expected: all tests PASS; no test relies on TCP listening.

```bash
git add rescue-backend/src/services/presenceService.js rescue-backend/src/services/dispatchService.js rescue-backend/src/jobs/resumeDispatch.js rescue-backend/src/repositories/incidentRepository.js rescue-backend/test/unit rescue-backend/server.js
git commit -m "feat: make presence and dispatch recoverable"
```

---

### Task 7: Authenticate Socket.IO and make chat/tracking server-authoritative

**Files:**
- Create: `rescue-backend/src/realtime/authenticateSocket.js`
- Create: `rescue-backend/src/realtime/registerSocketHandlers.js`
- Create: `rescue-backend/src/repositories/chatRepository.js`
- Create: `rescue-backend/src/services/chatService.js`
- Create: `rescue-backend/src/services/notificationService.js`
- Create: `rescue-backend/src/services/socketRateLimiter.js`
- Create: `rescue-backend/test/unit/authenticateSocket.test.js`
- Create: `rescue-backend/test/unit/chatService.test.js`
- Create: `rescue-backend/test/unit/notificationService.test.js`
- Create: `rescue-backend/test/unit/socketRateLimiter.test.js`
- Create: `rescue-backend/test/unit/socketHandlers.test.js`
- Modify: `rescue-backend/src/repositories/incidentRepository.js`
- Modify: `rescue-backend/server.js` (delete old `io.on('connection')` block after registration)

**Interfaces:**
- Produces: `authenticateSocket({ jwtSecret, hashIncidentToken, incidents })` Socket.IO middleware.
- Produces: `registerSocketHandlers(io, { presence, dispatch, incidents, chat, notifications, socketRateLimiter })`.
- Produces: `chat.send({ incidentId, actor, message, clientMessageId })` and `chat.history({ incidentId, actor })`.
- Produces: `notifications.sendAssignment(incident)` and `sendCompletion(incident)` that never roll back a committed incident.
- Produces: `socketRateLimiter.allow(scope)` enforcing 30 chat messages per minute per authenticated actor/incident.
- Consumes: Task 5 identity and Task 6 presence/dispatch.

- [ ] **Step 1: Write failing handshake tests**

```js
// rescue-backend/test/unit/authenticateSocket.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { createSocketAuthenticator } = require('../../src/realtime/authenticateSocket');

test('staff socket identity is derived from JWT, not auth userId', async () => {
  const secret = 'socket-test-secret';
  const token = jwt.sign({ id: 4, role: 'Rescue', foundation_id: 1 }, secret);
  const socket = { handshake: { auth: { token, userId: 999 } }, data: {} };
  const authenticate = createSocketAuthenticator({ jwtSecret: secret, incidents: {}, hashIncidentToken: (x) => x });
  await new Promise((resolve, reject) => authenticate(socket, (error) => error ? reject(error) : resolve()));
  assert.deepEqual(socket.data.actor, { type: 'STAFF', id: 4, role: 'RESCUE', foundationId: 1 });
});

test('anonymous socket without JWT or incident capability is rejected', async () => {
  const socket = { handshake: { auth: {} }, data: {} };
  const authenticate = createSocketAuthenticator({ jwtSecret: 'secret', incidents: {}, hashIncidentToken: (x) => x });
  await assert.rejects(new Promise((resolve, reject) => authenticate(socket, (error) => error ? reject(error) : resolve())), /unauthorized/);
});
```

- [ ] **Step 2: Implement handshake identity and room scope**

```js
// rescue-backend/src/realtime/authenticateSocket.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

function createSocketAuthenticator({ jwtSecret, incidents, hashIncidentToken }) {
  return async (socket, next) => {
    try {
      const { token, incidentId, incidentToken } = socket.handshake.auth || {};
      if (token) {
        const claims = jwt.verify(token, jwtSecret);
        socket.data.actor = claims.kind === 'citizen'
          ? { type: 'CITIZEN', id: Number(claims.sub), role: 'CITIZEN' }
          : { type: 'STAFF', id: claims.id, role: String(claims.role).toUpperCase(), foundationId: claims.foundation_id };
        return next();
      }
      if (incidentId && incidentToken) {
        const incident = await incidents.findById(Number(incidentId));
        const actual = Buffer.from(hashIncidentToken(incidentToken));
        const expected = Buffer.from(incident?.citizen_token_hash || '');
        if (actual.length && actual.length === expected.length && crypto.timingSafeEqual(actual, expected)) {
          socket.data.actor = { type: 'CITIZEN_CAPABILITY', id: null, role: 'CITIZEN', incidentId: Number(incidentId) };
          return next();
        }
      }
      next(new Error('unauthorized'));
    } catch { next(new Error('unauthorized')); }
  };
}

module.exports = { createSocketAuthenticator };
```

- [ ] **Step 3: Write failing chat tests for derived sender and duplicate retry**

```js
// rescue-backend/test/unit/chatService.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatService } = require('../../src/services/chatService');

test('chat derives sender label and returns an existing duplicate', async () => {
  const saved = [];
  const repository = {
    findByClientId: async (_incidentId, id) => saved.find((row) => row.client_message_id === id) || null,
    insert: async (row) => { const result = { id: 1, ...row }; saved.push(result); return result; },
  };
  const service = createChatService({ repository, canAccess: async () => true });
  const input = { incidentId: 3, actor: { type: 'STAFF', id: 8, role: 'RESCUE', displayName: 'Unit 8' }, message: 'กำลังไป', clientMessageId: '00000000-0000-4000-8000-000000000011' };
  const first = await service.send(input);
  const second = await service.send(input);
  assert.equal(first.sender, 'Unit 8');
  assert.equal(second.id, first.id);
  assert.equal(saved.length, 1);
});
```

- [ ] **Step 4: Implement idempotent chat persistence**

```js
// rescue-backend/src/services/chatService.js
const { AppError } = require('../domain/errors');
const { requireActionId } = require('../domain/validation');

function createChatService({ repository, canAccess }) {
  return {
    async history({ incidentId, actor }) {
      if (!(await canAccess(actor, incidentId))) throw new AppError('FORBIDDEN', 403, 'ไม่สามารถเข้าถึงเหตุนี้ได้');
      return repository.history(incidentId);
    },
    async send({ incidentId, actor, message, clientMessageId }) {
      if (!(await canAccess(actor, incidentId))) throw new AppError('FORBIDDEN', 403, 'ไม่สามารถเข้าถึงเหตุนี้ได้');
      requireActionId(clientMessageId);
      const text = String(message || '').trim();
      if (!text || text.length > 2_000) throw new AppError('INVALID_MESSAGE', 400, 'ข้อความไม่ถูกต้อง');
      const duplicate = await repository.findByClientId(incidentId, clientMessageId);
      if (duplicate) {
        const sameType = duplicate.actor_type === actor.type;
        const sameActor = duplicate.actor_id == null ? actor.id == null : Number(duplicate.actor_id) === Number(actor.id);
        if (!sameType || !sameActor) throw new AppError('FORBIDDEN', 403, 'รหัสข้อความนี้เป็นของผู้ใช้อื่น');
        return duplicate;
      }
      const sender = actor.type === 'STAFF' ? actor.displayName || 'หน่วยกู้ภัย' : 'ผู้แจ้งเหตุ';
      return repository.insert({ incident_id: incidentId, actor_type: actor.type, actor_id: actor.id, sender, message: text, client_message_id: clientMessageId });
    },
  };
}

module.exports = { createChatService };
```

Implement the repository with parameterized SQL:

```js
// rescue-backend/src/repositories/chatRepository.js
function createChatRepository(db) {
  return {
    async findByClientId(incidentId, clientMessageId) {
      const [rows] = await db.query(
        'SELECT id,incident_id,actor_type,actor_id,sender,message,client_message_id,timestamp FROM chat_messages WHERE incident_id = ? AND client_message_id = ? LIMIT 1',
        [incidentId, clientMessageId],
      );
      return rows[0] || null;
    },
    async insert(value) {
      const [result] = await db.query(
        `INSERT INTO chat_messages (incident_id,actor_type,actor_id,sender,message,client_message_id)
         VALUES (?,?,?,?,?,?)`,
        [value.incident_id, value.actor_type, value.actor_id, value.sender, value.message, value.client_message_id],
      );
      return { id: result.insertId, ...value, timestamp: new Date().toISOString() };
    },
    async history(incidentId) {
      const [rows] = await db.query(
        `SELECT id,incident_id,actor_type,actor_id,sender,message,client_message_id,timestamp
         FROM chat_messages WHERE incident_id = ? ORDER BY timestamp,id`,
        [incidentId],
      );
      return rows;
    },
  };
}

module.exports = { createChatRepository };
```

Add the parent-thread authorization query to `incidentRepository`:

```js
async hasAssignedChild(rescuerId, parentIncidentId, db = pool) {
  const [rows] = await db.query(
    `SELECT 1 FROM incidents WHERE assigned_user_id = ? AND parent_incident_id = ?
     AND status IN ('EN_ROUTE','ARRIVED') LIMIT 1`,
    [rescuerId, parentIncidentId],
  );
  return rows.length === 1;
},
```

Extend `incidentService` with the access methods consumed by realtime and chat:

```js
async assertAccess(actor, id) {
  const incident = await incidents.findById(id);
  const assignedRescuer = actor.role === 'RESCUE' && incident && (
    Number(incident.assigned_user_id) === Number(actor.id) || await incidents.hasAssignedChild(actor.id, id)
  );
  const allowed = incident && (
    actor.role === 'ADMIN' ||
    assignedRescuer ||
    (actor.type === 'CITIZEN' && Number(incident.citizen_id) === Number(actor.id)) ||
    (actor.type === 'CITIZEN_CAPABILITY' && Number(actor.incidentId) === Number(id))
  );
  if (!allowed) throw new AppError('FORBIDDEN', 403, 'ไม่สามารถเข้าถึงเหตุนี้ได้');
  return incident;
},
async assertAssigned(rescuerId, id) {
  const incident = await incidents.findById(id);
  if (!incident || Number(incident.assigned_user_id) !== Number(rescuerId)) {
    throw new AppError('FORBIDDEN', 403, 'ไม่ได้รับมอบหมายเหตุนี้');
  }
  return incident;
},
```

Construct `chatService` with `canAccess: async (actor, incidentId) => Boolean(await incidentService.assertAccess(actor, incidentId))`.

Extend Task 5 auth middleware with `requireIncidentActor`: verify a bearer staff/citizen session when present, otherwise verify `X-Incident-Token`:

```js
async requireIncidentActor(req, _res, next) {
  try {
    const incident = await incidentRepository.findById(Number(req.params.id));
    if (!incident) throw new AppError('FORBIDDEN', 403, 'ไม่สามารถเข้าถึงเหตุนี้ได้');
    let actor;
    try {
      const claims = verifyBearer(req);
      actor = claims.kind === 'citizen'
        ? { type: 'CITIZEN', role: 'CITIZEN', id: Number(claims.sub) }
        : { type: 'STAFF', role: String(claims.role).toUpperCase(), id: claims.id };
    } catch {
      const token = req.headers['x-incident-token'];
      if (!token || !safeEqual(hashIncidentToken(token), incident.citizen_token_hash)) {
        throw new AppError('FORBIDDEN', 403, 'ไม่สามารถเข้าถึงเหตุนี้ได้');
      }
      actor = { type: 'CITIZEN_CAPABILITY', role: 'CITIZEN', id: null, incidentId: incident.id };
    }
    const assignedRescuer = actor.role === 'RESCUE' && (
      Number(incident.assigned_user_id) === Number(actor.id) || await incidentRepository.hasAssignedChild(actor.id, incident.id)
    );
    const allowed = actor.role === 'ADMIN' ||
      assignedRescuer ||
      (actor.type === 'CITIZEN' && Number(incident.citizen_id) === Number(actor.id)) ||
      actor.type === 'CITIZEN_CAPABILITY';
    if (!allowed) throw new AppError('FORBIDDEN', 403, 'ไม่สามารถเข้าถึงเหตุนี้ได้');
    req.actor = actor; next();
  } catch (error) { next(error.code ? error : new AppError('FORBIDDEN', 403, 'ไม่สามารถเข้าถึงเหตุนี้ได้')); }
},
```

Mount the history endpoint in `incidentRoutes`:

```js
router.get('/:id/chat', requireIncidentActor, async (req, res, next) => {
  try { res.json(await chatService.history({ incidentId: Number(req.params.id), actor: req.actor })); }
  catch (error) { next(error); }
});
```

The middleware must return the same `FORBIDDEN` response for a missing incident and wrong ownership. Update `useIncidentSession.join` and `restoreMission` to fetch this endpoint after the incident snapshot and replace message state with the persisted history before attaching realtime listeners.

- [ ] **Step 4a: Make LINE notification explicitly best-effort**

```js
// rescue-backend/test/unit/notificationService.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotificationService } = require('../../src/services/notificationService');
test('LINE failure is reported but not thrown into the incident transaction', async () => {
  const service = createNotificationService({ citizens: { findById: async () => ({ line_uid: 'U1' }) }, incidents: {},
    lineNotifier: async () => { throw new Error('LINE unavailable'); }, onError: () => {} });
  assert.deepEqual(await service.sendCompletion({ id: 4, citizen_id: 1 }), { sent: false });
});
```

```js
// rescue-backend/src/services/notificationService.js
function createNotificationService({ citizens, incidents, lineNotifier, onError = console.error }) {
  const send = async (incident, message) => {
    const source = incident.citizen_id ? incident : await incidents.findById(incident.id);
    if (!source?.citizen_id) return { sent: false };
    const citizen = await citizens.findById(source.citizen_id);
    if (!citizen?.line_uid) return { sent: false };
    try { await lineNotifier(citizen.line_uid, message); return { sent: true }; }
    catch (error) { onError(error); return { sent: false }; }
  };
  return {
    sendAssignment: (incident) => send(incident, `หน่วยกู้ภัยกำลังเดินทางมายังเหตุ #${incident.id}`),
    sendCompletion: (incident) => send(incident, `เหตุ #${incident.id} เสร็จสิ้นแล้ว`),
  };
}
module.exports = { createNotificationService };
```

Add to `citizenRepository`:

```js
async findById(id) {
  const [rows] = await db.query('SELECT id,line_uid,display_name,phone FROM citizens WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
},
```

After `mission_accept` emits the committed state, call `services.notifications.sendAssignment(incident)`. After a successful `COMPLETED` transition, call `services.notifications.sendCompletion(snapshot)`. Do not await either call inside a MySQL transaction.

- [ ] **Step 4b: Rate-limit socket chat by authenticated actor**

```js
// rescue-backend/test/unit/socketRateLimiter.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSocketRateLimiter } = require('../../src/services/socketRateLimiter');
test('the thirty-first chat action in one minute is rejected', async () => {
  let count = 0;
  const redis = { incr: async () => ++count, expire: async () => {} };
  const limiter = createSocketRateLimiter(redis, { max: 30, windowSeconds: 60 });
  for (let index = 0; index < 30; index += 1) assert.equal(await limiter.allow('chat:RESCUE:7:incident:4'), true);
  assert.equal(await limiter.allow('chat:RESCUE:7:incident:4'), false);
});
```

```js
// rescue-backend/src/services/socketRateLimiter.js
function createSocketRateLimiter(redis, { max, windowSeconds }) {
  return { async allow(scope) {
    const key = `rate:${scope}`; const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    return count <= max;
  }};
}
module.exports = { createSocketRateLimiter };
```

Before `chat.send`, enforce the limit without persisting on failure:

```js
const scope = `chat:${actor.role}:${actor.id || actor.incidentId}:incident:${payload.incidentId}`;
if (!(await services.socketRateLimiter.allow(scope))) {
  return ack({ ok: false, error: { code: 'RATE_LIMITED', message: 'ส่งข้อความถี่เกินไป กรุณารอสักครู่' } });
}
```

- [ ] **Step 5: Write a failing handler test proving spoofed IDs are ignored**

```js
// rescue-backend/test/unit/socketHandlers.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerOneSocket } = require('../../src/realtime/registerSocketHandlers');

test('heartbeat uses authenticated rescuer id and acknowledges success', async () => {
  const handlers = {}; const calls = [];
  const socket = { data: { actor: { type: 'STAFF', id: 7, role: 'RESCUE' } }, on: (name, fn) => { handlers[name] = fn; }, join: async () => {} };
  registerOneSocket(socket, { presence: { heartbeat: async (input) => calls.push(input) }, dispatch: { tick: async () => {} } });
  let ack;
  await handlers.heartbeat({ user_id: 999, latitude: 13.7, longitude: 100.5, availability: 'AVAILABLE' }, (value) => { ack = value; });
  assert.equal(calls[0].rescuerId, 7);
  assert.deepEqual(ack, { ok: true });
});
```

- [ ] **Step 6: Implement authorized event handlers with acknowledgements**

```js
// rescue-backend/src/realtime/registerSocketHandlers.js
const failure = (error) => ({ ok: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.code ? error.message : 'ระบบขัดข้อง กรุณาลองใหม่' } });

function registerOneSocket(socket, services) {
  const actor = socket.data.actor;
  if (actor.type === 'STAFF') socket.join(`staff:${actor.id}`);
  if (actor.role === 'RESCUE') socket.join('rescuers');
  if (actor.role === 'ADMIN') socket.join('admins');

  socket.on('heartbeat', async (payload, ack = () => {}) => {
    try {
      if (actor.role !== 'RESCUE') throw Object.assign(new Error('ไม่มีสิทธิ์'), { code: 'FORBIDDEN' });
      await services.presence.heartbeat({ rescuerId: actor.id, latitude: Number(payload.latitude), longitude: Number(payload.longitude), availability: payload.availability });
      ack({ ok: true });
      if (payload.availability === 'AVAILABLE') {
        void services.dispatch.tick().catch((error) => console.error('dispatch wake-up failed', { name: error.name }));
      }
    } catch (error) { ack(failure(error)); }
  });

  socket.on('join_incident', async ({ incidentId }, ack = () => {}) => {
    try {
      await services.incidents.assertAccess(actor, Number(incidentId));
      await socket.join(`incident:${Number(incidentId)}`);
      ack({ ok: true });
    } catch (error) { ack(failure(error)); }
  });

  socket.on('location_update', async (payload, ack = () => {}) => {
    try {
      const assigned = await services.incidents.assertAssigned(actor.id, Number(payload.incidentId));
      const location = await services.presence.heartbeat({ rescuerId: actor.id, latitude: Number(payload.latitude), longitude: Number(payload.longitude), availability: 'BUSY' });
      const roomIncidentId = assigned.parent_incident_id || assigned.id;
      services.io.to(`incident:${roomIncidentId}`).to('admins').emit('location_updated', { incidentId: assigned.id,
        parentIncidentId: assigned.parent_incident_id, rescuerId: actor.id, latitude: location.latitude,
        longitude: location.longitude, recordedAt: location.recordedAt });
      ack({ ok: true });
    } catch (error) { ack(failure(error)); }
  });

  socket.on('chat_send', async (payload, ack = () => {}) => {
    try {
      const message = await services.chat.send({ incidentId: Number(payload.incidentId), actor, message: payload.message, clientMessageId: payload.clientMessageId });
      services.io.to(`incident:${payload.incidentId}`).emit('chat_message', message);
      ack({ ok: true, message });
    } catch (error) { ack(failure(error)); }
  });
}

function registerSocketHandlers(io, services) { io.on('connection', (socket) => registerOneSocket(socket, { ...services, io })); }
module.exports = { registerSocketHandlers, registerOneSocket };
```

Add the remaining mutation handlers before closing `registerOneSocket`:

```js
socket.on('mission_accept', async (payload, ack = () => {}) => {
  try {
    if (actor.role !== 'RESCUE') throw Object.assign(new Error('ไม่มีสิทธิ์'), { code: 'FORBIDDEN' });
    const incident = await services.dispatch.accept({ incidentId: Number(payload.incidentId), rescuerId: actor.id, clientActionId: payload.clientActionId });
    await socket.join(`incident:${incident.parent_incident_id || incident.id}`);
    void services.presence.setAvailabilityIfFresh(actor.id, 'BUSY')
      .catch((error) => console.error('presence busy update failed', { name: error.name }));
    services.io.to('rescuers').to('admins').emit('offer_cancelled', { incidentId: incident.id });
    services.io.to(`incident:${incident.parent_incident_id || incident.id}`).to('admins').emit('incident_updated', incident);
    void services.notifications.sendAssignment(incident);
    ack({ ok: true, incident });
  } catch (error) { ack(failure(error)); }
});

socket.on('incident_transition', async (payload, ack = () => {}) => {
  try {
    const result = await services.incidents.transition({ id: Number(payload.incidentId), to: payload.status,
      actor, clientActionId: payload.clientActionId, reason: payload.reason });
    const snapshot = result.incident;
    if (snapshot.status === 'COMPLETED') {
      void services.presence.setAvailabilityIfFresh(actor.id, 'AVAILABLE')
        .catch((error) => console.error('presence available update failed', { name: error.name }));
    }
    if (snapshot.status === 'COMPLETED') void services.notifications.sendCompletion(snapshot);
    ack({ ok: true, result, incident: snapshot });
  } catch (error) { ack(failure(error)); }
});

socket.on('backup_request', async (payload, ack = () => {}) => {
  try {
    const child = await services.dispatch.requestBackup({ incidentId: Number(payload.incidentId), rescuerId: actor.id, clientActionId: payload.clientActionId });
    ack({ ok: true, incident: child });
  } catch (error) { ack(failure(error)); }
});

socket.on('presence_offline', async (_payload, ack = () => {}) => {
  try { await services.presence.goOffline(actor.id); ack({ ok: true }); }
  catch (error) { ack(failure(error)); }
});
```

`mission_accept` emits `incident_updated` and `offer_cancelled` only after the assignment/event transaction returns.

- [ ] **Step 7: Delete bypass-prone events and wire authenticated rooms**

Delete old handlers `go_online`, `go_offline`, `update_vehicle_location`, `join_incident_room`, and `send_chat_message`; the authenticated replacement for going offline is `presence_offline`. Register `io.use(createSocketAuthenticator(...))` before `registerSocketHandlers`. Offers target `staff:{id}`; admins join `admins` only through handshake role; incident rooms are always `incident:{id}`.

- [ ] **Step 8: Run suites and commit**

Run: `cd rescue-backend && node --test test/unit/authenticateSocket.test.js test/unit/chatService.test.js test/unit/notificationService.test.js test/unit/socketRateLimiter.test.js test/unit/socketHandlers.test.js && npm test`
Expected: all tests PASS and no handler accepts a client-supplied actor identity.

```bash
git add rescue-backend/src/realtime rescue-backend/src/repositories/chatRepository.js rescue-backend/src/repositories/incidentRepository.js rescue-backend/src/services/incidentService.js rescue-backend/src/services/chatService.js rescue-backend/src/services/notificationService.js rescue-backend/src/services/socketRateLimiter.js rescue-backend/test/unit rescue-backend/server.js
git commit -m "feat: secure realtime tracking and chat"
```

---

### Task 8: Build the shared Web/LIFF citizen workflow

**Files:**
- Create: `rescue-frontend/src/api/client.js`
- Create: `rescue-frontend/src/realtime/socket.js`
- Create: `rescue-frontend/src/citizen/identity/webGuest.js`
- Create: `rescue-frontend/src/citizen/identity/liff.js`
- Create: `rescue-frontend/src/citizen/incidentReducer.js`
- Create: `rescue-frontend/src/citizen/useIncidentSession.js`
- Create: `rescue-frontend/src/citizen/components/LocationConfirmation.jsx`
- Create: `rescue-frontend/src/citizen/components/IncidentTimeline.jsx`
- Create: `rescue-frontend/src/citizen/components/LiveTracking.jsx`
- Create: `rescue-frontend/src/citizen/components/IncidentChat.jsx`
- Create: `rescue-frontend/src/test/setup.js`
- Create: `rescue-frontend/src/citizen/incidentReducer.test.js`
- Create: `rescue-frontend/src/citizen/CitizenSOS.test.jsx`
- Modify: `rescue-frontend/src/CitizenSOS.jsx`
- Modify: `rescue-frontend/src/App.css`
- Modify: `rescue-frontend/src/config.js`
- Modify: `rescue-frontend/package.json`, `rescue-frontend/package-lock.json`, `rescue-frontend/vite.config.js`

**Interfaces:**
- Produces: `createApiClient({ baseUrl, getStaffToken })`, `createCitizenSocket({ baseUrl, session })`.
- Produces: identity adapters with `initialize(): Promise<{ mode, sessionToken, profile }>`.
- Produces: `incidentReducer(state, action)` and `useIncidentSession(identity)`.
- Consumes: Task 4/5/7 REST and socket contracts.

Set the environment-aware endpoint once:

```js
// rescue-frontend/src/config.js
export const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000';
```

- [ ] **Step 1: Install and configure frontend test tooling**

Run:

```bash
cd rescue-frontend
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

Add scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Add to `vite.config.js`:

```js
test: { environment: 'jsdom', setupFiles: './src/test/setup.js' }
```

```js
// rescue-frontend/src/test/setup.js
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 2: Write failing reducer tests for canonical state and stale location**

```js
// rescue-frontend/src/citizen/incidentReducer.test.js
import { describe, expect, it } from 'vitest';
import { initialIncidentState, incidentReducer } from './incidentReducer';

describe('incidentReducer', () => {
  it('hydrates the canonical server snapshot after reconnect', () => {
    const state = incidentReducer(initialIncidentState, { type: 'SNAPSHOT', incident: { id: 4, status: 'EN_ROUTE' } });
    expect(state.incident).toMatchObject({ id: 4, status: 'EN_ROUTE' });
    expect(state.connection).toBe('CONNECTED');
  });

  it('marks a location stale after 30 seconds', () => {
    const state = incidentReducer(initialIncidentState, { type: 'LOCATION', location: { recordedAt: '2026-07-20T00:00:00.000Z' } });
    const stale = incidentReducer(state, { type: 'CLOCK', now: Date.parse('2026-07-20T00:00:31.000Z') });
    expect(stale.locationFreshness).toBe('STALE');
  });
});
```

- [ ] **Step 3: Implement reducer and browser-safe incident storage**

```js
// rescue-frontend/src/citizen/incidentReducer.js
export const initialIncidentState = { incident: null, location: null, locationFreshness: 'NONE', connection: 'CONNECTING', error: null };

export function incidentReducer(state, action) {
  switch (action.type) {
    case 'SNAPSHOT': return { ...state, incident: action.incident, connection: 'CONNECTED', error: null };
    case 'LOCATION': return { ...state, location: action.location, locationFreshness: 'FRESH' };
    case 'CLOCK': {
      if (!state.location?.recordedAt) return state;
      return { ...state, locationFreshness: action.now - Date.parse(state.location.recordedAt) >= 30_000 ? 'STALE' : 'FRESH' };
    }
    case 'DISCONNECTED': return { ...state, connection: 'DISCONNECTED' };
    case 'ERROR': return { ...state, error: action.error };
    default: return state;
  }
}

export const incidentStorage = {
  load: () => JSON.parse(localStorage.getItem('activeCitizenIncident') || 'null'),
  save: (value) => localStorage.setItem('activeCitizenIncident', JSON.stringify(value)),
  clear: () => localStorage.removeItem('activeCitizenIncident'),
};
```

- [ ] **Step 4: Implement Web and LIFF identity adapters without trusting `getProfile()` as authentication**

```js
// rescue-frontend/src/citizen/identity/webGuest.js
export const webGuestIdentity = {
  async initialize() { return { mode: 'WEB_GUEST', sessionToken: null, profile: null }; },
};
```

```js
// rescue-frontend/src/citizen/identity/liff.js
export function createLiffIdentity({ liff, liffId, api }) {
  return {
    async initialize() {
      await liff.init({ liffId });
      if (!liff.isInClient()) return { mode: 'WEB_GUEST', sessionToken: null, profile: null };
      if (!liff.isLoggedIn()) liff.login();
      const idToken = liff.getIDToken();
      const response = await api.post('/api/citizen/session', { id_token: idToken });
      return { mode: 'LIFF', sessionToken: response.sessionToken, profile: response.citizen };
    },
  };
}
```

- [ ] **Step 5: Implement the shared HTTP and socket adapters**

```js
// rescue-frontend/src/api/client.js
import axios from 'axios';

export function createApiClient({ baseUrl, getStaffToken = () => null }) {
  const http = axios.create({ baseURL: baseUrl, timeout: 10_000 });
  return {
    async request({ method = 'get', url, data, incidentToken, sessionToken, headers = {} }) {
      try {
        const token = sessionToken || getStaffToken();
        const response = await http.request({ method, url, data, headers: {
          ...headers,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(incidentToken ? { 'X-Incident-Token': incidentToken } : {}),
        }});
        return response.data;
      } catch (error) {
        throw error.response?.data?.error || { code: 'SERVICE_DEGRADED', message: 'เชื่อมต่อระบบไม่ได้' };
      }
    },
    get(url, options = {}) { return this.request({ method: 'get', url, ...options }); },
    post(url, data, options = {}) { return this.request({ method: 'post', url, data, ...options }); },
  };
}
```

```js
// rescue-frontend/src/realtime/socket.js
import { io } from 'socket.io-client';
export const createCitizenSocket = ({ baseUrl, session }) => io(baseUrl, {
  autoConnect: false,
  auth: session.sessionToken ? { token: session.sessionToken } : { incidentId: session.incidentId, incidentToken: session.incidentToken },
});
```

- [ ] **Step 6: Write a failing component test for Web access and 1669 fallback**

```jsx
// rescue-frontend/src/citizen/CitizenSOS.test.jsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CitizenSOS from '../CitizenSOS';

describe('CitizenSOS', () => {
  it('works in a normal browser and keeps the emergency fallback visible', async () => {
    render(<CitizenSOS identity={{ initialize: async () => ({ mode: 'WEB_GUEST', sessionToken: null }) }} />);
    expect(await screen.findByRole('button', { name: /ยืนยันว่าจุดนี้ถูกต้อง/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /โทร 1669/i })).toHaveAttribute('href', 'tel:1669');
  });
});
```

- [ ] **Step 7: Split and compose the citizen UI**

`CitizenSOS.jsx` must become composition-only:

```jsx
export default function CitizenSOS({ identity = defaultIdentity }) {
  const session = useIncidentSession(identity);
  return (
    <main className="citizen-shell">
      <a className="call-1669" href="tel:1669">โทร 1669</a>
      {!session.incident && <LocationConfirmation value={session.draft} onChange={session.updateDraft} onSubmit={session.report} />}
      {session.incident && <IncidentTimeline incident={session.incident} error={session.error} onCancel={session.cancel} />}
      {session.incident?.status === 'EN_ROUTE' && <LiveTracking incident={session.incident} location={session.location} freshness={session.locationFreshness} />}
      {session.incident && <IncidentChat messages={session.messages} onSend={session.sendMessage} />}
    </main>
  );
}
```

Implement the orchestration hook with stable retry IDs and REST-first recovery:

```js
// rescue-frontend/src/citizen/useIncidentSession.js
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { incidentReducer, incidentStorage, initialIncidentState } from './incidentReducer';

export function useIncidentSession(identity, { api, socketFactory } = {}) {
  const [state, dispatch] = useReducer(incidentReducer, initialIncidentState);
  const [draft, setDraft] = useState({ details: '', phone: '', latitude: null, longitude: null, accuracy: null, landmark: '', photo: null });
  const [messages, setMessages] = useState([]);
  const identityRef = useRef(null); const socketRef = useRef(null); const reportActionRef = useRef(null);

  const join = useCallback(async (saved, sessionToken) => {
    const credentials = { incidentToken: saved.incidentToken, sessionToken };
    const [incident, history] = await Promise.all([
      api.get(`/api/incidents/${saved.id}`, credentials),
      api.get(`/api/incidents/${saved.id}/chat`, credentials),
    ]);
    dispatch({ type: 'SNAPSHOT', incident });
    setMessages(history);
    socketRef.current?.disconnect();
    const socket = socketFactory({ sessionToken, incidentId: saved.id, incidentToken: saved.incidentToken });
    socketRef.current = socket;
    socket.on('incident_updated', (value) => {
      dispatch({ type: 'SNAPSHOT', incident: value });
      if (['COMPLETED', 'CANCELLED'].includes(value.status)) incidentStorage.clear();
    });
    socket.on('location_updated', (value) => dispatch({ type: 'LOCATION', location: value }));
    socket.on('chat_message', (value) => setMessages((current) => current.some((item) => item.id === value.id) ? current : [...current, value]));
    socket.on('disconnect', () => dispatch({ type: 'DISCONNECTED' }));
    socket.on('connect', () => socket.emit('join_incident', { incidentId: saved.id }, () => {}));
    socket.connect();
  }, [api, socketFactory]);

  useEffect(() => {
    let active = true;
    identity.initialize().then(async (value) => {
      if (!active) return;
      identityRef.current = value;
      const saved = incidentStorage.load();
      if (saved) await join(saved, value.sessionToken);
    }).catch((error) => dispatch({ type: 'ERROR', error }));
    return () => { active = false; socketRef.current?.disconnect(); };
  }, [identity, join]);

  useEffect(() => {
    if (state.connection !== 'DISCONNECTED' || !state.incident) return undefined;
    const timer = setInterval(async () => {
      const saved = incidentStorage.load();
      try { dispatch({ type: 'SNAPSHOT', incident: await api.get(`/api/incidents/${saved.id}`, {
        incidentToken: saved.incidentToken, sessionToken: identityRef.current?.sessionToken,
      }) }); } catch (error) { dispatch({ type: 'ERROR', error }); }
    }, 10_000);
    return () => clearInterval(timer);
  }, [api, state.connection, state.incident]);

  const report = useCallback(async () => {
    reportActionRef.current ||= crypto.randomUUID();
    try {
      const result = await api.post('/api/incidents', {
        report_action_id: reportActionRef.current, details: draft.details,
        latitude: draft.latitude, longitude: draft.longitude,
        location_accuracy_m: draft.accuracy, landmark: draft.landmark,
        citizen_phone: draft.phone,
      }, { sessionToken: identityRef.current?.sessionToken });
      const saved = { id: result.incident.id, incidentToken: result.citizen_token };
      incidentStorage.save(saved); reportActionRef.current = null;
      await join(saved, identityRef.current?.sessionToken);
      if (result.warning) dispatch({ type: 'ERROR', error: result.warning });
    } catch (error) { dispatch({ type: 'ERROR', error }); }
  }, [api, draft, join]);

  const cancel = useCallback(async (reason) => {
    const saved = incidentStorage.load();
    const result = await api.post(`/api/incidents/${saved.id}/cancel`, { reason, client_action_id: crypto.randomUUID() }, {
      incidentToken: saved.incidentToken, sessionToken: identityRef.current?.sessionToken,
    });
    dispatch({ type: 'SNAPSHOT', incident: result.incident });
    incidentStorage.clear();
  }, [api]);

  const sendMessage = useCallback((message) => socketRef.current?.emit('chat_send', {
    incidentId: state.incident.id, message, clientMessageId: crypto.randomUUID(),
  }, (result) => { if (!result.ok) dispatch({ type: 'ERROR', error: result.error }); }), [state.incident]);

  return { ...state, draft, messages, updateDraft: (patch) => setDraft((value) => ({ ...value, ...patch })), report, cancel, sendMessage };
}
```

The configured wrapper constructs the Task 8 API client and calls `createCitizenSocket({ baseUrl: API_URL, session })`; the same `reportActionRef` remains set after a failed request so retry cannot create a duplicate.

- [ ] **Step 8: Verify citizen tests, lint, and build**

Run:

```bash
cd rescue-frontend
npm test
npm run lint
npm run build
```

Expected: tests PASS, ESLint reports `0` errors/warnings, and Vite build exits `0`. The former LINE-only message and query-string citizen tokens no longer exist (`rg "open via LINE|params: \{ token|line_uid" src/CitizenSOS.jsx src/citizen` returns no matches).

- [ ] **Step 9: Commit the shared citizen experience**

```bash
git add rescue-frontend/package.json rescue-frontend/package-lock.json rescue-frontend/vite.config.js rescue-frontend/src/config.js rescue-frontend/src/api rescue-frontend/src/realtime rescue-frontend/src/citizen rescue-frontend/src/CitizenSOS.jsx rescue-frontend/src/App.css rescue-frontend/src/test
git commit -m "feat: support shared Web and LIFF incident tracking"
```

---

### Task 9: Build the authenticated rescuer workflow and heartbeat recovery

**Files:**
- Create: `rescue-frontend/src/rescuer/useRescuerSession.js`
- Create: `rescue-frontend/src/rescuer/components/AvailabilityPanel.jsx`
- Create: `rescue-frontend/src/rescuer/components/MissionOffer.jsx`
- Create: `rescue-frontend/src/rescuer/components/ActiveMission.jsx`
- Create: `rescue-frontend/src/rescuer/useRescuerSession.test.jsx`
- Create: `rescue-frontend/src/rescuer/CommandCenter.test.jsx`
- Modify: `rescue-frontend/src/realtime/socket.js`
- Modify: `rescue-frontend/src/CommandCenter.jsx`
- Modify: `rescue-frontend/src/App.css`
- Modify: `rescue-frontend/src/App.jsx`
- Modify: `rescue-frontend/src/Login.jsx`
- Modify: `rescue-frontend/src/RescuerRegister.jsx`

**Interfaces:**
- Produces: `createStaffSocket({ baseUrl, token })` and `useRescuerSession({ user, token, api, socket, geolocation })`.
- Consumes: authenticated events and acknowledgements from Task 7; active-incident snapshot and transitions from Task 4/6.

- [ ] **Step 1: Write a failing hook test proving heartbeat identity is not in the payload**

```jsx
// rescue-frontend/src/rescuer/useRescuerSession.test.jsx
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRescuerSession } from './useRescuerSession';

it('sends coordinates and availability without a client user id', async () => {
  const emit = vi.fn((_name, _payload, ack) => ack?.({ ok: true }));
  const socket = { on: vi.fn(), off: vi.fn(), emit, connect: vi.fn(), disconnect: vi.fn(), connected: true };
  const geolocation = { watchPosition: (success) => { success({ coords: { latitude: 13.7, longitude: 100.5, accuracy: 8 } }); return 1; }, clearWatch: vi.fn() };
  const { result } = renderHook(() => useRescuerSession({ user: { id: 77 }, token: 'jwt', api: {}, socket, geolocation }));
  await act(() => result.current.setOnline(true));
  const heartbeat = emit.mock.calls.find(([name]) => name === 'heartbeat');
  expect(heartbeat[1]).toMatchObject({ latitude: 13.7, longitude: 100.5, availability: 'AVAILABLE' });
  expect(heartbeat[1]).not.toHaveProperty('user_id');
});
```

- [ ] **Step 2: Add the staff socket factory**

```js
// append to rescue-frontend/src/realtime/socket.js
export const createStaffSocket = ({ baseUrl, token }) => io(baseUrl, {
  autoConnect: false,
  auth: { token },
  reconnection: true,
  reconnectionDelayMax: 5_000,
});
```

- [ ] **Step 3: Implement the rescuer session hook with one GPS watch and one heartbeat timer**

```js
// rescue-frontend/src/rescuer/useRescuerSession.js
import { useCallback, useEffect, useRef, useState } from 'react';

export function useRescuerSession({ token, api, socket, geolocation = navigator.geolocation }) {
  const [online, setOnlineState] = useState(false);
  const [position, setPosition] = useState(null);
  const [offer, setOffer] = useState(null);
  const [mission, setMission] = useState(null);
  const [messages, setMessages] = useState([]);
  const [connection, setConnection] = useState('CONNECTING');
  const timerRef = useRef(null);
  const positionRef = useRef(null);

  const emitAck = useCallback((event, payload) => new Promise((resolve, reject) => {
    socket.emit(event, payload, (result) => result?.ok ? resolve(result) : reject(result?.error || { code: 'REALTIME_DISCONNECTED', message: 'ขาดการเชื่อมต่อ' }));
  }), [socket]);

  const restoreMission = useCallback(async () => {
    const value = await api.get('/api/rescuer/active-incident', { sessionToken: token });
    setMission(value || null);
    if (value) {
      const threadId = value.parent_incident_id || value.id;
      setMessages(await api.get(`/api/incidents/${threadId}/chat`, { sessionToken: token }));
      await emitAck('join_incident', { incidentId: threadId });
    }
  }, [api, emitAck, token]);

  const heartbeat = useCallback((availability = mission ? 'BUSY' : 'AVAILABLE') => {
    if (!positionRef.current || !socket.connected) return;
    if (mission) {
      socket.emit('location_update', { incidentId: mission.id, ...positionRef.current }, () => {});
    } else {
      socket.emit('heartbeat', { ...positionRef.current, availability }, () => {});
    }
  }, [mission, socket]);

  const setOnline = useCallback(async (value) => {
    setOnlineState(value);
    if (value) { socket.connect(); heartbeat('AVAILABLE'); }
    else socket.emit('presence_offline', {}, () => socket.disconnect());
  }, [heartbeat, socket]);

  useEffect(() => {
    const watchId = geolocation.watchPosition(({ coords }) => {
      const next = { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy };
      positionRef.current = next; setPosition(next);
    });
    return () => geolocation.clearWatch(watchId);
  }, [geolocation]);

  useEffect(() => {
    if (!online) return undefined;
    heartbeat(); timerRef.current = setInterval(heartbeat, 10_000);
    return () => clearInterval(timerRef.current);
  }, [heartbeat, online]);

  useEffect(() => {
    const connected = () => { setConnection('CONNECTED'); heartbeat(); restoreMission().catch(() => setConnection('DISCONNECTED')); };
    const disconnected = () => setConnection('DISCONNECTED');
    const offered = (value) => setOffer(value);
    const offerCancelled = (value) => setOffer((current) => Number(current?.incidentId || current?.id) === Number(value.incidentId) ? null : current);
    const chatMessage = (value) => setMessages((current) => current.some((item) => item.id === value.id) ? current : [...current, value]);
    const updated = (value) => setMission((current) => {
      if (!current || Number(current.id) !== Number(value.id)) return current;
      return ['COMPLETED', 'CANCELLED'].includes(value.status) ? null : value;
    });
    socket.on('connect', connected); socket.on('disconnect', disconnected);
    socket.on('mission_offer', offered); socket.on('offer_cancelled', offerCancelled);
    socket.on('incident_updated', updated); socket.on('chat_message', chatMessage);
    return () => { socket.off('connect', connected); socket.off('disconnect', disconnected);
      socket.off('mission_offer', offered); socket.off('offer_cancelled', offerCancelled);
      socket.off('incident_updated', updated); socket.off('chat_message', chatMessage); };
  }, [heartbeat, restoreMission, socket]);

  const acceptOffer = useCallback(async () => {
    const result = await emitAck('mission_accept', { incidentId: offer.incidentId, clientActionId: crypto.randomUUID() });
    const threadId = result.incident.parent_incident_id || result.incident.id;
    setMission(result.incident); setOffer(null);
    setMessages(await api.get(`/api/incidents/${threadId}/chat`, { sessionToken: token }));
  }, [api, emitAck, offer, token]);
  const transition = useCallback(async (status) => {
    const result = await emitAck('incident_transition', { incidentId: mission.id, status, clientActionId: crypto.randomUUID() });
    setMission(result.incident.status === 'COMPLETED' ? null : result.incident);
  }, [emitAck, mission]);
  const requestBackup = useCallback(() => emitAck('backup_request', { incidentId: mission.id, clientActionId: crypto.randomUUID() }), [emitAck, mission]);
  const sendMessage = useCallback((message) => emitAck('chat_send', { incidentId: mission.parent_incident_id || mission.id,
    message, clientMessageId: crypto.randomUUID() }), [emitAck, mission]);

  return { online, position, offer, mission, messages, connection, setOnline, setMission,
    acceptOffer, rejectOffer: () => setOffer(null), markArrived: () => transition('ARRIVED'),
    markCompleted: () => transition('COMPLETED'), requestBackup, sendMessage };
}
```

Wrap calls to these methods in the components with a common error presenter that maps `ASSIGNMENT_CONFLICT` to “มีหน่วยอื่นรับเหตุแล้ว” and does not update local state after a negative acknowledgement.

- [ ] **Step 4: Write failing UI tests for valid actions and stale connection**

```jsx
// rescue-frontend/src/rescuer/CommandCenter.test.jsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ActiveMission from './components/ActiveMission';

it('shows only arrival for an en-route mission', () => {
  render(<ActiveMission mission={{ id: 4, status: 'EN_ROUTE' }} connection="CONNECTED" onArrive={() => {}} />);
  expect(screen.getByRole('button', { name: /ถึงจุดเกิดเหตุแล้ว/i })).toBeVisible();
  expect(screen.queryByRole('button', { name: /เสร็จสิ้น/i })).not.toBeInTheDocument();
});

it('disables state changes while realtime is disconnected', () => {
  render(<ActiveMission mission={{ id: 4, status: 'EN_ROUTE' }} connection="DISCONNECTED" onArrive={() => {}} />);
  expect(screen.getByRole('button', { name: /ถึงจุดเกิดเหตุแล้ว/i })).toBeDisabled();
  expect(screen.getByText(/ขาดการเชื่อมต่อ/i)).toBeVisible();
});
```

- [ ] **Step 5: Split rescuer components and reduce `CommandCenter.jsx` to composition**

```jsx
export default function CommandCenter({ user, onLogout }) {
  const session = useConfiguredRescuerSession(user);
  return (
    <main className="rescuer-shell">
      <AvailabilityPanel online={session.online} position={session.position} connection={session.connection} onChange={session.setOnline} onLogout={onLogout} />
      {session.offer && <MissionOffer offer={session.offer} onAccept={session.acceptOffer} onReject={session.rejectOffer} />}
      {session.mission && <ActiveMission mission={session.mission} messages={session.messages} connection={session.connection} position={session.position} onArrive={session.markArrived} onComplete={session.markCompleted} onBackup={session.requestBackup} onSendMessage={session.sendMessage} />}
    </main>
  );
}
```

`MissionOffer` displays incident age, distance, accuracy, landmark, details, and Accept/Reject. `ActiveMission` opens external navigation with a URL built from the incident coordinates, displays heartbeat age, and renders only the next valid lifecycle action.

- [ ] **Step 6: Clear existing lint failures in the files touched by this task**

- Remove unused `useEffect` from `App.jsx` and unused `useMapEvents` from the old rescuer imports.
- Define callbacks with `useCallback` before effects that consume them.
- Replace empty catches with a visible error state or `console.error('operation', error)`.
- Use primitive `citizenLat`, `citizenLng`, `rescuerLat`, and `rescuerLng` dependencies in routing effects.
- Move `fetchFoundations` above its effect in `RescuerRegister.jsx` and wrap it with `useCallback`.
- Associate the username and password inputs in `Login.jsx` with visible `<label>` elements (or matching `aria-label` values) so keyboard/screen-reader use and the Playwright `getByLabel` contract are both reliable.

- [ ] **Step 7: Verify and commit the rescuer workflow**

Run:

```bash
cd rescue-frontend
npm test
npm run lint
npm run build
```

Expected: tests PASS, ESLint reports `0` errors/warnings, Vite build exits `0`, and `rg "user_id|vehicle_id|staff_token" src/CommandCenter.jsx src/rescuer` returns no matches.

```bash
git add rescue-frontend/src/rescuer rescue-frontend/src/realtime/socket.js rescue-frontend/src/CommandCenter.jsx rescue-frontend/src/App.jsx rescue-frontend/src/Login.jsx rescue-frontend/src/RescuerRegister.jsx rescue-frontend/src/App.css
git commit -m "feat: add resilient rescuer mission workflow"
```

---

### Task 10: Build audited command-center controls and research metrics

**Files:**
- Create: `rescue-backend/src/services/adminService.js`
- Create: `rescue-backend/src/http/routes/adminRoutes.js`
- Create: `rescue-backend/src/http/routes/rescuerRoutes.js`
- Create: `rescue-backend/test/unit/adminService.test.js`
- Create: `rescue-web-admin/src/api/client.js`
- Create: `rescue-web-admin/src/realtime/socket.js`
- Create: `rescue-web-admin/src/admin/useCommandCenter.js`
- Create: `rescue-web-admin/src/admin/components/IncidentBoard.jsx`
- Create: `rescue-web-admin/src/admin/components/UnitMap.jsx`
- Create: `rescue-web-admin/src/admin/components/IncidentTimeline.jsx`
- Create: `rescue-web-admin/src/admin/components/ResearchMetrics.jsx`
- Create: `rescue-web-admin/src/test/setup.js`
- Create: `rescue-web-admin/src/admin/useCommandCenter.test.jsx`
- Modify: `rescue-web-admin/src/AdminDashboard.jsx`
- Modify: `rescue-web-admin/src/App.jsx`
- Modify: `rescue-web-admin/src/App.css`
- Modify: `rescue-web-admin/src/config.js`
- Modify: `rescue-web-admin/package.json`, `rescue-web-admin/package-lock.json`, `rescue-web-admin/vite.config.js`
- Modify: `rescue-backend/server.js`

**Interfaces:**
- Produces: `adminService.snapshot()`, `assign`, `reassign`, `retry`, and `cancel`, each requiring `{ adminId, clientActionId, reason }` for mutations and committing its audit event in the same transaction.
- Produces: `GET /api/admin/snapshot` and audited `/api/admin/incidents/:id/{assign,reassign,retry,cancel}` routes.
- Produces: `useCommandCenter({ api, socket })` canonical client state.
- Consumes: Task 3 lifecycle/events, Task 6 presence/dispatch, and Task 7 authenticated `admins` room.

- [ ] **Step 1: Write failing admin-service tests for reason and audit event**

```js
// rescue-backend/test/unit/adminService.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminService } = require('../../src/services/adminService');

test('reassignment requires a reason and records the admin actor', async () => {
  const appended = [];
  const service = createAdminService({
    transaction: async (work) => work({}),
    incidents: { findById: async () => ({ id: 4, status: 'EN_ROUTE', assigned_user_id: 8 }),
      reassign: async () => ({ id: 4, status: 'EN_ROUTE', assigned_user_id: 9 }) },
    events: { findByAction: async () => null, append: async (event) => { appended.push(event); return event; } },
    dispatch: {}, presence: { isFreshAvailable: async () => true, setAvailabilityIfFresh: async () => true }, randomUUID: () => 'correlation-id',
  });
  await assert.rejects(() => service.reassign({ incidentId: 4, rescuerId: 9, adminId: 2, reason: '', clientActionId: '00000000-0000-4000-8000-000000000031' }),
    (error) => error.code === 'INVALID_REASON');
  await service.reassign({ incidentId: 4, rescuerId: 9, adminId: 2, reason: 'รถคันเดิมขาดสัญญาณ', clientActionId: '00000000-0000-4000-8000-000000000031' });
  assert.equal(appended[0].actorType, 'ADMIN');
  assert.equal(appended[0].actorId, 2);
  assert.equal(appended[0].type, 'REASSIGNED');
});
```

- [ ] **Step 2: Implement admin mutations around repository transactions and events**

```js
// rescue-backend/src/services/adminService.js
const { AppError } = require('../domain/errors');
const { requireActionId } = require('../domain/validation');

function createAdminService({ transaction, incidents, events, dispatch, presence, incidentService, randomUUID, publishIncident = async () => {} }) {
  const requireReason = (reason) => {
    const value = String(reason || '').trim();
    if (value.length < 3 || value.length > 255) throw new AppError('INVALID_REASON', 400, 'กรุณาระบุเหตุผล');
    return value;
  };
  return {
    async snapshot() {
      const [activeIncidents, history, rescuers, metrics, recentEvents] = await Promise.all([
        incidents.findActive(), incidents.findRecentHistory(), presence.listFreshAndStale(), events.researchMetrics(), events.findRecent(200),
      ]);
      return { activeIncidents, history, rescuers, metrics, recentEvents, generatedAt: new Date().toISOString() };
    },
    async reassign({ incidentId, rescuerId, adminId, reason, clientActionId }) {
      requireActionId(clientActionId);
      const safeReason = requireReason(reason);
      const replay = await events.findByAction(incidentId, clientActionId);
      if (replay) {
        if (replay.actor_type !== 'ADMIN' || Number(replay.actor_id) !== Number(adminId)) {
          throw new AppError('FORBIDDEN', 403, 'รหัสคำสั่งนี้เป็นของผู้ใช้อื่น');
        }
        return incidents.findById(incidentId);
      }
      if (!(await presence.isFreshAvailable(rescuerId))) throw new AppError('NO_UNIT_AVAILABLE', 409, 'หน่วยที่เลือกไม่ออนไลน์หรือไม่ว่าง');
      const outcome = await transaction(async (db) => {
        const duplicate = await events.findByAction(incidentId, clientActionId, db);
        if (duplicate) {
          if (duplicate.actor_type !== 'ADMIN' || Number(duplicate.actor_id) !== Number(adminId)) {
            throw new AppError('FORBIDDEN', 403, 'รหัสคำสั่งนี้เป็นของผู้ใช้อื่น');
          }
          return { incident: await incidents.findById(incidentId, db), previousRescuerId: null };
        }
        const before = await incidents.findById(incidentId, db);
        const incident = await incidents.reassign({ incidentId, rescuerId }, db);
        await events.append({ incidentId, type: 'REASSIGNED', from: before.status, to: 'EN_ROUTE',
          actorType: 'ADMIN', actorId: adminId, clientActionId, correlationId: randomUUID(), metadata: { rescuerId, reason: safeReason } }, db);
        return { incident, previousRescuerId: before.assigned_user_id };
      });
      const availabilityChanges = [presence.setAvailabilityIfFresh(rescuerId, 'BUSY')];
      if (outcome.previousRescuerId && Number(outcome.previousRescuerId) !== Number(rescuerId)) {
        availabilityChanges.push(presence.setAvailabilityIfFresh(outcome.previousRescuerId, 'AVAILABLE'));
      }
      void Promise.all(availabilityChanges)
        .catch((error) => console.error('presence reassignment update failed', { name: error.name }));
      void publishIncident(outcome.incident)
        .catch((error) => console.error('incident publish failed', { name: error.name }));
      return outcome.incident;
    },
    async assign({ incidentId, rescuerId, adminId, reason, clientActionId }) {
      requireActionId(clientActionId);
      const safeReason = requireReason(reason);
      const replay = await events.findByAction(incidentId, clientActionId);
      if (replay) {
        if (replay.actor_type !== 'ADMIN' || Number(replay.actor_id) !== Number(adminId)) {
          throw new AppError('FORBIDDEN', 403, 'รหัสคำสั่งนี้เป็นของผู้ใช้อื่น');
        }
        return incidents.findById(incidentId);
      }
      if (!(await presence.isFreshAvailable(rescuerId))) throw new AppError('NO_UNIT_AVAILABLE', 409, 'หน่วยที่เลือกไม่ออนไลน์หรือไม่ว่าง');
      const incident = await transaction(async (db) => {
        const duplicate = await events.findByAction(incidentId, clientActionId, db);
        if (duplicate) {
          if (duplicate.actor_type !== 'ADMIN' || Number(duplicate.actor_id) !== Number(adminId)) {
            throw new AppError('FORBIDDEN', 403, 'รหัสคำสั่งนี้เป็นของผู้ใช้อื่น');
          }
          return incidents.findById(incidentId, db);
        }
        const before = await incidents.findById(incidentId, db);
        const assigned = await incidents.assignByAdmin({ incidentId, rescuerId }, db);
        if (!assigned) throw new AppError('ASSIGNMENT_CONFLICT', 409, 'เหตุถูกมอบหมายแล้ว');
        await events.append({ incidentId, type: 'EN_ROUTE', from: before.status, to: 'EN_ROUTE', actorType: 'ADMIN',
          actorId: adminId, clientActionId, correlationId: randomUUID(), metadata: { rescuerId, reason: safeReason } }, db);
        return assigned;
      });
      void presence.setAvailabilityIfFresh(rescuerId, 'BUSY')
        .catch((error) => console.error('presence busy update failed', { name: error.name }));
      void publishIncident(incident)
        .catch((error) => console.error('incident publish failed', { name: error.name }));
      return incident;
    },
    async retry(input) {
      const incident = await dispatch.retry({ ...input, reason: requireReason(input.reason) });
      void publishIncident(incident)
        .catch((error) => console.error('incident publish failed', { name: error.name }));
      return incident;
    },
    async cancel(input) {
      const safeReason = requireReason(input.reason);
      const before = await incidents.findById(input.incidentId);
      const result = await incidentService.cancel({ id: input.incidentId, actor: { role: 'ADMIN', id: input.adminId },
        clientActionId: input.clientActionId, reason: safeReason });
      if (before?.assigned_user_id) {
        void presence.setAvailabilityIfFresh(before.assigned_user_id, 'AVAILABLE')
          .catch((error) => console.error('presence available update failed', { name: error.name }));
      }
      return result;
    },
  };
}

module.exports = { createAdminService };
```

Add these incident repository mutations:

```js
async assignByAdmin({ incidentId, rescuerId }, db = pool) {
  const [result] = await db.query(
    `UPDATE incidents SET assigned_user_id = ?, status = 'EN_ROUTE', accepted_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status IN ('SEARCHING','NO_UNIT_AVAILABLE') AND assigned_user_id IS NULL`,
    [rescuerId, incidentId],
  );
  return result.affectedRows === 1 ? repository.findById(incidentId, db) : null;
},
async reassign({ incidentId, rescuerId }, db = pool) {
  const [result] = await db.query(
    `UPDATE incidents SET assigned_user_id = ?, status = 'EN_ROUTE', arrived_at = NULL
     WHERE id = ? AND status IN ('EN_ROUTE','ARRIVED')`,
    [rescuerId, incidentId],
  );
  if (result.affectedRows !== 1) throw new AppError('INVALID_TRANSITION', 409, 'ไม่สามารถเปลี่ยนหน่วยได้');
  return repository.findById(incidentId, db);
},
async findActive(db = pool) {
  const [rows] = await db.query(
    `SELECT id,details,latitude,longitude,location_accuracy_m,landmark,status,assigned_user_id,
            reported_at,search_started_at,accepted_at,arrived_at,parent_incident_id
     FROM incidents WHERE status NOT IN ('COMPLETED','CANCELLED') ORDER BY created_at`,
  );
  return rows;
},
async findRecentHistory(db = pool) {
  const [rows] = await db.query(
    `SELECT id,status,assigned_user_id,reported_at,search_started_at,accepted_at,arrived_at,completed_at,cancelled_at,cancel_reason
     FROM incidents WHERE status IN ('COMPLETED','CANCELLED') ORDER BY COALESCE(completed_at,cancelled_at) DESC LIMIT 100`,
  );
  return rows;
},
```

Add `eventRepository.researchMetrics()` with this de-identified query:

```sql
SELECT incident_id,
  TIMESTAMPDIFF(SECOND, MIN(CASE WHEN to_status='REPORTED' THEN created_at END), MIN(CASE WHEN to_status='SEARCHING' THEN created_at END)) AS report_to_search_s,
  TIMESTAMPDIFF(SECOND, MIN(CASE WHEN to_status='SEARCHING' THEN created_at END), MIN(CASE WHEN to_status='EN_ROUTE' THEN created_at END)) AS search_to_accept_s,
  TIMESTAMPDIFF(SECOND, MIN(CASE WHEN to_status='EN_ROUTE' THEN created_at END), MIN(CASE WHEN to_status='ARRIVED' THEN created_at END)) AS accept_to_arrive_s
FROM incident_events GROUP BY incident_id ORDER BY incident_id DESC LIMIT 100
```

Add this capped event query; `presenceService.listFreshAndStale()` comes from Task 6:

```js
async findRecent(limit = 200) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 500));
  const [rows] = await db.query(
    `SELECT id,incident_id,event_type,from_status,to_status,actor_type,actor_id,metadata,created_at
     FROM incident_events ORDER BY created_at DESC LIMIT ?`,
    [safeLimit],
  );
  return rows;
},
```

These methods never select phone, chat, token hashes, attachment content, or raw coordinates in the research metrics response.

- [ ] **Step 3: Mount role-checked admin and rescuer route modules**

```js
// rescue-backend/src/http/routes/adminRoutes.js
const express = require('express');

function createAdminRoutes({ requireStaff, requireAdmin, adminService }) {
  const router = express.Router();
  router.use(requireStaff, requireAdmin);
  router.get('/snapshot', async (_req, res, next) => { try { res.json(await adminService.snapshot()); } catch (error) { next(error); } });
  for (const action of ['assign', 'reassign', 'retry', 'cancel']) {
    router.post(`/incidents/:id/${action}`, async (req, res, next) => {
      try { res.json(await adminService[action]({ incidentId: Number(req.params.id), rescuerId: req.body.rescuer_id,
        adminId: req.actor.id, reason: req.body.reason, clientActionId: req.body.client_action_id })); }
      catch (error) { next(error); }
    });
  }
  return router;
}

module.exports = { createAdminRoutes };
```

Add `requireAdmin` to Task 5 middleware:

```js
requireAdmin(req, _res, next) {
  if (req.actor?.role !== 'ADMIN') return next(new AppError('FORBIDDEN', 403, 'ไม่มีสิทธิ์ผู้ดูแลระบบ'));
  next();
},
```

Create the active-mission route with a server-derived rescuer ID:

```js
// rescue-backend/src/http/routes/rescuerRoutes.js
const express = require('express');
function createRescuerRoutes({ requireStaff, incidents }) {
  const router = express.Router();
  router.get('/active-incident', requireStaff, async (req, res, next) => {
    try {
      if (req.actor.role !== 'RESCUE') return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์' } });
      res.json(await incidents.findActiveForRescuer(req.actor.id));
    } catch (error) { next(error); }
  });
  return router;
}
module.exports = { createRescuerRoutes };
```

Add to `incidentRepository`:

```js
async findActiveForRescuer(rescuerId, db = pool) {
  const [rows] = await db.query(
    `SELECT id,details,latitude,longitude,location_accuracy_m,landmark,status,parent_incident_id,
            reported_at,accepted_at,arrived_at
     FROM incidents WHERE assigned_user_id = ? AND status IN ('EN_ROUTE','ARRIVED') ORDER BY accepted_at DESC LIMIT 1`,
    [rescuerId],
  );
  return rows[0] || null;
},
```

Extract these existing endpoints from `server.js` into `adminRoutes.js` without changing their success payloads: `/broadcast`, `/line-broadcast`, `/foundations`, `/rescuers`, `/rescuers/bulk`, `/rescuers/pending`, `/rescuers/:id/approve`, and `/rescuers/:id/reject`. Each route remains below `router.use(requireStaff, requireAdmin)`. Move public `/foundations/public` and `/rescuers/register` into `rescuerRoutes.js`, retaining `publicWriteLimiter` on registration. Add a route smoke test that enumerates `router.stack` and asserts every admin mutation is mounted after the admin guard before deleting the original handlers.

- [ ] **Step 4: Install and configure admin Vitest tooling**

Set `rescue-web-admin/src/config.js` to `export const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000';` so E2E/staging never require source edits.

Run:

```bash
cd rescue-web-admin
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

Add `"test": "vitest run"`, `"test:watch": "vitest"`, Vite `test: { environment: 'jsdom', setupFiles: './src/test/setup.js' }`, and the same jest-dom setup used in Task 8.

- [ ] **Step 5: Write a failing hook test for REST-first reconnect and realtime merge**

```jsx
// rescue-web-admin/src/admin/useCommandCenter.test.jsx
import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCommandCenter } from './useCommandCenter';

it('loads a canonical snapshot before applying location events', async () => {
  const listeners = {};
  const socket = { on: vi.fn((name, fn) => { listeners[name] = fn; }), off: vi.fn(), connect: vi.fn() };
  const api = { get: vi.fn(async () => ({ activeIncidents: [{ id: 4, status: 'EN_ROUTE' }], rescuers: [], history: [], metrics: {} })) };
  const { result } = renderHook(() => useCommandCenter({ api, socket }));
  await waitFor(() => expect(result.current.incidents[0].id).toBe(4));
  listeners.location_updated({ rescuerId: 8, latitude: 13.7, longitude: 100.5, recordedAt: new Date().toISOString() });
  await waitFor(() => expect(result.current.rescuerLocations[8].latitude).toBe(13.7));
});
```

- [ ] **Step 6: Implement authenticated admin clients and focused dashboard components**

```js
// rescue-web-admin/src/api/client.js
import axios from 'axios';
export function createAdminApi({ baseUrl, token }) {
  const http = axios.create({ baseURL: baseUrl, timeout: 10_000, headers: { Authorization: `Bearer ${token}` } });
  return {
    get: async (url) => (await http.get(url)).data,
    post: async (url, data) => (await http.post(url, data)).data,
  };
}
```

```js
// rescue-web-admin/src/realtime/socket.js
import { io } from 'socket.io-client';
export const createAdminSocket = ({ baseUrl, token }) => io(baseUrl, { autoConnect: false, auth: { token } });
```

```js
// rescue-web-admin/src/admin/useCommandCenter.js
import { useCallback, useEffect, useState } from 'react';

export function useCommandCenter({ api, socket }) {
  const [state, setState] = useState({ incidents: [], rescuers: [], history: [], metrics: {}, recentEvents: [], rescuerLocations: {}, error: null });
  const load = useCallback(async () => {
    try {
      const value = await api.get('/api/admin/snapshot');
      setState((current) => ({ ...current, incidents: value.activeIncidents, rescuers: value.rescuers,
        history: value.history, metrics: value.metrics, recentEvents: value.recentEvents, error: null }));
    } catch (error) { setState((current) => ({ ...current, error })); }
  }, [api]);

  useEffect(() => {
    const location = (value) => setState((current) => ({ ...current,
      rescuerLocations: { ...current.rescuerLocations, [value.rescuerId]: value } }));
    const incident = (value) => setState((current) => ({ ...current,
      incidents: [value, ...current.incidents.filter((item) => item.id !== value.id)] }));
    socket.on('location_updated', location); socket.on('incident_updated', incident);
    socket.on('connect', load); socket.connect(); load();
    return () => { socket.off('location_updated', location); socket.off('incident_updated', incident); socket.off('connect', load); socket.disconnect(); };
  }, [load, socket]);

  const mutate = useCallback(async (action, incidentId, body) => {
    const result = await api.post(`/api/admin/incidents/${incidentId}/${action}`, {
      ...body, client_action_id: crypto.randomUUID(),
    });
    await load(); return result;
  }, [api, load]);

  return { ...state,
    retry: (id, reason) => mutate('retry', id, { reason }),
    cancel: (id, reason) => mutate('cancel', id, { reason }),
    assign: (id, rescuerId, reason) => mutate('assign', id, { rescuer_id: rescuerId, reason }),
    reassign: (id, rescuerId, reason) => mutate('reassign', id, { rescuer_id: rescuerId, reason }),
  };
}
```

```jsx
// rescue-web-admin/src/AdminDashboard.jsx
export default function AdminDashboard({ user, onLogout }) {
  const center = useConfiguredCommandCenter();
  return (
    <main className="admin-shell">
      <header><h1>ศูนย์สั่งการจำลอง</h1><button onClick={onLogout}>ออกจากระบบ</button></header>
      <ResearchMetrics metrics={center.metrics} />
      <IncidentBoard incidents={center.incidents} onRetry={center.retry} onCancel={center.cancel} onReassign={center.reassign} />
      <UnitMap rescuers={center.rescuers} locations={center.rescuerLocations} />
      <IncidentTimeline events={center.recentEvents} />
    </main>
  );
}
```

`UnitMap` renders `lastSeen` and marks units stale at 30 seconds; `IncidentBoard` groups `SEARCHING`, `EN_ROUTE`, `ARRIVED`, and problem states; every mutation opens a confirmation requiring a reason and uses a UUID action ID.

- [ ] **Step 7: Fix admin lint failures and verify both backend and admin**

Move `fetchStatus` logic into `useCommandCenter`, remove empty catches, and name caught errors that are used. In `App.jsx`, render a Thai login error rather than catching an unused `e`, and associate the username/password inputs with visible `<label>` elements (or matching `aria-label` values) for accessibility and the Playwright `getByLabel` contract.

Run:

```bash
cd rescue-backend && node --test test/unit/adminService.test.js && npm test
cd ../rescue-web-admin && npm test && npm run lint && npm run build
```

Expected: all backend/admin tests PASS, admin ESLint reports `0` errors/warnings, and Vite build exits `0`.

- [ ] **Step 8: Commit the command center**

```bash
git add rescue-backend/src/services/adminService.js rescue-backend/src/http/routes/adminRoutes.js rescue-backend/src/http/routes/rescuerRoutes.js rescue-backend/test/unit/adminService.test.js rescue-backend/server.js rescue-web-admin/package.json rescue-web-admin/package-lock.json rescue-web-admin/vite.config.js rescue-web-admin/src
git commit -m "feat: add audited simulated command center"
```

---

### Task 11: Add bounded attachments, retention, cache safety, and degraded-service health

**Files:**
- Create: `rescue-backend/src/repositories/attachmentRepository.js`
- Create: `rescue-backend/src/services/attachmentService.js`
- Create: `rescue-backend/src/jobs/retentionJob.js`
- Create: `rescue-backend/test/unit/attachmentService.test.js`
- Create: `rescue-backend/test/unit/retentionJob.test.js`
- Create: `rescue-backend/test/unit/degradedReport.test.js`
- Modify: `rescue-backend/src/http/routes/incidentRoutes.js`
- Modify: `rescue-backend/src/http/createApp.js`
- Create: `rescue-frontend/src/citizen/imageCompression.js`
- Create: `rescue-frontend/src/citizen/imageCompression.test.js`
- Modify: `rescue-frontend/src/citizen/useIncidentSession.js`
- Modify: `rescue-frontend/public/sw.js`

**Interfaces:**
- Produces: `attachmentService.save({ incidentId, actor, mimeType, bytes })` and `.read({ incidentId, actor })`.
- Produces: `runRetentionOnce({ db, chatDays, personalDays })`.
- Produces: `GET /health/live`, `GET /health/ready` and exact `202 SERVICE_DEGRADED` report behaviour when Redis is down.
- Consumes: Task 5 incident access and Task 4 error mapping.

- [ ] **Step 1: Write failing attachment validation tests**

```js
// rescue-backend/test/unit/attachmentService.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAttachmentService } = require('../../src/services/attachmentService');

test('accepts one bounded JPEG and rejects oversize or unapproved MIME types', async () => {
  const saved = [];
  const service = createAttachmentService({
    repository: { findByIncident: async () => null, save: async (value) => { saved.push(value); return { id: 1, ...value }; } },
    canAccess: async () => true,
    maxBytes: 1_048_576,
  });
  await service.save({ incidentId: 4, actor: {}, mimeType: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff]) });
  await assert.rejects(() => service.save({ incidentId: 4, actor: {}, mimeType: 'image/png', bytes: Buffer.from('x') }), (error) => error.code === 'ATTACHMENT_REJECTED');
  await assert.rejects(() => service.save({ incidentId: 6, actor: {}, mimeType: 'image/jpeg', bytes: Buffer.from('not-a-jpeg') }), (error) => error.code === 'ATTACHMENT_REJECTED');
  await assert.rejects(() => service.save({ incidentId: 5, actor: {}, mimeType: 'image/webp', bytes: Buffer.alloc(1_048_577) }), (error) => error.code === 'ATTACHMENT_REJECTED');
  assert.equal(saved.length, 1);
});
```

- [ ] **Step 2: Implement attachment validation and parameterized persistence**

```js
// rescue-backend/src/services/attachmentService.js
const { AppError } = require('../domain/errors');
const ALLOWED = new Set(['image/jpeg', 'image/webp']);
const hasExpectedMagic = (mimeType, bytes) => mimeType === 'image/jpeg'
  ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  : bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';

function createAttachmentService({ repository, canAccess, maxBytes }) {
  return {
    async save({ incidentId, actor, mimeType, bytes }) {
      if (!(await canAccess(actor, incidentId))) throw new AppError('FORBIDDEN', 403, 'ไม่สามารถเข้าถึงเหตุนี้ได้');
      if (!ALLOWED.has(mimeType) || !Buffer.isBuffer(bytes) || bytes.length > maxBytes || !hasExpectedMagic(mimeType, bytes)) {
        throw new AppError('ATTACHMENT_REJECTED', 400, 'รองรับเฉพาะ JPEG/WebP ขนาดไม่เกิน 1 MB');
      }
      if (await repository.findByIncident(incidentId)) throw new AppError('ATTACHMENT_REJECTED', 409, 'เหตุนี้มีรูปแล้ว');
      return repository.save({ incidentId, mimeType, byteSize: bytes.length, content: bytes });
    },
    async read({ incidentId, actor }) {
      if (!(await canAccess(actor, incidentId))) throw new AppError('FORBIDDEN', 403, 'ไม่สามารถเข้าถึงเหตุนี้ได้');
      return repository.findByIncident(incidentId);
    },
  };
}

module.exports = { createAttachmentService };
```

```js
// rescue-backend/src/repositories/attachmentRepository.js
function createAttachmentRepository(db) {
  return {
    async findByIncident(incidentId) {
      const [rows] = await db.query('SELECT id,incident_id,mime_type,byte_size,content,created_at FROM incident_attachments WHERE incident_id = ? LIMIT 1', [incidentId]);
      return rows[0] || null;
    },
    async save(value) {
      const [result] = await db.query(
        'INSERT INTO incident_attachments (incident_id,mime_type,byte_size,content) VALUES (?,?,?,?)',
        [value.incidentId, value.mimeType, value.byteSize, value.content],
      );
      return { id: result.insertId, incident_id: value.incidentId, mime_type: value.mimeType, byte_size: value.byteSize };
    },
  };
}
module.exports = { createAttachmentRepository };
```

Add the routes after `optionalCitizen` and `requireCitizenIncident` are available:

```js
const imageBody = express.raw({ type: ['image/jpeg', 'image/webp'], limit: 1_048_576 });
router.put('/:id/attachment', mediaLimiter, optionalCitizen, requireCitizenIncident, imageBody, async (req, res, next) => {
  try {
    const actor = req.citizen || { type: 'CITIZEN_CAPABILITY', incidentId: Number(req.params.id), role: 'CITIZEN' };
    res.status(201).json(await attachmentService.save({ incidentId: Number(req.params.id), actor,
      mimeType: req.headers['content-type'], bytes: req.body }));
  } catch (error) { next(error); }
});
router.get('/:id/attachment', requireIncidentActor, async (req, res, next) => {
  try {
    const file = await attachmentService.read({ incidentId: Number(req.params.id), actor: req.actor });
    if (!file) return res.status(404).end();
    res.type(file.mime_type).send(file.content);
  } catch (error) { next(error); }
});
```

- [ ] **Step 3: Add a failing retention test and implement privacy cleanup**

```js
// rescue-backend/test/unit/retentionJob.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { runRetentionOnce } = require('../../src/jobs/retentionJob');

test('retention removes payloads before de-identifying completed incidents', async () => {
  const sql = [];
  const db = { query: async (statement) => { sql.push(statement); return [{ affectedRows: 0 }]; } };
  await runRetentionOnce({ db, chatDays: 3, personalDays: 7 });
  assert.match(sql[0], /DELETE FROM incident_attachments/);
  assert.match(sql[1], /DELETE FROM chat_messages/);
  assert.match(sql[2], /citizen_phone = NULL/);
  assert.match(sql[2], /latitude = NULL/);
});
```

```js
// rescue-backend/src/jobs/retentionJob.js
async function runRetentionOnce({ db, chatDays, personalDays }) {
  await db.query('DELETE FROM incident_attachments WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [chatDays]);
  await db.query('DELETE FROM chat_messages WHERE timestamp < DATE_SUB(NOW(), INTERVAL ? DAY)', [chatDays]);
  await db.query(`UPDATE incidents SET citizen_phone = NULL, latitude = NULL, longitude = NULL, landmark = NULL
    WHERE status IN ('COMPLETED','CANCELLED') AND COALESCE(completed_at,cancelled_at) < DATE_SUB(NOW(), INTERVAL ? DAY)`, [personalDays]);
}

function startRetentionJob(options) {
  const run = () => runRetentionOnce(options).catch(options.onError || console.error);
  run(); const timer = setInterval(run, 60 * 60 * 1000); return () => clearInterval(timer);
}
module.exports = { runRetentionOnce, startRetentionJob };
```

- [ ] **Step 4: Add client compression and upload only after incident creation**

Write the failing compression test:

```js
// rescue-frontend/src/citizen/imageCompression.test.js
import { expect, it, vi } from 'vitest';
import { compressIncidentImage } from './imageCompression';

it('returns a JPEG no larger than one megabyte', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2400, height: 1200 })));
  const context = { drawImage: vi.fn() };
  const canvas = { width: 0, height: 0, getContext: () => context,
    toBlob: (callback, type) => callback(new Blob([new Uint8Array(900_000)], { type })) };
  vi.spyOn(document, 'createElement').mockReturnValue(canvas);
  const result = await compressIncidentImage(new File([new Uint8Array(2_000_000)], 'incident.jpg', { type: 'image/jpeg' }));
  expect(result.type).toBe('image/jpeg');
  expect(result.size).toBeLessThanOrEqual(1_048_576);
});
```

Run: `cd rescue-frontend && npx vitest run src/citizen/imageCompression.test.js`
Expected: FAIL with `Cannot find module './imageCompression'`.

Implement:

```js
// rescue-frontend/src/citizen/imageCompression.js
export async function compressIncidentImage(file, { maxBytes = 1_048_576, maxDimension = 1600 } = {}) {
  if (!['image/jpeg', 'image/webp'].includes(file.type)) throw { code: 'ATTACHMENT_REJECTED', message: 'รองรับเฉพาะ JPEG/WebP' };
  const image = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.82, 0.68, 0.54, 0.4]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= maxBytes) return blob;
  }
  throw { code: 'ATTACHMENT_REJECTED', message: 'รูปมีขนาดใหญ่เกิน 1 MB หลังบีบอัด' };
}
```

Then update `useIncidentSession.report`:

```js
const result = await api.post('/api/incidents', payload, { sessionToken });
const saved = { id: result.incident.id, incidentToken: result.citizen_token };
incidentStorage.save(saved);
let uploadWarning = null;
if (draft.photo) {
  try {
    const compressed = await compressIncidentImage(draft.photo, { maxBytes: 1_048_576, maxDimension: 1600 });
    await api.request({ method: 'put', url: `/api/incidents/${result.incident.id}/attachment`, data: compressed,
      incidentToken: result.citizen_token, headers: { 'Content-Type': compressed.type } });
  } catch (error) { uploadWarning = error; }
}
reportActionRef.current = null;
await join(saved, sessionToken);
if (uploadWarning || result.warning) dispatch({ type: 'ERROR', error: uploadWarning || result.warning });
```

If upload fails, retain the incident, show `ATTACHMENT_REJECTED`, and allow the citizen to continue tracking.

- [ ] **Step 5: Make service-worker caching static-only**

Replace the fetch handler in `rescue-frontend/public/sw.js`:

```js
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isApi = url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/');
  const isStaticGet = event.request.method === 'GET' && url.origin === self.location.origin && !isApi;
  if (!isStaticGet) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});
```

Increment `CACHE_NAME`; replace source-file URLs in `STATIC_ASSETS` with `/`, `/index.html`, and built/public icons only.

- [ ] **Step 6: Add health and degraded Redis behaviour**

`GET /health/live` returns `200 { ok: true }` if the process event loop is running. `GET /health/ready` pings MySQL and Redis and returns `200` only when both are ready. Replace the Task 4 report handler body so MySQL commits `REPORTED` before `dispatchService.start`; catch only the typed Redis-unavailable error and return the persisted incident:

```js
try {
  const input = {
    reportActionId: req.body.report_action_id, details: req.body.details,
    latitude: Number(req.body.latitude), longitude: Number(req.body.longitude),
    accuracy: Number(req.body.location_accuracy_m), landmark: req.body.landmark,
    citizenPhone: req.body.citizen_phone,
  };
  const result = await incidentService.report(input, req.citizen || { type: 'CITIZEN', id: null });
  try {
    await dispatchService.start(result.incident);
    const incident = await incidentService.snapshot(result.incident.id);
    return res.status(result.replayed ? 200 : 201).json({ incident, citizen_token: result.citizenToken });
  } catch (error) {
    if (error.code !== 'SERVICE_DEGRADED') throw error;
    return res.status(202).json({
      incident: result.incident,
      citizen_token: result.citizenToken,
      warning: { code: 'SERVICE_DEGRADED', message: 'รับข้อมูลแล้ว แต่ยังไม่เริ่มค้นหาหน่วย กรุณาโทร 1669' },
    });
  }
} catch (error) { next(error); }
```

Add this dispatch regression to `dispatchService.test.js`:

```js
test('start leaves a persisted incident REPORTED when Redis is unavailable', async () => {
  let transitioned = false;
  const service = createDispatchService({
    redis: { set: async () => { throw new Error('ECONNREFUSED'); } },
    transaction: async (work) => work({}),
    incidents: { transitionSystem: async () => { transitioned = true; } },
    events: { append: async () => {} }, presence: { freshCandidates: async () => [] },
    config: { offerRoundMs: 15_000 }, clock: { now: () => 1_000 }, randomUUID: () => 'event-id',
  });
  await assert.rejects(
    () => service.start({ id: 4, status: 'REPORTED', latitude: 13.7, longitude: 100.5 }),
    (error) => error.code === 'SERVICE_DEGRADED',
  );
  assert.equal(transitioned, false);
});
```

Add the HTTP contract test:

```js
// rescue-backend/test/unit/degradedReport.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createIncidentRoutes } = require('../../src/http/routes/incidentRoutes');
const { errorMiddleware } = require('../../src/http/errorMiddleware');

test('report returns 202 with the persisted REPORTED incident when dispatch Redis is unavailable', async (t) => {
  const app = express(); app.use(express.json());
  const pass = (_req, _res, next) => next();
  app.use('/api/incidents', createIncidentRoutes({
    incidentService: {
      report: async () => ({ incident: { id: 4, status: 'REPORTED' }, citizenToken: 'capability', replayed: false }),
      snapshot: async () => ({ id: 4, status: 'REPORTED' }),
    },
    dispatchService: { start: async () => { throw Object.assign(new Error('redis unavailable'), { code: 'SERVICE_DEGRADED' }); } },
    optionalCitizen: pass, requireCitizenIncident: pass, requireIncidentActor: pass, requireStaff: pass,
    reportLimiter: pass, mediaLimiter: pass, chatService: {}, attachmentService: {},
  }));
  app.use(errorMiddleware);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/incidents`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report_action_id: '00000000-0000-4000-8000-000000000001', latitude: 13.7, longitude: 100.5, location_accuracy_m: 8 }),
  });
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.incident.status, 'REPORTED');
  assert.equal(body.citizen_token, 'capability');
  assert.equal(body.warning.code, 'SERVICE_DEGRADED');
});
```

MySQL failure returns `503` and never returns an incident ID.

- [ ] **Step 7: Verify and commit privacy/reliability safeguards**

Run:

```bash
cd rescue-backend && node --test test/unit/attachmentService.test.js test/unit/retentionJob.test.js test/unit/degradedReport.test.js && npm test
cd ../rescue-frontend && npm test && npm run lint && npm run build
```

Expected: all checks PASS; `rg "cache.put\(event.request" rescue-frontend/public/sw.js` finds one static-only guarded path; `rg "LONGTEXT|image.*socket|FileReader" rescue-backend/src rescue-frontend/src/citizen` finds no image-over-socket implementation.

```bash
git add rescue-backend/src/repositories/attachmentRepository.js rescue-backend/src/services/attachmentService.js rescue-backend/src/jobs/retentionJob.js rescue-backend/src/http rescue-backend/test/unit rescue-frontend/src/citizen rescue-frontend/public/sw.js
git commit -m "feat: bound personal data and degraded modes"
```

---

### Task 12: Assemble the system, add integration/E2E coverage, and prove presentation readiness

**Files:**
- Create: `rescue-backend/src/createSystem.js`
- Create: `rescue-backend/src/notifications/line.js`
- Modify: `rescue-backend/src/http/createApp.js`
- Modify: `rescue-backend/server.js`
- Create: `rescue-backend/docker-compose.test.yml`
- Create: `rescue-backend/test/integration/helpers.js`
- Create: `rescue-backend/test/integration/rescueFlow.test.js`
- Create: `rescue-backend/test/integration/authorization.test.js`
- Create: `rescue-backend/test/integration/recovery.test.js`
- Create: `rescue-backend/test/integration/load.test.js`
- Create: `rescue-backend/scripts/seed-demo.js`
- Create: `rescue-backend/scripts/seedCore.js`
- Create: `rescue-backend/scripts/seed-test.js`
- Create: `rescue-backend/scripts/reset-demo.js`
- Modify: `rescue-backend/package.json`
- Create: `e2e/package.json`
- Create: `e2e/playwright.config.js`
- Create: `e2e/tests/rescue-flow.spec.js`
- Create: `e2e/tests/liff-smoke.md`
- Create: `docs/demo-script.md`
- Modify: `rescue-frontend/package.json`
- Modify: `rescue-web-admin/package.json`

**Interfaces:**
- Produces: `createSystem({ env, pool, redis, lineVerifier, lineNotifier })` returning `{ app, httpServer, io, runDispatchOnce, startJobs, close }` without listening automatically.
- Produces: reproducible `npm run test:integration`, Playwright `npm test`, `npm run seed:demo`, and guarded `npm run reset:demo` commands.
- Consumes every previous task.

- [ ] **Step 1: Write a failing system-factory smoke test**

```js
// rescue-backend/test/integration/helpers.js (first smoke assertion; expand below)
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSystem } = require('../../src/createSystem');

test('createSystem can be constructed with injected infrastructure without listening', async () => {
  const system = await createSystem({
    env: { INCIDENT_TOKEN_SECRET: 'incident-secret' },
    pool: { end: async () => {} }, redis: { quit: async () => {} }, jwtSecret: 'jwt-secret',
    migrate: async () => {},
    lineVerifier: async () => ({ sub: 'U1' }), lineNotifier: async () => {},
    corsOriginHandler: (_origin, callback) => callback(null, true),
  });
  assert.equal(typeof system.app, 'function');
  assert.equal(system.httpServer.listening, false);
  await system.close();
});
```

Run: `cd rescue-backend && node --test test/integration/helpers.js`
Expected: FAIL with `Cannot find module '../../src/createSystem'`.

- [ ] **Step 2: Implement dependency assembly and a bootstrap-only server**

```js
// rescue-backend/src/createSystem.js
const http = require('http');
const { Server } = require('socket.io');
const { createApp } = require('./http/createApp');
const { loadConfig } = require('./config');
const { createTransactionRunner } = require('./db/transaction');
const { runMigrations } = require('./db/migrate');
const reliableTrackingMigration = require('./db/migrations/001-reliable-tracking');
const { createIncidentRepository } = require('./repositories/incidentRepository');
const { createEventRepository } = require('./repositories/eventRepository');
const { createCitizenRepository } = require('./repositories/citizenRepository');
const { createStaffRepository } = require('./repositories/staffRepository');
const { createChatRepository } = require('./repositories/chatRepository');
const { createAttachmentRepository } = require('./repositories/attachmentRepository');
const { createCitizenAuthService } = require('./services/citizenAuthService');
const { createStaffAuthService } = require('./services/staffAuthService');
const { createIncidentService } = require('./services/incidentService');
const { createPresenceService } = require('./services/presenceService');
const { createDispatchService } = require('./services/dispatchService');
const { createChatService } = require('./services/chatService');
const { createAttachmentService } = require('./services/attachmentService');
const { createNotificationService } = require('./services/notificationService');
const { createSocketRateLimiter } = require('./services/socketRateLimiter');
const { RATE_LIMIT_POLICIES } = require('../rateLimiters');
const { createAdminService } = require('./services/adminService');
const { createAuthMiddleware } = require('./http/middleware/auth');
const { createSocketAuthenticator } = require('./realtime/authenticateSocket');
const { registerSocketHandlers } = require('./realtime/registerSocketHandlers');
const { startResumeDispatch } = require('./jobs/resumeDispatch');
const { startRetentionJob } = require('./jobs/retentionJob');
const crypto = require('crypto');
const { verifyPassword } = require('../auth');

async function createSystem(deps) {
  await (deps.migrate ? deps.migrate(deps.pool) : runMigrations(deps.pool, [reliableTrackingMigration]));
  const config = loadConfig(deps.env);
  if (!deps.env.INCIDENT_TOKEN_SECRET) throw new Error('INCIDENT_TOKEN_SECRET environment variable is required');
  const transaction = createTransactionRunner(deps.pool);
  const incidents = createIncidentRepository(deps.pool);
  const events = createEventRepository(deps.pool);
  const citizens = createCitizenRepository(deps.pool);
  const staff = createStaffRepository(deps.pool);
  let io;
  const publishIncident = async (incident) => {
    if (!io) return;
    io.to(`incident:${incident.parent_incident_id || incident.id}`).to('admins').emit('incident_updated', incident);
  };
  const citizenAuth = createCitizenAuthService({ citizens, jwtSecret: deps.jwtSecret,
    incidentTokenSecret: deps.env.INCIDENT_TOKEN_SECRET, verifyLineIdToken: deps.lineVerifier });
  const staffAuth = createStaffAuthService({ staff, verifyPassword, jwtSecret: deps.jwtSecret });
  const incidentService = createIncidentService({ transaction, incidents, events, randomUUID: crypto.randomUUID,
    issueIncidentToken: citizenAuth.issueIncidentToken, hashIncidentToken: citizenAuth.hashIncidentToken, publishIncident });
  const presence = createPresenceService(deps.redis, config);
  const dispatch = createDispatchService({ redis: deps.redis, transaction, incidents, events, presence, config,
    clock: { now: Date.now }, randomUUID: crypto.randomUUID,
    publishOffer: async (ids, incident) => ids.forEach((id) => io.to(`staff:${id}`).emit('mission_offer', { ...incident, incidentId: incident.id })) });
  const chat = createChatService({ repository: createChatRepository(deps.pool),
    canAccess: async (actor, id) => Boolean(await incidentService.assertAccess(actor, id)) });
  const attachments = createAttachmentService({ repository: createAttachmentRepository(deps.pool),
    canAccess: async (actor, id) => Boolean(await incidentService.assertAccess(actor, id)), maxBytes: config.maxAttachmentBytes });
  const notifications = createNotificationService({ citizens, incidents, lineNotifier: deps.lineNotifier });
  const socketRateLimiter = createSocketRateLimiter(deps.redis, {
    max: RATE_LIMIT_POLICIES.chat.max,
    windowSeconds: RATE_LIMIT_POLICIES.chat.windowMs / 1_000,
  });
  const auth = createAuthMiddleware({ jwtSecret: deps.jwtSecret, incidentRepository: incidents,
    hashIncidentToken: citizenAuth.hashIncidentToken });
  const admin = createAdminService({ transaction, incidents, events, dispatch, presence, incidentService,
    randomUUID: crypto.randomUUID, publishIncident });
  const services = { config, pool: deps.pool, staffRepository: staff, incidents: incidentService, incidentRepository: incidents, events, citizenAuth, staffAuth,
    presence, dispatch, chat, attachments, notifications, socketRateLimiter, admin, auth, lineNotifier: deps.lineNotifier,
    corsOriginHandler: deps.corsOriginHandler };
  const app = createApp(services);
  const httpServer = http.createServer(app);
  io = new Server(httpServer, { cors: { origin: deps.corsOriginHandler, methods: ['GET', 'POST'] } });
  io.use(createSocketAuthenticator({ jwtSecret: deps.jwtSecret, incidents,
    hashIncidentToken: citizenAuth.hashIncidentToken }));
  registerSocketHandlers(io, { ...services, incidents: incidentService });
  const stops = [];
  return {
    app, httpServer, io, runDispatchOnce: () => dispatch.tick(),
    startJobs() {
      stops.push(
        startResumeDispatch({ dispatchService: dispatch }),
        startRetentionJob({ db: deps.pool, chatDays: config.chatRetentionDays, personalDays: config.personalRetentionDays }),
      );
    },
    async close() {
      stops.splice(0).forEach((stop) => stop());
      if (httpServer.listening) await new Promise((resolve) => io.close(resolve));
      else io.removeAllListeners();
      await deps.redis.quit?.();
      await deps.pool.end?.();
    },
  };
}

module.exports = { createSystem };
```

Finalize `createApp` so all routes use the constructed services and one error boundary:

```js
// rescue-backend/src/http/createApp.js
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { errorMiddleware } = require('./errorMiddleware');
const { createAuthRoutes } = require('./routes/authRoutes');
const { createIncidentRoutes } = require('./routes/incidentRoutes');
const { createRescuerRoutes } = require('./routes/rescuerRoutes');
const { createAdminRoutes } = require('./routes/adminRoutes');

function createApp(s) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors({ origin: s.corsOriginHandler }));
  app.use(express.json({ limit: '256kb' }));
  app.use((req, res, next) => { req.correlationId = req.headers['x-request-id'] || crypto.randomUUID(); res.set('X-Request-Id', req.correlationId); next(); });
  app.get('/health/live', (_req, res) => res.json({ ok: true }));
  app.get('/health/ready', async (_req, res) => {
    try { await s.incidentRepository.ping(); await s.presence.ping(); res.json({ ok: true }); }
    catch { res.status(503).json({ ok: false }); }
  });
  const { sosLimiter, publicWriteLimiter, loginLimiter, mediaLimiter } = require('../../rateLimiters');
  app.use('/api', createAuthRoutes({ citizenAuthService: s.citizenAuth, staffAuthService: s.staffAuth, publicWriteLimiter, loginLimiter }));
  app.use('/api/incidents', createIncidentRoutes({ incidentService: s.incidents, dispatchService: s.dispatch, attachmentService: s.attachments,
    chatService: s.chat, optionalCitizen: s.auth.optionalCitizen, requireCitizenIncident: s.auth.requireCitizenIncident,
    requireIncidentActor: s.auth.requireIncidentActor, requireStaff: s.auth.requireStaff, reportLimiter: sosLimiter, mediaLimiter }));
  app.use('/api/rescuer', createRescuerRoutes({ requireStaff: s.auth.requireStaff, incidents: s.incidentRepository,
    pool: s.pool, staffRepository: s.staffRepository, publicWriteLimiter, lineNotifier: s.lineNotifier }));
  app.use('/api/admin', createAdminRoutes({ requireStaff: s.auth.requireStaff, requireAdmin: s.auth.requireAdmin,
    adminService: s.admin, pool: s.pool, staffRepository: s.staffRepository, lineNotifier: s.lineNotifier }));
  app.use(errorMiddleware);
  return app;
}
module.exports = { createApp };
```

Add these methods to their returned repository/service objects:

```js
// incidentRepository
async ping() { await pool.query('SELECT 1'); return true; },

// presenceService
async ping() { return redis.ping(); },
```

```js
// rescue-backend/server.js
require('dotenv').config();
const { createPool } = require('./src/db/createPool');
const { createSystem } = require('./src/createSystem');
const redisLibrary = require('redis');
const { getJwtSecret } = require('./jwtSecret');
const { isAllowedOrigin } = require('./corsConfig');
const { verifyLineIdTokenWithLine } = require('./src/services/citizenAuthService');
const { createLineNotifier } = require('./src/notifications/line');

(async () => {
  const redis = redisLibrary.createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
  await redis.connect();
  const corsOriginHandler = (origin, callback) => isAllowedOrigin(origin) ? callback(null, true) : callback(new Error('Not allowed by CORS'));
  const system = await createSystem({ env: process.env, pool: createPool(), redis,
    jwtSecret: getJwtSecret(), corsOriginHandler,
    lineVerifier: (token) => verifyLineIdTokenWithLine(token, process.env.LINE_CHANNEL_ID),
    lineNotifier: createLineNotifier({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN }),
  });
  system.startJobs();
  const port = Number(process.env.PORT || 3000);
  system.httpServer.listen(port, () => console.log(`Rescue listening on ${port}`));
  const shutdown = async () => { await system.close(); process.exit(0); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
})().catch((error) => { console.error('Startup failed', error); process.exit(1); });
```

```js
// rescue-backend/src/notifications/line.js
const axios = require('axios');
function createLineNotifier({ channelAccessToken }) {
  return async (lineUid, message) => {
    if (!lineUid || !channelAccessToken) return { sent: false, reason: 'NOT_CONFIGURED' };
    await axios.post('https://api.line.me/v2/bot/message/push', { to: lineUid, messages: [{ type: 'text', text: message }] },
      { headers: { Authorization: `Bearer ${channelAccessToken}`, 'Content-Type': 'application/json' } });
    return { sent: true };
  };
}
module.exports = { createLineNotifier };
```

- [ ] **Step 3: Add isolated MySQL/Redis integration infrastructure**

```yaml
# rescue-backend/docker-compose.test.yml
services:
  mysql-test:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: test-root
      MYSQL_DATABASE: rescue_test
      MYSQL_USER: rescue_test
      MYSQL_PASSWORD: rescue_test
    ports: ["3307:3306"]
    tmpfs: [/var/lib/mysql]
    volumes: ["./init.sql:/docker-entrypoint-initdb.d/init.sql:ro"]
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-ptest-root"]
      interval: 2s
      timeout: 2s
      retries: 30
  redis-test:
    image: redis:7-alpine
    ports: ["6380:6379"]
    tmpfs: [/data]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      timeout: 2s
      retries: 30
```

Create a real helper; no test imports `server.js`:

```js
// rescue-backend/test/integration/helpers.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const redisLibrary = require('redis');
const { io } = require('socket.io-client');
const { createSystem } = require('../../src/createSystem');
const { runMigrations } = require('../../src/db/migrate');
const migration = require('../../src/db/migrations/001-reliable-tracking');

const env = { DB_NAME: 'rescue_test', INCIDENT_TOKEN_SECRET: 'integration-incident-secret' };
const jwtSecret = 'integration-jwt-secret';
const connect = (socket) => new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
const emitAck = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));

async function createIntegrationContext(t) {
  const pool = mysql.createPool({ host: '127.0.0.1', port: 3307, user: 'rescue_test', password: 'rescue_test', database: 'rescue_test' });
  const redis = redisLibrary.createClient({ url: 'redis://127.0.0.1:6380' });
  await redis.connect(); await runMigrations(pool, [migration]);
  await pool.query('SET FOREIGN_KEY_CHECKS=0');
  for (const table of ['incident_attachments','chat_messages','incident_events','incidents','vehicles','users','citizens','foundations']) await pool.query(`TRUNCATE TABLE \`${table}\``);
  await pool.query('SET FOREIGN_KEY_CHECKS=1'); await redis.flushDb();
  const hash = await bcrypt.hash('demo-password', 10);
  const [foundation] = await pool.query("INSERT INTO foundations (name,contact_info) VALUES ('Demo Foundation','demo')");
  const foundationId = foundation.insertId;
  const ids = {};
  for (const [key, username, role] of [['admin','admin-demo','Admin'],['rescuer1','unit-01','Rescue'],['rescuer2','unit-02','Rescue']]) {
    const [result] = await pool.query('INSERT INTO users (username,password,role,foundation_id,is_approved) VALUES (?,?,?,?,TRUE)', [username, hash, role, foundationId]);
    ids[key] = result.insertId;
  }
  const tokens = {
    admin: jwt.sign({ id: ids.admin, role: 'Admin', foundation_id: foundationId }, jwtSecret),
    rescuer1: jwt.sign({ id: ids.rescuer1, role: 'Rescue', foundation_id: foundationId }, jwtSecret),
    rescuer2: jwt.sign({ id: ids.rescuer2, role: 'Rescue', foundation_id: foundationId }, jwtSecret),
  };
  const system = await createSystem({ env, pool, redis, jwtSecret, corsOriginHandler: (_origin, callback) => callback(null, true),
    lineVerifier: async () => ({ sub: 'U-test' }), lineNotifier: async () => ({ sent: true }) });
  await new Promise((resolve) => system.httpServer.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${system.httpServer.address().port}`;
  t.after(async () => { await system.close(); });
  const request = async (method, path, body, headers = {}) => {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  return {
    pool, redis, baseUrl, tokens,
    post: (path, body, headers) => request('POST', path, body, headers),
    get: (path, headers) => request('GET', path, null, headers),
    citizenSocket: (incidentId, incidentToken) => io(baseUrl, { autoConnect: false, auth: { incidentId, incidentToken } }),
    staffSocket: (token) => io(baseUrl, { autoConnect: false, auth: { token } }),
    dispatch: { tick: system.runDispatchOnce },
    events: async (incidentId) => (await pool.query('SELECT * FROM incident_events WHERE incident_id = ? ORDER BY id', [incidentId]))[0],
  };
}

const heartbeat = (socket, latitude, longitude) => emitAck(socket, 'heartbeat', { latitude, longitude, availability: 'AVAILABLE' });
const accept = (socket, incidentId) => emitAck(socket, 'mission_accept', { incidentId, clientActionId: require('crypto').randomUUID() });
module.exports = { createIntegrationContext, connect, emitAck, heartbeat, accept };
```

Add `socket.io-client` as a backend dev dependency and scripts:

```json
"test:integration": "node --test test/integration",
"test:all": "npm test && npm run test:integration",
"start:e2e": "node scripts/seed-test.js && node server.js",
"seed:demo": "node scripts/seed-demo.js",
"reset:demo": "node scripts/reset-demo.js"
```

- [ ] **Step 4: Write the complete three-client integration flow first**

```js
// rescue-backend/test/integration/rescueFlow.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createIntegrationContext, connect, emitAck, heartbeat, accept } = require('./helpers');

test('Web citizen, one of two rescuers, and admin converge on one completed incident', async (t) => {
  const ctx = await createIntegrationContext(t);
  const reportActionId = crypto.randomUUID();
  const unit1 = ctx.staffSocket(ctx.tokens.rescuer1);
  const unit2 = ctx.staffSocket(ctx.tokens.rescuer2);
  const admin = ctx.staffSocket(ctx.tokens.admin);
  await Promise.all([connect(unit1), connect(unit2), connect(admin)]);
  await heartbeat(unit1, 13.75, 100.50); await heartbeat(unit2, 13.76, 100.51);
  const report = await ctx.post('/api/incidents', { report_action_id: reportActionId, details: 'integration', latitude: 13.7563, longitude: 100.5018, location_accuracy_m: 9 });
  assert.equal(report.status, 201);
  const citizen = ctx.citizenSocket(report.body.incident.id, report.body.citizen_token);
  await connect(citizen);
  const [a, b] = await Promise.all([accept(unit1, report.body.incident.id), accept(unit2, report.body.incident.id)]);
  assert.equal([a, b].filter((result) => result.ok).length, 1);
  const winner = a.ok ? unit1 : unit2;
  await emitAck(winner, 'incident_transition', { incidentId: report.body.incident.id, status: 'ARRIVED', clientActionId: crypto.randomUUID() });
  await emitAck(winner, 'incident_transition', { incidentId: report.body.incident.id, status: 'COMPLETED', clientActionId: crypto.randomUUID() });
  const snapshot = await ctx.get(`/api/incidents/${report.body.incident.id}`, { 'X-Incident-Token': report.body.citizen_token });
  assert.equal(snapshot.body.status, 'COMPLETED');
  assert.equal((await ctx.events(report.body.incident.id)).map((event) => event.to_status).includes('ARRIVED'), true);
});
```

Run before completing helper implementation. Expected initial failure: missing helpers/routes or wrong state. Implement one missing contract at a time until the test passes.

- [ ] **Step 5: Add authorization, idempotency, TTL, reconnect, and degraded-mode integration tests**

`authorization.test.js` must assert `403/FORBIDDEN` or negative socket acknowledgement for:

- wrong/missing incident capability;
- unassigned rescuer snapshot/chat/location/transition;
- rescuer joining admin data;
- citizen changing `EN_ROUTE` to `COMPLETED`;
- spoofed `user_id`, `vehicle_id`, sender, or room fields.

`recovery.test.js` must assert:

- the same `report_action_id` returns one incident and the same usable capability token;
- the same action/message IDs create one event/message;
- removing a presence key excludes the GEO member from dispatch;
- a client REST-hydrates and rejoins after reconnect;
- restarting the app with a `SEARCHING` row resumes the search;
- Redis failure after report persistence returns `202 SERVICE_DEGRADED` and never claims `SEARCHING`;
- 120-second search expiry commits `NO_UNIT_AVAILABLE` once.

```js
// rescue-backend/test/integration/load.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createIntegrationContext, connect, emitAck, heartbeat } = require('./helpers');

test('20 authorized listeners receive location under the presentation thresholds', async (t) => {
  const ctx = await createIntegrationContext(t);
  const rescuer = ctx.staffSocket(ctx.tokens.rescuer1); await connect(rescuer); await heartbeat(rescuer, 13.75, 100.50);
  const reportStarted = performance.now();
  const offerPromise = new Promise((resolve) => rescuer.once('mission_offer', () => resolve(performance.now() - reportStarted)));
  const report = await ctx.post('/api/incidents', { report_action_id: crypto.randomUUID(), details: 'load',
    latitude: 13.7563, longitude: 100.5018, location_accuracy_m: 8 });
  const firstOfferMs = await offerPromise;
  const accepted = await emitAck(rescuer, 'mission_accept', { incidentId: report.body.incident.id, clientActionId: crypto.randomUUID() });
  assert.equal(accepted.ok, true);
  const listeners = Array.from({ length: 20 }, () => ctx.citizenSocket(report.body.incident.id, report.body.citizen_token));
  await Promise.all(listeners.map(connect));
  await Promise.all(listeners.map((socket) => emitAck(socket, 'join_incident', { incidentId: report.body.incident.id })));
  const started = performance.now();
  const arrivals = listeners.map((socket) => new Promise((resolve) => socket.once('location_updated', () => resolve(performance.now() - started))));
  await emitAck(rescuer, 'location_update', { incidentId: report.body.incident.id, latitude: 13.751, longitude: 100.501 });
  const latencies = (await Promise.all(arrivals)).sort((a, b) => a - b);
  const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1];
  t.diagnostic(`first_offer_ms=${firstOfferMs.toFixed(1)} socket_p95_ms=${p95.toFixed(1)}`);
  assert.ok(firstOfferMs < 5_000); assert.ok(p95 < 2_000);
});
```

- [ ] **Step 6: Add guarded demo seed/reset scripts**

```js
// rescue-backend/scripts/seedCore.js
const bcrypt = require('bcrypt');
async function seedCore(pool, passwordText) {
  const password = await bcrypt.hash(passwordText, 10);
  const [foundation] = await pool.query("INSERT INTO foundations (name,contact_info) VALUES ('Rescue Capstone Demo','simulation only')");
  const accounts = [['admin-demo','Admin'],['unit-01','Rescue'],['unit-02','Rescue'],['unit-03','Rescue']];
  for (const [username, role] of accounts) {
    await pool.query('INSERT INTO users (username,password,role,foundation_id,is_approved) VALUES (?,?,?,?,TRUE)',
      [username, password, role, foundation.insertId]);
  }
  return accounts.map(([username, role]) => ({ username, role }));
}
module.exports = { seedCore };
```

```js
// rescue-backend/scripts/seed-demo.js
require('dotenv').config();
const { createPool } = require('../src/db/createPool');
const { runMigrations } = require('../src/db/migrate');
const migration = require('../src/db/migrations/001-reliable-tracking');
const { seedCore } = require('./seedCore');
if (process.env.NODE_ENV !== 'demo' || !String(process.env.DB_NAME || '').endsWith('_demo') || !process.env.DEMO_PASSWORD) {
  console.error('NODE_ENV=demo, a *_demo database, and DEMO_PASSWORD are required'); process.exit(2);
}
(async () => {
  const pool = createPool(); await runMigrations(pool, [migration]);
  const [[counts]] = await pool.query('SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM incidents) AS incidents');
  if (Number(counts.users) || Number(counts.incidents)) throw new Error('Demo database is not empty; use reset:demo');
  console.log(await seedCore(pool, process.env.DEMO_PASSWORD)); await pool.end();
})().catch((error) => { console.error(error); process.exit(1); });
```

```js
// rescue-backend/scripts/reset-demo.js
require('dotenv').config();
const { createPool } = require('../src/db/createPool');
const { seedCore } = require('./seedCore');
const redisLibrary = require('redis');
if (process.env.NODE_ENV !== 'demo' || !String(process.env.DB_NAME || '').endsWith('_demo')) {
  console.error('Refusing reset: NODE_ENV=demo and a *_demo database are required');
  process.exit(2);
}
if (!process.env.DEMO_PASSWORD || process.env.ALLOW_DEMO_REDIS_FLUSH !== 'true') {
  console.error('DEMO_PASSWORD and ALLOW_DEMO_REDIS_FLUSH=true are required'); process.exit(2);
}
(async () => {
  const pool = createPool();
  await pool.query('SET FOREIGN_KEY_CHECKS=0');
  for (const table of ['incident_attachments','chat_messages','incident_events','incidents','vehicles','users','citizens','foundations']) {
    await pool.query(`TRUNCATE TABLE \`${table}\``);
  }
  await pool.query('SET FOREIGN_KEY_CHECKS=1');
  const accounts = await seedCore(pool, process.env.DEMO_PASSWORD);
  const redis = redisLibrary.createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
  await redis.connect(); await redis.flushDb(); await redis.quit();
  console.log(accounts.map(({ username, role }) => `${username} (${role})`).join('\n'));
  await pool.end();
})().catch((error) => { console.error(error); process.exit(1); });
```

The database guards plus explicit `ALLOW_DEMO_REDIS_FLUSH=true` make the reset refuse development/production targets by default. It prints usernames and roles, never passwords or tokens.

- [ ] **Step 7: Add Playwright multi-context E2E tests**

```json
// e2e/package.json
{
  "private": true,
  "scripts": { "test": "playwright test" },
  "devDependencies": { "@playwright/test": "^1.54.0" }
}
```

```js
// e2e/playwright.config.js
const { defineConfig } = require('@playwright/test');
const backendEnv = 'NODE_ENV=test PORT=3100 DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=rescue_test DB_PASSWORD=rescue_test DB_NAME=rescue_test REDIS_URL=redis://127.0.0.1:6380 JWT_SECRET=e2e-jwt-secret INCIDENT_TOKEN_SECRET=e2e-incident-secret';
module.exports = defineConfig({
  testDir: './tests', timeout: 60_000, retries: 0, workers: 1,
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    { command: `cd ../rescue-backend && ${backendEnv} npm run start:e2e`, url: 'http://127.0.0.1:3100/health/ready', reuseExistingServer: false, timeout: 120_000 },
    { command: 'cd ../rescue-frontend && VITE_API_URL=http://127.0.0.1:3100 npm run dev -- --host 127.0.0.1 --port 5173', url: 'http://127.0.0.1:5173', reuseExistingServer: false },
    { command: 'cd ../rescue-web-admin && VITE_API_URL=http://127.0.0.1:3100 npm run dev -- --host 127.0.0.1 --port 5174', url: 'http://127.0.0.1:5174', reuseExistingServer: false },
  ],
});
```

Implement the guarded E2E seed:

```js
// rescue-backend/scripts/seed-test.js
require('dotenv').config();
const bcrypt = require('bcrypt');
const { createPool } = require('../src/db/createPool');
const { runMigrations } = require('../src/db/migrate');
const migration = require('../src/db/migrations/001-reliable-tracking');

if (process.env.NODE_ENV !== 'test' || !String(process.env.DB_NAME || '').endsWith('_test')) {
  console.error('Refusing E2E seed outside a *_test database'); process.exit(2);
}
(async () => {
  const pool = createPool(); await runMigrations(pool, [migration]);
  await pool.query('SET FOREIGN_KEY_CHECKS=0');
  for (const table of ['incident_attachments','chat_messages','incident_events','incidents','vehicles','users','citizens','foundations']) await pool.query(`TRUNCATE TABLE \`${table}\``);
  await pool.query('SET FOREIGN_KEY_CHECKS=1');
  const password = await bcrypt.hash(process.env.DEMO_PASSWORD || 'demo-password', 10);
  const [foundation] = await pool.query("INSERT INTO foundations (name,contact_info) VALUES ('E2E Foundation','test only')");
  for (const [username, role] of [['admin-demo','Admin'],['unit-01','Rescue'],['unit-02','Rescue']]) {
    await pool.query('INSERT INTO users (username,password,role,foundation_id,is_approved) VALUES (?,?,?,?,TRUE)', [username, password, role, foundation.insertId]);
  }
  await pool.end();
})().catch((error) => { console.error(error); process.exit(1); });
```

```js
// e2e/tests/rescue-flow.spec.js
const { test, expect } = require('@playwright/test');

async function login(page, username, password) {
  await page.getByLabel(/ชื่อผู้ใช้|username/i).fill(username);
  await page.getByLabel(/รหัสผ่าน|password/i).fill(password);
  await page.getByRole('button', { name: /เข้าสู่ระบบ|login/i }).click();
}
const citizenUrl = process.env.CITIZEN_URL || 'http://127.0.0.1:5173';
const adminUrl = process.env.ADMIN_URL || 'http://127.0.0.1:5174';
const demoPassword = process.env.DEMO_PASSWORD || 'demo-password';
const loginRescuer = (page) => login(page, 'unit-01', demoPassword);
const loginAdmin = (page) => login(page, 'admin-demo', demoPassword);

test('citizen sees the same lifecycle driven by rescuer and admin', async ({ browser }) => {
  const citizen = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 13.7563, longitude: 100.5018 } });
  const rescuer = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 13.7500, longitude: 100.5000 } });
  const admin = await browser.newContext();
  const citizenPage = await citizen.newPage(); const rescuerPage = await rescuer.newPage(); const adminPage = await admin.newPage();
  await citizenPage.goto(citizenUrl);
  await expect(citizenPage.getByRole('link', { name: /โทร 1669/ })).toBeVisible();
  await citizenPage.getByRole('button', { name: /ยืนยันว่าจุดนี้ถูกต้อง/ }).click();
  await rescuerPage.goto(`${citizenUrl}/login`);
  await loginRescuer(rescuerPage);
  await rescuerPage.getByRole('button', { name: /ออนไลน์/ }).click();
  await rescuerPage.getByRole('button', { name: /รับภารกิจ/ }).click();
  await expect(citizenPage.getByText(/กำลังเดินทาง/)).toBeVisible();
  await rescuerPage.getByRole('button', { name: /ถึงจุดเกิดเหตุแล้ว/ }).click();
  await expect(citizenPage.getByText(/ถึงจุดเกิดเหตุ/)).toBeVisible();
  await adminPage.goto(adminUrl); await loginAdmin(adminPage);
  await expect(adminPage.getByText(/ARRIVED/)).toBeVisible();
});
```

Add separate scenarios for no unit, offline/reconnect, stale unit, unauthorized incident access, and simultaneous accept. Use API seeding in `beforeEach`; do not depend on test order.

- [ ] **Step 8: Write and execute the physical LIFF smoke checklist**

`e2e/tests/liff-smoke.md` contains checkboxes for:

1. Open LIFF inside LINE on one physical device.
2. Confirm the backend session was created from an ID token and no `line_uid` appears in the request body.
3. Grant GPS, move/confirm the pin, and report.
4. Background LINE for 20 seconds, reopen, and confirm REST restoration.
5. Receive assignment/location/chat/arrival/completion.
6. Deny GPS once and verify retry/manual-pin/1669 actions.
7. Capture screenshots and date/device/browser version for the research appendix.

- [ ] **Step 9: Write the five-run demo script and execute the full gate**

`docs/demo-script.md` starts with: “ระบบนี้เป็นต้นแบบงานวิจัย ไม่ได้เชื่อมต่อหรือทดแทน 1669”. It lists seed/reset, three login roles, the exact click sequence, expected timestamps, no-unit fallback, reconnect fallback, and cleanup.

Run:

```bash
cd rescue-backend
docker compose -f docker-compose.test.yml up -d
npm run test:all
cd ../rescue-frontend && npm test && npm run lint && npm run build
cd ../rescue-web-admin && npm test && npm run lint && npm run build
cd ../e2e && npm install && npx playwright install chromium && npm test
```

Expected:

- all backend unit/integration tests PASS with no open handles;
- both frontend test suites PASS;
- both ESLint runs report `0` errors/warnings;
- both Vite builds exit `0`;
- all Playwright scenarios PASS;
- five manual seeded Web demo runs complete consecutively without database repair;
- the physical LIFF checklist is complete;
- staging load with 20 sockets records p95 authorized event delivery below two seconds and first offer below five seconds.

- [ ] **Step 10: Remove compatibility paths and verify forbidden patterns**

Delete any legacy route handlers explicitly retained during Tasks 4–10 after their modular replacements pass integration tests, then remove the old socket event names. Run:

```bash
rg "join_incident_room|send_chat_message|go_online|go_offline|update_vehicle_location|params: \{ token|dispatchState|catch\(\(\) => \{\}\)|origin: '\*'|line_uid.*req.body" rescue-backend rescue-frontend rescue-web-admin -g '!**/node_modules/**' -g '!**/dist/**'
```

Expected: no matches except migration comments or explicitly named regression tests. Re-run the complete gate from Step 9 after deletion.

- [ ] **Step 11: Commit the presentation-ready vertical flow**

```bash
git add rescue-backend/src/createSystem.js rescue-backend/src/http/createApp.js rescue-backend/server.js rescue-backend/docker-compose.test.yml rescue-backend/test/integration rescue-backend/scripts rescue-backend/package.json rescue-backend/package-lock.json e2e docs/demo-script.md rescue-frontend/package.json rescue-web-admin/package.json
git commit -m "test: prove rescue prototype presentation readiness"
```

---

## Execution Checkpoints

- After Task 3: review lifecycle semantics and migration safety before wiring routes.
- After Task 7: run a focused security review of REST and Socket.IO ownership before any UI relies on it.
- After Task 10: manually inspect all three responsive layouts in Web and LINE-sized viewports.
- After Task 12: do not claim completion until the fresh full-gate output and the five-run demo record are available.

## Final Acceptance Evidence

The final implementation handoff must include:

- the commit range produced by Tasks 1–12;
- exact unit/integration/component/E2E test counts;
- lint and production-build outputs for both frontends;
- a table of five consecutive demo runs with report, accept, arrival, and completion times;
- the physical LIFF smoke-test record;
- p95 socket delivery and first-offer measurements;
- any remaining limitation, especially the explicit absence of official 1669 integration.
