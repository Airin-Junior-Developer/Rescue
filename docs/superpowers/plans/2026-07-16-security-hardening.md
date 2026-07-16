# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five security gaps identified in the design spec (open CORS, unauthenticated citizen chat/status/socket access, weak JWT secret fallback, plaintext password login, no rate limiting) in `rescue-backend`, plus the minimal frontend changes required to keep the citizen and driver apps working with the new auth checks.

**Architecture:** Extract each piece of pure/testable logic (origin allowlist check, JWT secret loading, password verification, rate limiter config) into small, dependency-free CommonJS modules under `rescue-backend/`, each with a `node --test` unit test. `rescue-backend/server.js` (already a flat single-file backend — do not restructure it further) wires these modules into the existing Express routes and Socket.io handlers. Behavior that's inherently coupled to MySQL/Redis/Socket.io lifecycle (token generation on incident creation, REST enforcement, socket-join enforcement) is verified manually against the local docker-compose stack, matching how this project is already tested (see `TROUBLESHOOTING.txt`) — there is no existing test DB/integration harness, and building one is out of scope for this plan.

**Tech Stack:** Node.js (CommonJS), Express 5, Socket.io, MySQL (mysql2), Redis, `express-rate-limit` (new dependency), Node's built-in `node:test` + `node:assert` (no new test framework), React + Vite (frontend, unchanged tooling).

## Global Constraints

- Backend code stays CommonJS (`require`/`module.exports`) — matches every existing file in `rescue-backend/`.
- No new test framework (no jest/mocha/vitest) — use Node's built-in `node --test` runner (requires Node 18+, already implied by `express@5` in `rescue-backend/package.json`).
- New backend source files stay flat in `rescue-backend/` (matches existing convention: `hashPasswords.js`, `migrate.js`, `fix_phone.js` are all flat, no subfolders except the new `test/`).
- Do not restructure `server.js` beyond what each task requires — it stays the single entry point.
- Rate limits (per IP): `POST /api/incidents` 5 req / 10 min; `POST /api/login` 10 req / 15 min; `POST /api/citizen/auth`, `POST /api/citizen/register-phone`, `POST /api/rescuers/register` 20 req / 15 min.
- Demo accounts to purge from the DB: `adminA`, `rescueA1`, `adminB`, `rescueB1` (all share password `"password"`).
- Frontend has no automated test framework installed — frontend tasks are verified manually in the browser against the local dev stack (`docker-compose up -d` + `npm run dev` per `TROUBLESHOOTING.txt`), per the "test in browser before claiming done" rule for UI changes.
- Every new/modified backend route or socket handler must keep its existing response shape for success cases — only the rejection paths (CORS error, 403, 429, refused socket join) are new.

---

### Task 1: Rate limiting

**Files:**
- Create: `rescue-backend/rateLimiters.js`
- Create: `rescue-backend/test/rateLimiters.test.js`
- Modify: `rescue-backend/package.json` (add `express-rate-limit` dependency, add `test` script)
- Modify: `rescue-backend/server.js` (top of file: add `trust proxy` + import limiters; apply limiters to 5 routes)

**Interfaces:**
- Produces: `rescue-backend/rateLimiters.js` exports `{ sosLimiter, loginLimiter, publicWriteLimiter }` — each an Express middleware function (the return value of `rateLimit({...})` from `express-rate-limit`).
- Consumes: nothing from other tasks.

- [ ] **Step 1: Install the dependency**

Run: `cd rescue-backend && npm install express-rate-limit`
Expected: `package.json` gains `"express-rate-limit": "^<version>"` under `dependencies`, and `package-lock.json` updates.

- [ ] **Step 2: Add the `test` script to package.json**

Modify `rescue-backend/package.json` — the `"scripts"` block currently reads:
```json
  "scripts": {
    "dev": "nodemon server.js",
    "start": "node server.js"
  },
```
Change to:
```json
  "scripts": {
    "dev": "nodemon server.js",
    "start": "node server.js",
    "test": "node --test test/"
  },
```

- [ ] **Step 3: Write the failing test**

Create `rescue-backend/test/rateLimiters.test.js`:
```js
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd rescue-backend && node --test test/rateLimiters.test.js`
Expected: FAIL — `Cannot find module '../rateLimiters'`

- [ ] **Step 5: Write the implementation**

Create `rescue-backend/rateLimiters.js`:
```js
const rateLimit = require('express-rate-limit');

const sosLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const publicWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { sosLimiter, loginLimiter, publicWriteLimiter };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd rescue-backend && node --test test/rateLimiters.test.js`
Expected: PASS — `# pass 1`

- [ ] **Step 7: Wire the limiters into server.js**

In `rescue-backend/server.js`, the top of the file currently reads:
```js
const express = require('express');
const axios = require('axios');
const mysql = require('mysql2/promise');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const redis = require('redis');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();


const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
```
Add the import and `trust proxy` setting (needed because this server runs behind Railway's reverse proxy — without it, `express-rate-limit` sees the proxy's IP for every request and rate-limits all users together):
```js
const express = require('express');
const axios = require('axios');
const mysql = require('mysql2/promise');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const redis = require('redis');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { sosLimiter, loginLimiter, publicWriteLimiter } = require('./rateLimiters');
require('dotenv').config();


const app = express();
app.set('trust proxy', 1); // Railway sits in front of this server; without this, rate limiting keys off the proxy's IP for every request
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
```

Then apply each limiter to its route. Five route declarations change their signature from `async (req, res) => {` to include the limiter as middleware:

- `app.post('/api/incidents', async (req, res) => {` → `app.post('/api/incidents', sosLimiter, async (req, res) => {`
- `app.post('/api/login', async (req, res) => {` → `app.post('/api/login', loginLimiter, async (req, res) => {`
- `app.post('/api/citizen/auth', async (req, res) => {` → `app.post('/api/citizen/auth', publicWriteLimiter, async (req, res) => {`
- `app.post('/api/citizen/register-phone', async (req, res) => {` → `app.post('/api/citizen/register-phone', publicWriteLimiter, async (req, res) => {`
- `app.post('/api/rescuers/register', async (req, res) => {` → `app.post('/api/rescuers/register', publicWriteLimiter, async (req, res) => {`

- [ ] **Step 8: Manually verify against the running server**

Run: `cd rescue-backend && docker-compose up -d && npm run dev` (leave running)
In a second terminal, run:
```bash
for i in $(seq 1 6); do curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3000/api/login -H "Content-Type: application/json" -d '{"username":"nope","password":"nope"}'; done
```
Expected: first 10 print `401` (invalid credentials, under the limit), the request past 10 (this loop only sends 6, safe to stay under) still succeeds in status terms — re-run the loop with `seq 1 11` once to confirm the 11th response is `429`.

- [ ] **Step 9: Commit**

```bash
git add rescue-backend/package.json rescue-backend/package-lock.json rescue-backend/rateLimiters.js rescue-backend/test/rateLimiters.test.js rescue-backend/server.js
git commit -m "feat: add rate limiting to SOS, login, and public write endpoints"
```

---

### Task 2: Remove JWT_SECRET fallback

**Files:**
- Create: `rescue-backend/jwtSecret.js`
- Create: `rescue-backend/test/jwtSecret.test.js`
- Modify: `rescue-backend/server.js:37`

**Interfaces:**
- Produces: `rescue-backend/jwtSecret.js` exports `{ getJwtSecret(env = process.env) }` — returns the secret string or throws.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing test**

Create `rescue-backend/test/jwtSecret.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const { getJwtSecret } = require('../jwtSecret');

test('getJwtSecret throws when JWT_SECRET is missing', () => {
  assert.throws(() => getJwtSecret({}), /JWT_SECRET environment variable is required/);
});

test('getJwtSecret returns the value when present', () => {
  assert.strictEqual(getJwtSecret({ JWT_SECRET: 'abc123' }), 'abc123');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd rescue-backend && node --test test/jwtSecret.test.js`
Expected: FAIL — `Cannot find module '../jwtSecret'`

- [ ] **Step 3: Write the implementation**

Create `rescue-backend/jwtSecret.js`:
```js
function getJwtSecret(env = process.env) {
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return env.JWT_SECRET;
}

module.exports = { getJwtSecret };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd rescue-backend && node --test test/jwtSecret.test.js`
Expected: PASS — `# pass 2`

- [ ] **Step 5: Wire it into server.js**

`rescue-backend/server.js` line 37 currently reads:
```js
const JWT_SECRET = process.env.JWT_SECRET || 'rescue_super_secret_key';
```
Change to (add the `require` near the other top-of-file requires alongside the Task 1 import, and replace the declaration where it currently sits):
```js
const { getJwtSecret } = require('./jwtSecret');
```
```js
const JWT_SECRET = getJwtSecret();
```

- [ ] **Step 6: Manually verify the fail-fast behavior**

Run: `cd rescue-backend && JWT_SECRET= node server.js` (empty value simulates missing env var — adjust if your shell requires `unset JWT_SECRET; node server.js` instead, after temporarily removing it from `.env`)
Expected: process exits immediately with `Error: JWT_SECRET environment variable is required` printed to stderr, server never reaches `Started on port 3000`.

Then confirm normal boot still works: `cd rescue-backend && npm run dev`
Expected: `🚀 Automated Grab-style Dispatch Server on port 3000` prints as before.

- [ ] **Step 7: Commit**

```bash
git add rescue-backend/jwtSecret.js rescue-backend/test/jwtSecret.test.js rescue-backend/server.js
git commit -m "fix: fail fast at boot instead of falling back to a hardcoded JWT secret"
```

---

### Task 3: CORS lockdown

**Files:**
- Create: `rescue-backend/corsConfig.js`
- Create: `rescue-backend/test/corsConfig.test.js`
- Modify: `rescue-backend/server.js:13-35` (approx., original line numbers — shifts after Tasks 1-2 land)

**Interfaces:**
- Produces: `rescue-backend/corsConfig.js` exports `{ allowedOrigins, isAllowedOrigin(origin) }` — `isAllowedOrigin` returns `boolean`.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing test**

Create `rescue-backend/test/corsConfig.test.js`:
```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd rescue-backend && node --test test/corsConfig.test.js`
Expected: FAIL — `Cannot find module '../corsConfig'`

- [ ] **Step 3: Write the implementation**

Create `rescue-backend/corsConfig.js`:
```js
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3002',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3002',
];

function isAllowedOrigin(origin) {
  if (!origin) return true; // mobile apps, curl, server-to-server calls send no Origin header
  if (allowedOrigins.includes(origin)) return true;
  if (origin.endsWith('.vercel.app')) return true;
  if (origin.endsWith('.railway.app')) return true;
  return false;
}

module.exports = { allowedOrigins, isAllowedOrigin };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd rescue-backend && node --test test/corsConfig.test.js`
Expected: PASS — `# pass 5`

- [ ] **Step 5: Wire it into server.js**

`rescue-backend/server.js` currently has (near the top, after Task 1/2 requires have been added above it):
```js
const app = express();
app.set('trust proxy', 1); // Railway sits in front of this server; without this, rate limiting keys off the proxy's IP for every request
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3002',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3002',
];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    // Allow all Vercel deployments and localhost
    if (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app') || origin.endsWith('.railway.app')) {
      return callback(null, true);
    }
    callback(null, true); // Allow all for now during testing
  },
  credentials: true
}));
app.use(express.json());
```
Replace with:
```js
const { isAllowedOrigin } = require('./corsConfig');

const corsOriginHandler = (origin, callback) => {
  if (isAllowedOrigin(origin)) return callback(null, true);
  callback(new Error('Not allowed by CORS'));
};

const app = express();
app.set('trust proxy', 1); // Railway sits in front of this server; without this, rate limiting keys off the proxy's IP for every request
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: corsOriginHandler, methods: ['GET', 'POST'] } });

app.use(cors({
  origin: corsOriginHandler,
  credentials: true
}));
app.use(express.json());
```
(Add the `const { isAllowedOrigin } = require('./corsConfig');` line up with the other `require`s at the very top of the file if you prefer — functionally identical either place, since `app` isn't referenced until after.)

- [ ] **Step 6: Manually verify rejection and acceptance**

Run: `cd rescue-backend && npm run dev` (leave running)
In a second terminal:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://evil.com" http://127.0.0.1:3000/api/foundations/public
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: http://localhost:5173" http://127.0.0.1:3000/api/foundations/public
```
Expected: first command still returns `200` for the raw HTTP status (Express CORS rejection happens by omitting CORS headers, not blocking the response server-side, for a simple GET) — the real check is that the response has no `Access-Control-Allow-Origin` header for `evil.com`. Run instead:
```bash
curl -s -D - -o /dev/null -H "Origin: https://evil.com" http://127.0.0.1:3000/api/foundations/public | grep -i access-control
curl -s -D - -o /dev/null -H "Origin: http://localhost:5173" http://127.0.0.1:3000/api/foundations/public | grep -i access-control
```
Expected: first command prints nothing (no `Access-Control-Allow-Origin` header — browser will block the response), second prints `Access-Control-Allow-Origin: http://localhost:5173`.

- [ ] **Step 7: Commit**

```bash
git add rescue-backend/corsConfig.js rescue-backend/test/corsConfig.test.js rescue-backend/server.js
git commit -m "fix: reject disallowed CORS origins instead of allowing all as a fallback"
```

---

### Task 4: Remove plaintext password fallback + demo account cleanup script

**Files:**
- Create: `rescue-backend/auth.js`
- Create: `rescue-backend/test/auth.test.js`
- Create: `rescue-backend/removeDemoAccounts.js`
- Modify: `rescue-backend/server.js` (login route, ~lines 178-201 original)

**Interfaces:**
- Produces: `rescue-backend/auth.js` exports `{ verifyPassword(plainPassword, storedHash) }` — returns `Promise<boolean>`.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing test**

Create `rescue-backend/test/auth.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcrypt');
const { verifyPassword } = require('../auth');

test('verifyPassword returns true for a correct bcrypt hash', async () => {
  const hash = await bcrypt.hash('correct-password', 10);
  assert.strictEqual(await verifyPassword('correct-password', hash), true);
});

test('verifyPassword returns false for a wrong password', async () => {
  const hash = await bcrypt.hash('correct-password', 10);
  assert.strictEqual(await verifyPassword('wrong-password', hash), false);
});

test('verifyPassword returns false when the stored value is plaintext, not a hash', async () => {
  // This is the regression this fix prevents: a plaintext-stored password must
  // never authenticate, even if the submitted password string matches it exactly.
  assert.strictEqual(await verifyPassword('password', 'password'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd rescue-backend && node --test test/auth.test.js`
Expected: FAIL — `Cannot find module '../auth'`

- [ ] **Step 3: Write the implementation**

Create `rescue-backend/auth.js`:
```js
const bcrypt = require('bcrypt');

async function verifyPassword(plainPassword, storedHash) {
  return bcrypt.compare(plainPassword, storedHash);
}

module.exports = { verifyPassword };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd rescue-backend && node --test test/auth.test.js`
Expected: PASS — `# pass 3`

- [ ] **Step 5: Wire it into server.js**

`rescue-backend/server.js` login route currently has:
```js
            const isMatch = user.password.startsWith('$2b$') ? await bcrypt.compare(password, user.password) : password === user.password;
```
Replace with:
```js
            const isMatch = await verifyPassword(password, user.password);
```
Add the import near the other new requires at the top of the file:
```js
const { verifyPassword } = require('./auth');
```

- [ ] **Step 6: Write the demo account cleanup script**

Create `rescue-backend/removeDemoAccounts.js` (one-off script, run manually before deploying this change — matches the existing pattern of `resetAdmin.js`/`fix_phone.js`):
```js
const mysql = require('mysql2/promise');
require('dotenv').config();

const DEMO_USERNAMES = ['adminA', 'rescueA1', 'adminB', 'rescueB1'];

async function removeDemoAccounts() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [result] = await pool.query('DELETE FROM users WHERE username IN (?)', [DEMO_USERNAMES]);
  console.log(`Deleted ${result.affectedRows} demo account(s): ${DEMO_USERNAMES.join(', ')}`);
  await pool.end();
}

removeDemoAccounts().catch((e) => {
  console.error('Failed to remove demo accounts:', e);
  process.exit(1);
});
```

- [ ] **Step 7: Manually verify against the running server**

Run: `cd rescue-backend && docker-compose up -d && npm run dev` (leave running)
In a second terminal, confirm a demo account still logs in *before* cleanup (baseline):
```bash
curl -s -X POST http://127.0.0.1:3000/api/login -H "Content-Type: application/json" -d '{"username":"adminA","password":"password"}'
```
Expected: `{"message":"Login successful",...}`

Run the cleanup script: `cd rescue-backend && node removeDemoAccounts.js`
Expected: `Deleted 4 demo account(s): adminA, rescueA1, adminB, rescueB1`

Re-run the same curl command:
```bash
curl -s -X POST http://127.0.0.1:3000/api/login -H "Content-Type: application/json" -d '{"username":"adminA","password":"password"}'
```
Expected: `{"error":"User not found"}` (account deleted)

Confirm a real bcrypt-hashed account (e.g. `test1` from the seed data) still logs in normally with its real password.

- [ ] **Step 8: Commit**

```bash
git add rescue-backend/auth.js rescue-backend/test/auth.test.js rescue-backend/removeDemoAccounts.js rescue-backend/server.js
git commit -m "fix: remove plaintext password login fallback, add demo account cleanup script"
```

---

### Task 5: Citizen per-incident token — schema + generation

**Files:**
- Modify: `rescue-backend/server.js` (auto-migration block, ~lines 65-93 original; `POST /api/incidents` handler, ~lines 240-283 original; `POST /api/incidents/:id/backup` handler, ~lines 352-386 original)

**Interfaces:**
- Produces: `incidents.citizen_token` DB column; `POST /api/incidents` response now includes `citizen_token: string` alongside the existing `incident_id`. Backup/child incidents (created via `POST /api/incidents/:id/backup`) inherit their parent's `citizen_token` rather than getting a new one.
- Consumes: `sosLimiter` from Task 1 (already applied to this route).

**Why backup incidents matter here:** when a driver accepts a *backup* unit instead of the original incident, the backend's `driver_assigned` socket event sends the citizen the **backup incident's own id**, not the parent's (see the `accept` route: `parent_id` is only used to pick the broadcast *room*, but `incident_id` in the payload is whatever was actually accepted). The citizen app then uses that id for all subsequent status/chat/socket-join calls. If backup incidents didn't carry a `citizen_token`, the citizen would get locked out (403 / silently refused) the moment a backup unit — rather than the original — is the one that accepts. Step 4 below fixes this by copying the parent's token onto every backup row at creation time.

- [ ] **Step 1: Add the auto-migration line**

`rescue-backend/server.js` has a block of `pool.query('ALTER TABLE ...')` auto-migration calls, e.g.:
```js
// Auto-migrate cancel reason
pool.query('ALTER TABLE incidents ADD COLUMN cancel_reason VARCHAR(255) NULL').catch(()=>{});
```
Add immediately after it:
```js
// Auto-migrate citizen token for per-incident access control
pool.query('ALTER TABLE incidents ADD COLUMN citizen_token VARCHAR(64) NULL').catch(()=>{});
```

- [ ] **Step 2: Add the `crypto` import**

Add near the other top-of-file requires:
```js
const crypto = require('crypto');
```

- [ ] **Step 3: Generate and return the token on incident creation**

`rescue-backend/server.js` `POST /api/incidents` handler currently has:
```js
        const [result] = await pool.query(
            'INSERT INTO incidents (details, latitude, longitude, status, citizen_phone) VALUES (?, ?, ?, ?, ?)',
            [details || 'SOS via App', latitude, longitude, 'Pending', citizen_phone]
        );
        const incident_id = result.insertId;

        // If drivers are nearby, kick off blast immediately.
        if (nearbyDriverIds.length > 0) {
            broadcastOffer(incident_id, nearbyDriverIds, { details, latitude, longitude, citizen_phone });
        }

        res.status(201).json({ message: 'Searching for rescuer', incident_id });
```
Replace with:
```js
        const citizen_token = crypto.randomUUID();
        const [result] = await pool.query(
            'INSERT INTO incidents (details, latitude, longitude, status, citizen_phone, citizen_token) VALUES (?, ?, ?, ?, ?, ?)',
            [details || 'SOS via App', latitude, longitude, 'Pending', citizen_phone, citizen_token]
        );
        const incident_id = result.insertId;

        // If drivers are nearby, kick off blast immediately.
        if (nearbyDriverIds.length > 0) {
            broadcastOffer(incident_id, nearbyDriverIds, { details, latitude, longitude, citizen_phone });
        }

        res.status(201).json({ message: 'Searching for rescuer', incident_id, citizen_token });
```

- [ ] **Step 4: Make backup incidents inherit the parent's citizen token**

`rescue-backend/server.js` `POST /api/incidents/:id/backup` handler currently has:
```js
        const details = `[🚨 BACKUP] ${p.details}`;
        const [result] = await pool.query(
            'INSERT INTO incidents (details, latitude, longitude, status, citizen_phone, parent_incident_id) VALUES (?, ?, ?, ?, ?, ?)',
            [details, p.latitude, p.longitude, 'Pending', p.citizen_phone, parent_id]
        );
        const incident_id = result.insertId;
```
Replace with (note `p` is already `SELECT *` from the parent row, so `p.citizen_token` is available with no extra query):
```js
        const details = `[🚨 BACKUP] ${p.details}`;
        const [result] = await pool.query(
            'INSERT INTO incidents (details, latitude, longitude, status, citizen_phone, parent_incident_id, citizen_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [details, p.latitude, p.longitude, 'Pending', p.citizen_phone, parent_id, p.citizen_token]
        );
        const incident_id = result.insertId;
```

- [ ] **Step 5: Manually verify**

Run: `cd rescue-backend && docker-compose up -d && npm run dev` (leave running; auto-migration runs on startup — check the logs don't show a fatal error, `.catch(()=>{})` swallows "column already exists" but would surface other errors on first run if the SQL were wrong)
In a second terminal:
```bash
curl -s -X POST http://127.0.0.1:3000/api/incidents -H "Content-Type: application/json" -d '{"details":"test","latitude":13.75,"longitude":100.50,"citizen_phone":"0800000000"}'
```
Expected: JSON response includes both `incident_id` (a number) and `citizen_token` (a UUID string like `"a1b2c3d4-..."`).

Then, using the `token` (staff JWT) from a `POST /api/login` call as an existing seed rescuer (e.g. `test1`), request a backup for that incident and confirm the child row inherited the token:
```bash
STAFF_TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/login -H "Content-Type: application/json" -d '{"username":"test1","password":"<test1-real-password>"}' | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).token))")
curl -s -X POST http://127.0.0.1:3000/api/incidents/<incident_id>/backup -H "Authorization: Bearer $STAFF_TOKEN"
```
Then query the DB directly to confirm the new backup row's `citizen_token` matches the parent's:
```bash
docker exec -it rescue_mysql mysql -uroot -prootpassword rescue_db -e "SELECT id, parent_incident_id, citizen_token FROM incidents WHERE parent_incident_id = <incident_id> OR id = <incident_id>;"
```
Expected: both rows show the same `citizen_token` value.

- [ ] **Step 6: Commit**

```bash
git add rescue-backend/server.js
git commit -m "feat: generate a per-incident citizen token on SOS creation, inherited by backup units"
```

---

### Task 6: Enforce citizen token on REST endpoints

**Files:**
- Modify: `rescue-backend/server.js` (`GET /api/citizen/incidents/:id/chat`, ~lines 633-645 original; `GET /api/incidents/status/:id`, ~lines 686-693 original)

**Interfaces:**
- Consumes: `incidents.citizen_token` column from Task 5.
- Produces: both endpoints now require a `?token=` query param matching the incident's stored `citizen_token`, responding `403 {"error":"Unauthorized"}` otherwise (whether the incident doesn't exist or the token is wrong — same generic message either way, per the spec's error-handling requirement not to leak whether an incident ID is valid).

- [ ] **Step 1: Update the chat history endpoint**

`rescue-backend/server.js` currently has:
```js
// Citizen get chat history (public/liff protected by incident logic)
app.get('/api/citizen/incidents/:id/chat', async (req, res) => {
    try {
        const incident_id = req.params.id;
        const [rows] = await pool.query(`
            SELECT * FROM chat_messages 
            WHERE incident_id = ? 
               OR incident_id IN (SELECT id FROM incidents WHERE parent_incident_id = ?)
            ORDER BY timestamp ASC
        `, [incident_id, incident_id]);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});
```
Replace with:
```js
// Citizen get chat history (protected by per-incident citizen token)
app.get('/api/citizen/incidents/:id/chat', async (req, res) => {
    try {
        const incident_id = req.params.id;
        const { token } = req.query;
        if (!token) return res.status(403).json({ error: 'Unauthorized' });

        const [incidentRows] = await pool.query('SELECT citizen_token FROM incidents WHERE id = ?', [incident_id]);
        if (incidentRows.length === 0 || incidentRows[0].citizen_token !== token) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const [rows] = await pool.query(`
            SELECT * FROM chat_messages 
            WHERE incident_id = ? 
               OR incident_id IN (SELECT id FROM incidents WHERE parent_incident_id = ?)
            ORDER BY timestamp ASC
        `, [incident_id, incident_id]);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});
```

- [ ] **Step 2: Update the status endpoint**

`rescue-backend/server.js` currently has:
```js
// Citizen fetch status API
app.get('/api/incidents/status/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT i.status, u.username as driver_name, u.phone as driver_phone FROM incidents i LEFT JOIN users u ON i.assigned_user_id = u.id WHERE i.id = ?', [req.params.id]);
        if (rows.length > 0) res.json({ status: rows[0].status, driver_name: rows[0].driver_name, driver_phone: rows[0].driver_phone });
        else res.status(404).json({ error: 'Not found' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
```
Replace with:
```js
// Citizen fetch status API (protected by per-incident citizen token)
app.get('/api/incidents/status/:id', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) return res.status(403).json({ error: 'Unauthorized' });

        const [rows] = await pool.query('SELECT i.status, i.citizen_token, u.username as driver_name, u.phone as driver_phone FROM incidents i LEFT JOIN users u ON i.assigned_user_id = u.id WHERE i.id = ?', [req.params.id]);
        if (rows.length === 0 || rows[0].citizen_token !== token) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        res.json({ status: rows[0].status, driver_name: rows[0].driver_name, driver_phone: rows[0].driver_phone });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
```

- [ ] **Step 3: Manually verify**

Run: `cd rescue-backend && docker-compose up -d && npm run dev` (leave running)
In a second terminal, create an incident and capture its `citizen_token`:
```bash
RESPONSE=$(curl -s -X POST http://127.0.0.1:3000/api/incidents -H "Content-Type: application/json" -d '{"details":"test","latitude":13.75,"longitude":100.50,"citizen_phone":"0800000001"}')
echo "$RESPONSE"
```
Note the `incident_id` and `citizen_token` values from the output, then:
```bash
# Wrong/missing token — expect 403
curl -s -w "\n%{http_code}\n" "http://127.0.0.1:3000/api/incidents/status/<incident_id>"
curl -s -w "\n%{http_code}\n" "http://127.0.0.1:3000/api/incidents/status/<incident_id>?token=wrong-token"
# Correct token — expect 200
curl -s -w "\n%{http_code}\n" "http://127.0.0.1:3000/api/incidents/status/<incident_id>?token=<citizen_token>"
```
Expected: first two calls return `403` with `{"error":"Unauthorized"}`, the third returns `200` with the incident's status JSON. Repeat the same pattern against `/api/citizen/incidents/<incident_id>/chat`.

- [ ] **Step 4: Commit**

```bash
git add rescue-backend/server.js
git commit -m "fix: require the per-incident citizen token on chat history and status endpoints"
```

---

### Task 7: Enforce token check on socket `join_incident_room`

**Files:**
- Modify: `rescue-backend/server.js` (`join_incident_room` socket handler, ~lines 747-751 original)

**Interfaces:**
- Consumes: `incidents.citizen_token` column from Task 5; `JWT_SECRET` from Task 2; `jwt` (already required at top of server.js).
- Produces: `join_incident_room` now expects payload `{ incident_id, citizen_token }` (citizen clients) or `{ incident_id, staff_token }` (driver/staff clients) instead of a bare `incident_id`. Joins are silently refused (no room join, no error emitted back — matches the existing fire-and-forget style of this handler) if neither token validates.

- [ ] **Step 1: Update the socket handler**

`rescue-backend/server.js` currently has:
```js
    // 3. Citizen / Worker joins private Chat & GPS Tracker Room
    socket.on('join_incident_room', (incident_id) => {
        socket.join(`incident_room_${incident_id}`);
        console.log(`User joined incident tracking room ${incident_id}`);
    });
```
Replace with:
```js
    // 3. Citizen / Worker joins private Chat & GPS Tracker Room
    // Citizens authenticate with their per-incident citizen_token; drivers/staff
    // authenticate with the same JWT they already use for REST calls.
    socket.on('join_incident_room', async ({ incident_id, citizen_token, staff_token }) => {
        if (citizen_token) {
            const [rows] = await pool.query('SELECT citizen_token FROM incidents WHERE id = ?', [incident_id]);
            if (rows.length === 0 || rows[0].citizen_token !== citizen_token) return;
        } else if (staff_token) {
            try {
                jwt.verify(staff_token, JWT_SECRET);
            } catch (e) {
                return;
            }
        } else {
            return;
        }
        socket.join(`incident_room_${incident_id}`);
        console.log(`User joined incident tracking room ${incident_id}`);
    });
```

- [ ] **Step 2: Manually verify with a throwaway socket.io-client script**

Run: `cd rescue-backend && docker-compose up -d && npm run dev` (leave running)
In a second terminal, from `rescue-backend/`:
```bash
node -e "
const { io } = require('socket.io-client');
const socket = io('http://127.0.0.1:3000');
socket.on('connect', () => {
  // Join with a bogus token — should NOT receive the broadcast below
  socket.emit('join_incident_room', { incident_id: 999999, citizen_token: 'wrong' });
  setTimeout(() => process.exit(0), 1500);
});
socket.on('new_chat_message', (msg) => console.log('UNEXPECTED: received message', msg));
"
```
Expected: script exits cleanly after 1.5s with no `UNEXPECTED` line printed (the join was silently refused).

Then repeat with a real incident's `citizen_token` (from an incident created via the Task 6 verification step) and confirm the join succeeds by having a second client emit `send_chat_message` for that same `incident_id` — the first client should log the received `new_chat_message` event.

- [ ] **Step 3: Commit**

```bash
git add rescue-backend/server.js
git commit -m "fix: require a valid citizen or staff token to join an incident's socket room"
```

---

### Task 8: Frontend — CitizenSOS.jsx sends and stores the citizen token

**Files:**
- Modify: `rescue-frontend/src/CitizenSOS.jsx`

**Interfaces:**
- Consumes: `POST /api/incidents` response `citizen_token` field (Task 5); `?token=` query param support on chat/status GET endpoints (Task 6); `{ incident_id, citizen_token }` payload shape for `join_incident_room` (Task 7).
- Produces: `activeCitizenIncident` persisted in `localStorage` now includes a `citizen_token` field.

- [ ] **Step 1: Add a ref to hold the current citizen token**

`rescue-frontend/src/CitizenSOS.jsx` currently declares state near the top of the component:
```js
  // Tracking Screen State
  const [activeIncident, setActiveIncident] = useState(null);
  const [rescuerLoc, setRescuerLoc] = useState(null);
```
Add a ref just above it (a ref, not state, because it's read inside socket listeners registered once on mount — a plain state variable would go stale in those closures):
```js
  const citizenTokenRef = useRef(null);

  // Tracking Screen State
  const [activeIncident, setActiveIncident] = useState(null);
  const [rescuerLoc, setRescuerLoc] = useState(null);
```

- [ ] **Step 2: Capture the token when the SOS is submitted**

`submitSOS` currently reads:
```js
  const submitSOS = async () => {
    try {
      toast.info('🔍 กำลังค้นหารถกู้ภัยที่ใกล้ที่สุดให้คุณ...');
      setIsSearching(true);
      const res = await axios.post(`${API_URL}/api/incidents`, {
        details, latitude: parseFloat(lat), longitude: parseFloat(lng), citizen_phone: citizenPhone, line_uid: lineUid
      });
      setSearchingIncidentId(res.data.incident_id);
      
      // Join the private socket room to wait for driver_assigned matching event!
      socket.emit('join_incident_room', res.data.incident_id);

    } catch (e) {
      toast.error('❌ ค้นหาล้มเหลว: ' + (e.response?.data?.error || 'เซิร์ฟเวอร์มีปัญหา'));
      setIsSearching(false);
    }
  };
```
Replace with:
```js
  const submitSOS = async () => {
    try {
      toast.info('🔍 กำลังค้นหารถกู้ภัยที่ใกล้ที่สุดให้คุณ...');
      setIsSearching(true);
      const res = await axios.post(`${API_URL}/api/incidents`, {
        details, latitude: parseFloat(lat), longitude: parseFloat(lng), citizen_phone: citizenPhone, line_uid: lineUid
      });
      setSearchingIncidentId(res.data.incident_id);
      citizenTokenRef.current = res.data.citizen_token;
      
      // Join the private socket room to wait for driver_assigned matching event!
      socket.emit('join_incident_room', { incident_id: res.data.incident_id, citizen_token: res.data.citizen_token });

    } catch (e) {
      toast.error('❌ ค้นหาล้มเหลว: ' + (e.response?.data?.error || 'เซิร์ฟเวอร์มีปัญหา'));
      setIsSearching(false);
    }
  };
```

- [ ] **Step 3: Update `fetchChatHistory` to accept and send the token**

Currently:
```js
    const fetchChatHistory = async (incidentId) => {
    try {
      const res = await axios.get(`${API_URL}/api/citizen/incidents/${incidentId}/chat`);
      setChatMessages(res.data);
    } catch (e) {
      console.error("Failed to fetch chat history", e);
    }
  };
```
Replace with:
```js
    const fetchChatHistory = async (incidentId, token) => {
    try {
      const res = await axios.get(`${API_URL}/api/citizen/incidents/${incidentId}/chat`, { params: { token } });
      setChatMessages(res.data);
    } catch (e) {
      console.error("Failed to fetch chat history", e);
    }
  };
```

- [ ] **Step 4: Update the `driver_assigned` handler to embed the token**

Currently:
```js
    socket.on('driver_assigned', (data) => {
        toast.success("✅ กู้ภัยกดรับงานแล้ว! ติดตามรถได้เลย");
        setIsSearching(false);
        const incident = { id: data.incident_id, assigned_user_id: data.driver_id, driver_name: data.driver_name, driver_phone: data.driver_phone };
        setActiveIncident(incident);
        localStorage.setItem('activeCitizenIncident', JSON.stringify(incident));
        fetchChatHistory(data.incident_id);
    });
```
Replace with:
```js
    socket.on('driver_assigned', (data) => {
        toast.success("✅ กู้ภัยกดรับงานแล้ว! ติดตามรถได้เลย");
        setIsSearching(false);
        const incident = { id: data.incident_id, assigned_user_id: data.driver_id, driver_name: data.driver_name, driver_phone: data.driver_phone, citizen_token: citizenTokenRef.current };
        setActiveIncident(incident);
        localStorage.setItem('activeCitizenIncident', JSON.stringify(incident));
        fetchChatHistory(data.incident_id, citizenTokenRef.current);
    });
```

- [ ] **Step 5: Update the refresh-hydration block**

Currently:
```js
    // Persist Mission on Refresh
    const saved = localStorage.getItem('activeCitizenIncident');
    if (saved) {
       const incident = JSON.parse(saved);
       axios.get(`${API_URL}/api/incidents/status/${incident.id}`)
          .then(res => {
              if (res.data.status === 'Resolved' || res.data.status === 'Completed') {
                  localStorage.removeItem('activeCitizenIncident');
              } else {
                  // Merge API missing data like driver_phone into the object if needed
                  const hydratedIncident = { ...incident, driver_name: res.data.driver_name || incident.driver_name, driver_phone: res.data.driver_phone || incident.driver_phone };
                  setActiveIncident(hydratedIncident);
                  socket.emit('join_incident_room', incident.id);
                  fetchChatHistory(incident.id);
              }
          }).catch(() => localStorage.removeItem('activeCitizenIncident'));
    }
```
Replace with:
```js
    // Persist Mission on Refresh
    const saved = localStorage.getItem('activeCitizenIncident');
    if (saved) {
       const incident = JSON.parse(saved);
       citizenTokenRef.current = incident.citizen_token;
       axios.get(`${API_URL}/api/incidents/status/${incident.id}`, { params: { token: incident.citizen_token } })
          .then(res => {
              if (res.data.status === 'Resolved' || res.data.status === 'Completed') {
                  localStorage.removeItem('activeCitizenIncident');
              } else {
                  // Merge API missing data like driver_phone into the object if needed
                  const hydratedIncident = { ...incident, driver_name: res.data.driver_name || incident.driver_name, driver_phone: res.data.driver_phone || incident.driver_phone };
                  setActiveIncident(hydratedIncident);
                  socket.emit('join_incident_room', { incident_id: incident.id, citizen_token: incident.citizen_token });
                  fetchChatHistory(incident.id, incident.citizen_token);
              }
          }).catch(() => localStorage.removeItem('activeCitizenIncident'));
    }
```

- [ ] **Step 6: Update the reconnect handler**

Currently:
```js
  // Handle socket reconnection (e.g. Railway drops idle connection)
  useEffect(() => {
    const handleReconnect = () => {
      if (activeIncident) {
        socket.emit('join_incident_room', activeIncident.id);
        fetchChatHistory(activeIncident.id);
      } else if (searchingIncidentId) {
        socket.emit('join_incident_room', searchingIncidentId);
      }
    };
    socket.on('connect', handleReconnect);
    return () => socket.off('connect', handleReconnect);
  }, [activeIncident, searchingIncidentId]);
```
Replace with:
```js
  // Handle socket reconnection (e.g. Railway drops idle connection)
  useEffect(() => {
    const handleReconnect = () => {
      if (activeIncident) {
        socket.emit('join_incident_room', { incident_id: activeIncident.id, citizen_token: activeIncident.citizen_token });
        fetchChatHistory(activeIncident.id, activeIncident.citizen_token);
      } else if (searchingIncidentId) {
        socket.emit('join_incident_room', { incident_id: searchingIncidentId, citizen_token: citizenTokenRef.current });
      }
    };
    socket.on('connect', handleReconnect);
    return () => socket.off('connect', handleReconnect);
  }, [activeIncident, searchingIncidentId]);
```

- [ ] **Step 7: Manually verify in the browser**

Run: `cd rescue-backend && docker-compose up -d && npm run dev` (leave running)
Run: `cd rescue-frontend && npm run dev` (leave running)
Open the printed local URL (typically `http://127.0.0.1:5173`) in a browser, use the "Test in Browser (LINE Login)" fallback button to reach the SOS screen without real LINE. Enter a phone number, hold the SOS button 5 seconds.
Expected: browser DevTools → Network tab shows `POST /api/incidents` response includes `citizen_token`; Application → Local Storage shows `activeCitizenIncident` (once a driver accepts, or immediately if you inspect `citizenTokenRef` isn't visible in storage until `driver_assigned` fires — that's expected, only `activeIncident` persists, not the searching-phase token).
In a second browser tab/window logged in as a driver (see Task 9), go online and accept the test SOS. Confirm the citizen tab's tracking screen loads chat history without a console error and the chat panel is usable (send a message from each side, confirm both sides see it).

- [ ] **Step 8: Commit**

```bash
git add rescue-frontend/src/CitizenSOS.jsx
git commit -m "feat: send and persist the per-incident citizen token in the SOS app"
```

---

### Task 9: Frontend — CommandCenter.jsx sends the staff token on socket join

**Files:**
- Modify: `rescue-frontend/src/CommandCenter.jsx`

**Interfaces:**
- Consumes: `{ incident_id, staff_token }` payload shape for `join_incident_room` (Task 7); existing `localStorage.getItem('token')` JWT (already used for all REST calls in this file).

- [ ] **Step 1: Update `fetchActiveMission`**

Currently:
```js
  const fetchActiveMission = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/incidents/active`, {
         headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.data) {
         setActiveMission(res.data);
         const roomId = res.data.parent_incident_id || res.data.id;
         socket.emit('join_incident_room', roomId);
         fetchChatHistory(res.data.id);
      }
    } catch(e) { }
  };
```
Replace with:
```js
  const fetchActiveMission = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/incidents/active`, {
         headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.data) {
         setActiveMission(res.data);
         const roomId = res.data.parent_incident_id || res.data.id;
         socket.emit('join_incident_room', { incident_id: roomId, staff_token: localStorage.getItem('token') });
         fetchChatHistory(res.data.id);
      }
    } catch(e) { }
  };
```

- [ ] **Step 2: Update the accept-mission button handler**

Currently (inside the "RENDER INCOMING MISSION" JSX block):
```js
            <button onClick={async () => {
                try {
                   await axios.post(`${API_URL}/api/incidents/${incomingMission.incident_id}/accept`, {}, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }});
                   const missionData = { id: incomingMission.incident_id, latitude: incomingMission.latitude, longitude: incomingMission.longitude, details: incomingMission.details, citizen_phone: incomingMission.citizen_phone, parent_incident_id: incomingMission.parent_incident_id };
                   setActiveMission(missionData);
                   setIncomingMission(null);
                   toast.success("✅ รับงานเรียบร้อย นำทางทันที!");
                   socket.emit('join_incident_room', incomingMission.parent_incident_id || incomingMission.incident_id);
                   fetchChatHistory(incomingMission.incident_id);
                } catch(e) {
                   toast.error('❌ ไม่สามารถรับงานได้: ' + (e.response?.data?.error || 'เซิร์ฟเวอร์ขัดข้อง'));
                   setIncomingMission(null);
                }
            }} style={{ flex: 2, background: '#10b981', color: 'white', padding: '20px', fontSize: '24px', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold' }}>รับงาน (Accept)</button>
```
Replace the `socket.emit` line:
```js
                   socket.emit('join_incident_room', { incident_id: incomingMission.parent_incident_id || incomingMission.incident_id, staff_token: localStorage.getItem('token') });
```

- [ ] **Step 3: Update the reconnect handler**

Currently:
```js
  // Handle socket reconnection
  useEffect(() => {
    const handleReconnect = () => {
      if (activeMission) {
        socket.emit('join_incident_room', activeMission.parent_incident_id || activeMission.id);
        fetchChatHistory(activeMission.id);
      }
    };
    socket.on('connect', handleReconnect);
    return () => socket.off('connect', handleReconnect);
  }, [activeMission]);
```
Replace with:
```js
  // Handle socket reconnection
  useEffect(() => {
    const handleReconnect = () => {
      if (activeMission) {
        socket.emit('join_incident_room', { incident_id: activeMission.parent_incident_id || activeMission.id, staff_token: localStorage.getItem('token') });
        fetchChatHistory(activeMission.id);
      }
    };
    socket.on('connect', handleReconnect);
    return () => socket.off('connect', handleReconnect);
  }, [activeMission]);
```

- [ ] **Step 4: Manually verify in the browser**

Run: `cd rescue-backend && docker-compose up -d && npm run dev` (leave running)
Run: `cd rescue-frontend && npm run dev` (leave running, serves CommandCenter at `/login` per `App.jsx` routing)
Log in as `test1` (existing bcrypt-hashed seed account — do not use the deleted demo accounts), toggle "Go Online & Ready". From the citizen SOS screen (Task 8), submit a test SOS. Confirm the "SOS ฉุกเฉิน!" ringing screen appears for the driver, accept it, and confirm the map/chat screen loads with GPS tracking and chat both working — this exercises the token-gated `join_incident_room` path end-to-end for the staff side.
Then, in browser DevTools, run `localStorage.removeItem('token')` and manually re-trigger a `join_incident_room` emit (e.g. reload the page mid-mission) — confirm the room join is now silently refused (no GPS/chat updates arrive) since `jwt.verify` fails with no token.

- [ ] **Step 5: Commit**

```bash
git add rescue-frontend/src/CommandCenter.jsx
git commit -m "feat: send the staff JWT when joining an incident's socket room"
```

---

## Self-Review Notes

- **Spec coverage:** all 5 spec sections have a task — CORS → Task 3, citizen token (REST + socket) → Tasks 5-7 + 8-9 (frontend), JWT_SECRET → Task 2, plaintext password → Task 4, rate limiting → Task 1.
- **Type consistency checked:** `join_incident_room` payload shape (`{ incident_id, citizen_token }` / `{ incident_id, staff_token }`) is identical across Task 7 (backend), Task 8 (CitizenSOS.jsx — 3 call sites), and Task 9 (CommandCenter.jsx — 3 call sites). `fetchChatHistory(incidentId, token)` signature is consistent across all 4 call sites added/changed in Task 8. `verifyPassword`, `isAllowedOrigin`, `getJwtSecret` function names match between their module definition and every `server.js` call site.
- **Bug caught during review, now fixed in Task 5:** the original draft only generated `citizen_token` in `POST /api/incidents`. But `driver_assigned` can hand the citizen a **backup unit's** incident id (not the parent's) when a backup — rather than the original — gets accepted first. Backup rows created via `POST /api/incidents/:id/backup` didn't have a token at all, which would have 403'd/silently-refused the citizen out of tracking their own incident in that case. Fixed by having backup rows inherit `citizen_token` from the parent row at creation time (Task 5, Step 4) — no changes needed in Tasks 6/7 since they already look up whichever id they're given generically.
- **Known follow-up, intentionally out of scope:** `socket.on('update_vehicle_location', ...)` also calls `socket.join(...)` on an `active_incident_id` taken directly from the client payload with no token check. The approved spec only covers `join_incident_room`; this is a related gap worth a future spec, not silently rolled into this plan.
