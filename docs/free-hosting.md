# Rescue free demo hosting

Approved target: existing Vercel frontends, Render Free Node backend and Free Key Value, and Aiven Free MySQL. This is for demos, not time-critical emergency dispatch.

## Prepared locally

- `render.yaml` explicitly selects Free for both Render services in Singapore. Redis accepts private connections only.
- Backend reads Render's `PORT`, and supports `DB_PORT`, `DB_SSL=true`, and the full PEM CA certificate in `DB_SSL_CA`. Certificate verification stays enabled.
- LINE Login channel ID is configured in the Blueprint. Secrets are entered in provider settings, never committed.

## Remaining deployment steps

1. Finish Render account authorization and Aiven sign-in/signup. Choose the actual Aiven Free MySQL plan (1 GB), not a paid trial. Do not enable paid upgrades.
2. Provision the new database and record its host, port, database, user and CA. Set its credentials only in the intended Render service.
3. Prepare and validate the current schema before import. `rescue-backend/init.sql` contains obsolete plaintext demo credentials and is not a production bootstrap. Do not import it as-is. Do not upload the existing SQL export or personal incident data without reviewing its contents and migration scope.
4. Push the reviewed code to GitHub, then create the Render Blueprint with the required environment variables. Review the final price before creation: both services must show $0. Where available set a zero spend limit; do not add payment details for this demo.
5. Verify MySQL, Redis, authentication and Socket.IO against the new API before setting `VITE_API_URL` to its HTTPS URL in both Vercel projects and deploying them.
6. Verify the citizen and admin sites and test LINE login with the account owner. Avoid generating real emergency calls or unsolicited LINE messages during smoke checks.

## Limits

Render Free sleeps after 15 idle minutes and may take about a minute to wake. Its Redis data is ephemeral, suitable here only for online presence. Incidents belong in MySQL. Quota exhaustion can suspend services. Aiven Free can pause inactive databases. These plans do not guarantee continuous availability.

References checked 2026-09-12:
- https://render.com/docs/free
- https://render.com/docs/blueprint-spec
- https://aiven.io/docs/products/mysql/concepts/mysql-free-tier

Current status: configuration prepared and backend tests pass; no Render/Aiven services have been created and Vercel has not been switched.
