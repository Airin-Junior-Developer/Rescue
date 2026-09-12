# Rescue free demo hosting

Approved target: existing Vercel frontends, Render Free Node backend and Free Key Value, and Aiven Free MySQL. This is for demos, not time-critical emergency dispatch.

## Prepared locally

- `render.yaml` explicitly selects Free for both Render services in Singapore. Redis accepts private connections only.
- Backend reads Render's `PORT`, and supports `DB_PORT`, `DB_SSL=true`, and the full PEM CA certificate in `DB_SSL_CA`. Certificate verification stays enabled.
- LINE Login channel ID is configured in the Blueprint. Secrets are entered in provider settings, never committed.

## Deployed services

- Citizen/driver: https://rescue-alpha-seven.vercel.app
- Admin: https://rescue-admin-eta.vercel.app
- Backend: https://rescue-api-mw89.onrender.com
- Render backend: `srv-daihv4bm8hqs73cume60`, Free, Singapore, branch `codex/free-hosting`.
- Render Redis: `red-daihpq5g1s2s73fdcid0`, Free, Singapore, external connections blocked.
- Aiven: project `rescue`, service `rescue-mysql`, Free MySQL, six tables initialized from `rescue-backend/schema.sql`.
- Vercel uses `VITE_RESCUE_API_URL` in Production. It takes priority over the legacy `VITE_API_URL`. Both sites deployed commit `843334d`.
- Two randomly passworded demo accounts exist. No old personal records or incidents were imported. Passwords were handed off in a private local file, not committed.

## Verification on 2026-09-12

Backend: 37 tests passed; citizen session: 7 tests passed; both frontends passed lint and build. Ten changed SQL statements passed EXPLAIN against Aiven. Hosted admin/rescue login, admin system status, public foundations and Socket.IO handshake returned HTTP 200. Both production bundles contain the new backend URL. Browser login reached the admin dashboard. LINE bot-info returned HTTP 200 without sending a message. Full LINE mobile login, GPS and incident dispatch have not been tested end to end.

## Limits and maintenance

For demonstration only: Render Free sleeps after 15 idle minutes and may take about a minute to wake. Redis presence is ephemeral; incidents are stored in MySQL. Aiven may pause inactive free databases. Quotas can suspend service. Existing bundle-size warnings and npm dependency audit findings remain to be assessed.

Render uses a public Git repository and may require a manual deployment after code changes. Vercel production follows `main`. Keep these releases coordinated. Do not upgrade plans or add payment methods for this free demo.

References:
- https://render.com/docs/free
- https://render.com/docs/blueprint-spec
- https://aiven.io/docs/products/mysql/concepts/mysql-free-tier
