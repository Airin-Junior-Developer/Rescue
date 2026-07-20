# Reliable Rescue Tracking Prototype — Design Spec

**Date:** 2026-07-20

**Status:** Approved in collaborative design — pending written-spec review

**Project type:** Computer Science capstone research prototype

## 1. Summary

Rescue will be a working research prototype that complements, but does not replace, Thailand's 1669 emergency call flow. Its primary value is reducing uncertainty after a citizen reports an emergency: the citizen confirms an exact GPS point, sees whether the report was received, follows the assigned rescue unit, and can provide an additional landmark or message without repeatedly explaining directions.

The prototype supports the same citizen flow in a normal web browser and LINE LIFF. It also provides a mobile rescuer interface and a simulated command-center dashboard. The initial deployment covers one simulated dispatch area with two or three rescue units and does not integrate with the official 1669 infrastructure.

The selected approach is to stabilize the existing React, Express, MySQL, Redis, and Socket.IO system, then modularize only the areas that block correctness or testing. This preserves working features while removing unsafe client trust, in-memory dispatch state, ambiguous incident statuses, stale online units, and oversized UI/server files.

## 2. Problem and research objective

### 2.1 User problem

After calling 1669, a caller may still be unsure whether the location was communicated correctly or how far away help is. The prototype explores whether a shared digital incident view can improve location confidence and status visibility.

### 2.2 Research objective

Demonstrate and evaluate a technically reliable workflow in which:

1. A citizen confirms a GPS position and reports an incident.
2. The system searches for a verified, currently online rescue unit.
3. Exactly one unit accepts the incident.
4. The citizen and simulated command center receive live, freshness-labelled location updates.
5. All important timestamps and state transitions are retained for evaluation.

The study measures system behaviour, not clinical outcomes and not the performance of the official 1669 system.

## 3. Scope

### 3.1 In scope

- One simulated operating area and two or three demo rescue units.
- Citizen access through a normal web browser without mandatory LINE login.
- Citizen access through LINE LIFF with verified LINE identity.
- Location confirmation, accuracy display, landmark text, and one optional incident photo.
- Incident receipt, bounded unit search, atomic acceptance, live tracking, chat, arrival, completion, and cancellation paths.
- A rescuer mobile workflow for availability, mission offers, navigation handoff, status updates, chat, and GPS heartbeat.
- A simulated command-center dashboard for live incidents, unit freshness, manual assignment/reassignment, cancellation, and audit history.
- Versioned database migrations, authenticated Socket.IO rooms, Redis presence TTL, reconnect recovery, structured errors, automated tests, seed data, and repeatable demo reset.
- Research metrics derived from incident events.

### 3.2 Out of scope

- Direct integration with 1669, ITEMS, ambulance CAD, hospital systems, or government identity systems.
- Medical triage, diagnosis, treatment advice, or patient-priority algorithms.
- Nationwide or multi-province dispatch.
- Production-grade legal, operational, or service-level certification.
- Native iOS or Android applications.
- Turn-by-turn navigation developed inside Rescue; the rescuer opens an installed maps application instead.
- Advanced route optimization, predictive ETA, billing, or public foundation onboarding.

Every citizen screen must clearly identify the app as a research prototype and provide a visible **Call 1669** action for real emergencies.

## 4. Existing system and migration strategy

The current repository contains:

- `rescue-backend`: Express, MySQL, Redis, Socket.IO, JWT, LINE push integration, and Node tests.
- `rescue-frontend`: React application containing citizen, rescuer, login, and registration screens.
- `rescue-web-admin`: React command-center dashboard.

The security-hardening design dated 2026-07-16 has already introduced CORS restrictions, mandatory JWT secret handling, bcrypt-only login, public-route rate limits, per-incident citizen tokens, and partial socket-room protection. This design retains those controls and closes the remaining gaps.

Implementation will be incremental. Existing routes may remain temporarily behind adapters, but their externally visible behaviour must converge on this specification. The system will not be rewritten and will not adopt a new framework.

## 5. Architecture

### 5.1 Clients

#### Citizen application

Web and LIFF use the same incident-reporting and tracking components. Only identity bootstrapping differs:

- **Web:** a guest may report an incident with an optional phone number. The server returns a high-entropy incident capability token. The browser stores it only for restoring that incident.
- **LIFF:** the client sends a LINE ID token or access token to the backend. The backend verifies it with LINE before issuing its own citizen session. A raw `line_uid` received from the client is never accepted as proof of identity.

The shared citizen modules are:

- `CitizenIdentityAdapter`: Web guest or verified LIFF session.
- `LocationConfirmation`: geolocation, accuracy, movable pin, landmark, and refresh.
- `IncidentReporter`: validated incident creation and optional media upload.
- `IncidentTimeline`: canonical lifecycle and fallback actions.
- `LiveTracking`: rescue-unit location, ETA estimate, and freshness.
- `IncidentChat`: authenticated, idempotent messages.

#### Rescuer application

The rescuer interface contains:

- authenticated availability controls;
- GPS heartbeat and stale/offline warnings;
- mission offers with location confidence and distance;
- atomic accept and local reject;
- navigation, chat, and contact actions;
- only the valid status actions for the assigned incident.

#### Simulated command center

The admin interface contains:

- active incidents grouped by lifecycle state;
- a map of valid online units and the age of each position;
- manual assignment, reassignment, retry, and cancellation;
- a per-incident event timeline;
- research timing metrics and system health indicators.

### 5.2 Backend boundaries

The current `server.js` responsibilities will be separated behind these modules while retaining Express and Socket.IO:

- `auth`: staff JWT validation, LIFF verification, citizen capability validation, roles, and ownership.
- `incidents`: creation, queries, cancellation, and canonical lifecycle transitions.
- `dispatch`: candidate selection, offer rounds, atomic acceptance, timeout, and manual assignment.
- `presence`: rescuer heartbeat, Redis GEO membership, freshness, and cleanup.
- `tracking`: authorized location updates and ETA-ready payloads.
- `chat`: authorization, validation, persistence, and idempotency.
- `notifications`: best-effort LINE push and in-app notifications.
- `admin`: simulated command-center reads and audited interventions.
- `health`: liveness/readiness for MySQL and Redis.

Each module exposes a service interface. Express controllers and Socket.IO handlers validate transport input, call a service, and translate the result. They do not contain dispatch rules or direct multi-step database mutations.

### 5.3 Source of truth

- **MySQL** is authoritative for incidents, assignments, events, messages, attachments, identities, and audit records.
- **Redis** is authoritative only for short-lived presence, GEO lookup candidates, dispatch locks, offer-round metadata, and socket-related cache data.
- **Socket.IO** transports notifications; it is never the only record of a state change.

The server commits an authorized state change to MySQL before emitting its corresponding socket event. A client can therefore reconstruct correct state through REST after a missed event or reconnect.

## 6. Incident lifecycle

The canonical lifecycle replaces the current broad `Pending`, `Accepted`, and `Resolved` values.

| State | Meaning | Valid next states |
|---|---|---|
| `REPORTED` | Location and incident were persisted, but dispatch has not begun | `SEARCHING`, `CANCELLED` |
| `SEARCHING` | The dispatcher is actively looking for a valid unit | `EN_ROUTE`, `NO_UNIT_AVAILABLE`, `CANCELLED` |
| `EN_ROUTE` | One rescue unit atomically accepted or was assigned | `ARRIVED`, `CANCELLED` by admin |
| `ARRIVED` | The assigned unit confirmed arrival | `COMPLETED`, `CANCELLED` by admin |
| `COMPLETED` | The incident workflow is finished | none |
| `NO_UNIT_AVAILABLE` | The bounded search ended without assignment | `SEARCHING` by audited admin retry, or `CANCELLED` |
| `CANCELLED` | The incident was ended with an actor and reason | none |

Rules:

- The reporting transaction creates `REPORTED`; the dispatcher then transitions it to `SEARCHING` and records both events.
- Search runs for a configurable window, defaulting to 120 seconds. Candidate rounds may repeat every 15 seconds, but a unit never receives duplicate active offers for the same incident.
- If no valid unit accepts before the window ends, the state becomes `NO_UNIT_AVAILABLE`. The citizen sees a definitive result and the Call 1669 action rather than an endless spinner.
- A citizen may cancel their own incident only in `REPORTED` or `SEARCHING` and must select or enter a reason.
- A rescuer may reject an offer without changing the incident state. Only the assigned rescuer may move `EN_ROUTE → ARRIVED → COMPLETED`.
- An admin may assign, reassign, retry, or cancel when the action is valid. Every intervention requires an audit event.
- Acceptance uses both a short Redis lock and a conditional MySQL transaction. MySQL determines the winner.
- Every mutation accepts a `client_action_id`. Repeating the same action returns the original outcome without adding duplicate events.

## 7. Data design

Versioned migration files replace startup-time `ALTER TABLE ... catch(() => {})` statements. A migration history table records applied versions.

### 7.1 `incidents`

Retain the internal numeric identifier and add or normalize:

- canonical `status`;
- globally unique `report_action_id` generated by the client before submission, preventing duplicate incidents when the creation request is retried;
- citizen access-token hash, never the reusable plaintext token;
- `latitude`, `longitude`, and `location_accuracy_m`;
- `landmark` and report `details`;
- optional citizen phone and verified LINE citizen reference;
- assigned rescuer and foundation references;
- `reported_at`, `search_started_at`, `accepted_at`, `arrived_at`, `completed_at`, and `cancelled_at`;
- cancellation reason and parent incident reference for the existing backup flow.

The plaintext capability token is returned only at incident creation. Later REST requests send it in `X-Incident-Token`, never in a URL or query string; the server hashes the presented token and compares it to the stored hash. Socket authentication sends the token through the Socket.IO authentication payload rather than an event field that can be mistaken for identity.

### 7.2 `incident_events`

Append-only records contain:

- incident ID;
- event type, previous state, and next state;
- actor type and actor ID where available;
- `client_action_id` and server correlation ID;
- compact JSON metadata that excludes secrets and raw image data;
- server timestamp.

A uniqueness constraint on the incident and `client_action_id` enforces idempotency for post-creation client mutations. The unique `incidents.report_action_id` handles incident-creation retries before an incident ID exists.

### 7.3 `chat_messages`

Messages retain incident, actor, message text, and server timestamp. A client message ID is unique within an incident so retries cannot duplicate a message. The server derives the sender identity; it does not trust a display name supplied by the client.

### 7.4 `incident_attachments`

The capstone version supports one optional JPEG or WebP incident image, compressed client-side and limited to 1 MB after compression. It is uploaded through authenticated HTTP and stored as binary data with MIME type and size metadata in MySQL. Socket events carry only attachment metadata, never base64 image bodies.

### 7.5 Redis records

- `rescuer:{id}:presence`: availability, coordinates, and last-seen timestamp with a 30-second TTL.
- `online_rescuers`: GEO index used only after confirming the corresponding presence key still exists.
- `dispatch:lock:{incident_id}`: short `SET NX EX` lock around acceptance.
- `dispatch:round:{incident_id}`: expiring offer-round metadata, reconstructible from MySQL.

Rescuer clients send a heartbeat every 10 seconds while online. A cleanup task removes GEO members without a valid presence key. Server restart loses only ephemeral data; `SEARCHING` incidents resume from MySQL.

## 8. Authorization and security

### 8.1 REST

- Staff routes derive user ID, role, and foundation from the verified JWT.
- Citizen incident routes require the matching capability token or a verified citizen session that owns the incident.
- Rescuer reads and mutations require assignment or a currently valid offer, depending on the action.
- Admin-only operations require the Admin role and create audit records.
- Access failures return the same generic response whether an incident does not exist or belongs to someone else.

### 8.2 Socket.IO

- Staff JWT or citizen session authentication occurs during the socket handshake.
- A citizen capability token may additionally authorize joining one incident room.
- The server derives user identity and room names. Client-supplied `user_id`, `vehicle_id`, role, sender name, or arbitrary room name is not trusted.
- `go_online`, `go_offline`, location update, mission offer, chat, and incident-state handlers all call the same authorization services used by REST.
- The server provides an explicit authenticated admin-room join path.
- Invalid events receive a structured acknowledgement error and are not silently accepted.

### 8.3 Input and privacy controls

- Validate coordinate ranges, accuracy, string lengths, phone format, image MIME type, decoded size, and action IDs.
- Apply route-specific rate limits to login, citizen authentication, incident creation, chat, and media upload.
- Never return stack traces, database messages, tokens, or LINE API response bodies to clients.
- Logs include a correlation ID and actor category, but redact tokens, phone numbers, chat text, and precise coordinates.
- Service workers must not cache API, authentication, Socket.IO, tracking, or chat responses. Only versioned static app assets may be cached.
- Default research retention is three days for chat and attachments and seven days for phone numbers and precise incident locations after completion. De-identified timing aggregates may be retained for the capstone report. A documented configuration may shorten retention; any real pilot requires a separate consent and ethics review.

## 9. Data and event flow

### 9.1 Report and dispatch

1. The citizen confirms the map pin, accuracy, landmark, and optional photo.
2. The client submits the incident with a new `client_action_id`.
3. The backend validates identity and input, creates `REPORTED`, appends the event, and returns the incident ID plus one-time capability token where applicable.
4. If the citizen selected a photo, the client uploads it using the newly returned incident credentials. A failed photo upload does not delete or duplicate the already-created incident.
5. The dispatcher changes the incident to `SEARCHING`, finds only fresh and available Redis candidates, and sends offers to their server-derived rooms.
6. The first valid acceptance wins the MySQL conditional update, creates the assignment/event, and changes the state to `EN_ROUTE`.
7. Other offers are cancelled. The citizen and admin receive the committed state and assigned-unit summary.

### 9.2 Tracking and completion

1. The assigned rescuer heartbeat updates Redis with TTL and sends validated coordinates.
2. The server checks assignment before emitting a location update to the incident and admin rooms.
3. Payloads include `recorded_at` and `received_at`; clients display how old the last update is.
4. The citizen retrieves canonical incident state by REST on load and after reconnect, then rejoins the authorized room.
5. The assigned rescuer marks arrival and completion. Each committed transition appends an event and emits an update.
6. Completion releases the unit to available status only if its heartbeat is still valid.

### 9.3 Chat and notifications

1. The client sends a message with a unique client message ID.
2. The backend validates incident access, derives the sender, persists once, and then emits.
3. LINE push is best-effort. Failure is logged and surfaced to admin health information but never rolls back the incident.

## 10. User experience

### 10.1 Citizen

- Before submission, show the pin, accuracy in metres, resolved address when available, landmark entry, and a GPS refresh action.
- After submission, show an incident reference and explicit timeline. Never leave the citizen on an indefinite spinner.
- During travel, show the rescue unit, ETA as an estimate, last-update age, contact/chat controls, and confirmed destination pin. ETA uses the existing routing adapter when it responds successfully; otherwise the UI shows distance without fabricating an arrival time.
- If data is stale, label it as stale instead of animating or implying live movement.
- Use large touch targets, plain Thai labels, and icons/text in addition to colour.
- Web and LIFF render the same states. LIFF failure falls back to guest Web mode only when the page is outside LINE; an in-LINE verification failure shows a retry and Call 1669 action.

### 10.2 Rescuer

- Show authentication, availability, heartbeat age, and GPS permission state.
- Offer cards show incident reference, age, distance, accuracy, landmark, and report details.
- Once assigned, show only navigation, communication, and the next valid lifecycle action.
- If the connection becomes stale, stop presenting the unit as online and explain how to reconnect.

### 10.3 Admin

- Show incident counts by state and units by available, busy, or stale.
- Show last-seen time wherever a unit location appears.
- Require confirmation and a reason for cancellation or reassignment.
- Display the append-only event/audit timeline and the research timestamps.

## 11. Error handling and degraded modes

API and Socket acknowledgements use stable error codes with user-safe Thai messages:

- `GPS_PERMISSION_DENIED`
- `INVALID_LOCATION`
- `LOCATION_STALE`
- `NO_UNIT_AVAILABLE`
- `ASSIGNMENT_CONFLICT`
- `INVALID_TRANSITION`
- `SESSION_EXPIRED`
- `FORBIDDEN`
- `REALTIME_DISCONNECTED`
- `SERVICE_DEGRADED`
- `ATTACHMENT_REJECTED`

Required behaviour:

- GPS denied: allow retry and manual pin confirmation; never invent coordinates.
- Socket disconnected: show the connection state and poll incident status by REST every 10 seconds until reconnect.
- Session expired: preserve non-secret draft fields, re-authenticate, then allow retry with the same action ID.
- Duplicate request: return the previously committed result.
- MySQL unavailable: readiness fails and write routes return `503`; no success state is shown.
- Redis unavailable: persist a new incident as `REPORTED` and return HTTP `202` with code `SERVICE_DEGRADED`; do not claim active dispatch, and show Call 1669. A recovery worker may move it to `SEARCHING` only after Redis is ready.
- LINE push unavailable: continue the in-app workflow and record the notification failure.
- No unit found after 120 seconds: commit `NO_UNIT_AVAILABLE`, stop automatic offers, and provide an admin retry plus Call 1669 fallback.

## 12. Testing strategy

### 12.1 Unit tests

Cover:

- all valid and invalid lifecycle transitions;
- role, ownership, assignment, and capability-token decisions;
- dispatch candidate filtering and timeout;
- conditional acceptance and idempotency;
- coordinate, image, phone, and message validation;
- presence freshness and TTL interpretation;
- error-to-response mapping.

### 12.2 Integration tests

Run against isolated MySQL and Redis test instances with the real Express and Socket.IO servers. Cover:

- Web guest and verified-LIFF session creation;
- complete report-to-completion flow;
- two rescuers accepting simultaneously with exactly one winner;
- unauthorized REST reads, state changes, room joins, location writes, and chat writes;
- duplicate action and duplicate message retries;
- disconnect, REST recovery, reconnect, and room rejoin;
- presence expiry and exclusion from dispatch;
- Redis failure and recovery from persisted `REPORTED`/`SEARCHING` incidents;
- admin assignment, retry, reassignment, cancellation, and audit records.

### 12.3 End-to-end tests

Playwright runs three browser contexts: citizen Web, rescuer, and admin. A fourth scenario uses a mocked LIFF adapter for deterministic automated coverage. Tests verify visible timelines, map freshness labels, offer handling, tracking, chat, arrival, completion, no-unit fallback, and reconnect recovery.

A manual LIFF smoke test runs on at least one physical device inside LINE because LIFF login and mobile geolocation cannot be fully represented by the browser mock.

### 12.4 Non-functional checks

- Production builds and lint pass for both React applications.
- Backend test suite passes with no open-handle leaks.
- Under a staging load of 20 concurrent sockets, committed state and location events reach authorized clients within 2 seconds at the 95th percentile.
- A unit with no heartbeat for 30 seconds is excluded from new dispatches.
- With an available unit, the first offer is emitted within 5 seconds after the incident enters `SEARCHING` under normal staging conditions.

## 13. Definition of presentation-ready

The prototype is ready to present only when all of the following are true:

1. The primary Web flow completes successfully five consecutive times without database repair or manual server intervention.
2. The LIFF smoke flow completes on a physical device.
3. Two simultaneous rescue acceptances result in one assignment and one clear conflict response.
4. Unrelated users cannot read, join, message, locate, or mutate another incident.
5. All three clients converge on the correct state after losing and restoring connectivity.
6. An expired rescuer heartbeat removes the unit from candidate selection.
7. GPS denial, stale GPS, no unit, expired session, rejected image, and degraded service each show a usable next action.
8. `reported_at`, search start, acceptance, arrival, completion/cancellation, and location freshness are captured for the research report.
9. Backend tests, frontend tests, lint, and production builds all pass.
10. Seed data and a safe reset command restore a known demo state without deleting unrelated data. The reset command runs only when `NODE_ENV=demo` and the configured database name ends in `_demo`; otherwise it exits without mutation.
11. The demo script explicitly states that Rescue is a research prototype and does not connect to or replace 1669.

## 14. Research measures

The capstone may report:

- time from report to search start;
- time from search start to acceptance;
- time from acceptance to arrival in simulated runs;
- location-update freshness and event-delivery latency;
- proportion of successful end-to-end demo runs;
- correctness of authorization and atomic assignment tests;
- user feedback on confidence that the confirmed location was received and that help status was understandable.

Only de-identified aggregates are used in the report. The evaluation must distinguish simulated rescue times from real emergency-service performance.

## 15. Explicit design decisions

- Preserve the existing stack; do not rewrite the product.
- Split large files only along the service and UI boundaries in this document.
- Use MySQL transactions and events as the truth; use Redis only for recoverable live state.
- Support Web guest and LINE LIFF through shared citizen components.
- Treat live location as time-sensitive data and always display freshness.
- Stop dispatch search after a defined period instead of waiting forever.
- Prefer a reliable, auditable single-area prototype over broad feature expansion.
- Keep real 1669 integration outside this capstone implementation.
