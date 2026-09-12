# Rescue security and recovery fixes

## Scope

- Staff REST and Socket commands resolve the JWT subject against the current approved user. Socket driver IDs, usernames and chat senders are no longer trusted from client payloads.
- Completing a case requires its assigned driver or an admin. Chat and backup access require assignment to that incident family (or admin). Completing a backup alone does not announce completion of the parent.
- `/api/citizen/auth` accepts a LINE `id_token`, verifies it with LINE, and returns a one-hour citizen session in `citizen_token`. Phone registration requires that session in `Authorization: Bearer ...`. Public SOS creation never modifies a registered citizen's identity/phone.
- Pending SOS is stored in MySQL before dispatch lookup. The existing polling loop retries dispatch after Redis recovers; Redis queues are disabled while offline.
- Citizen tracking saves the incident ID/capability immediately, restores Pending or Accepted state after reload/reconnect, and retries status every 10 seconds. Temporary network errors preserve the saved case; completed/unauthorized cases clear it. Late responses cannot replace a newer case or regress Accepted to Pending.
- Driver presence has a 60-second Redis lease and a 20-second client heartbeat. Disconnect/offline removes only that socket's lease. Redis atomically checks ownership when renewing presence so a delayed old socket cannot overwrite a new session. Expired GEO members are filtered out before offers.
- Driver/admin sockets reconnect to authenticated rooms. UI online status changes after server acknowledgement. Existing lint errors were corrected without disabling rules.

## Configuration and rollout

Set `LINE_LOGIN_CHANNEL_ID` on the backend to the **LINE Login channel containing the LIFF app**, not a Messaging API channel, secret, or access token. Enable the LIFF `openid` scope so `liff.getIDToken()` supplies a token.

The frontend accepts optional `VITE_LIFF_ID` (otherwise retains the existing LIFF ID). ID token verification follows the [LINE Login API](https://developers.line.biz/en/reference/line-login/#verify-id-token).

Deploy the backend and both frontend clients together. Old clients send unsigned `go_online` events and raw LINE UIDs; these are intentionally rejected. Reload/re-login after deployment. This patch does not deploy anything.

## Verification

- Backend: `cd rescue-backend && npm test`
- Citizen/driver client: `cd rescue-frontend && npm test && npm run lint && npm run build`
- Admin client: `cd rescue-web-admin && npm run lint && npm run build`

Regression tests execute the real registered REST handlers and socket callbacks with isolated database, Redis, and LINE doubles. They cover unauthorized and authorized access, LINE audience/expiry, phone-subject binding, Redis outage at SOS submission, lease ownership races, disconnect, stale driver exclusion and citizen reload recovery. The existing limiter test uses a local HTTP listener.

On 2026-09-12, Docker was started and the existing local MySQL connection passed `SELECT 1`; Redis returned `PONG`. Physical-device LIFF/GPS/background behavior and a complete deployed flow still require testing. Build retains the existing large-bundle warnings.

## Verified local LINE configuration (2026-09-12)

Verified in LINE Developers using the existing signed-in account:

- Provider: RescueProject (`2005093474`).
- LINE Login channel: Rescue (`2009894409`), Published.
- LIFF: Rescue (`2009894409-w2sSn3rf`), scopes `openid, profile` already enabled.
- Existing LIFF endpoint: `https://rescue-alpha-seven.vercel.app`.
- Saved `LINE_LOGIN_CHANNEL_ID=2009894409` in the ignored local `rescue-backend/.env`, preserving all other values. No LINE permissions or credentials were changed.

The deployed Railway/Vercel configuration has not been modified by this local setup. The same channel ID must be included when deploying the backend.

The opt-in `test/integration/presence.real.test.cjs` executes the production Lua scripts against a disposable Redis instance supplied via `RESCUE_TEST_REDIS_URL`. It checks registration, socket replacement, stale-write rejection, disconnect, lease preservation, GEO membership, and prevention of resurrected presence. Do not point this test at a production Redis instance.
