# Backend security

How the API and database protect Waypoint's data, what changed in the October 2026 security pass, and
how each protection is tested. Branch `frontend_v2`; the changes are not committed yet.

**Proof:** `backend/tests/security_audit.py` attacks every protection below (56 checks, all pass), and the
existing suites (`rules_audit`, `day_scenario`, `walkthrough`) pass with the API on the restricted role.

---

## Layers

| Layer | What it stops |
|---|---|
| Sign-in (Clerk deployed, local accounts in Docker) | Anyone without a valid, unexpired token issued to our web app |
| Role and depot checks in the API | A loader calling dispatcher endpoints; a Kandy dispatcher editing Peliyagoda |
| Workflow functions in the database (`assert_role`, `assert_depot`) | The same, even if the API had a bug; an actor id that is not the signed-in user |
| **Restricted database role** (new in practice) | Any write the design does not allow: append-only tables stay append-only, no TRUNCATE, no schema changes |
| **Row-level security** (now actually applied) | Reading or writing rows outside your outlet, depot or trips, even through a direct SQL bug |

---

## What changed

### 1. The API now runs as a restricted database role · critical

**Before.** The schema has always defined `waypoint_app` (no ownership, no UPDATE/DELETE on append-only
tables, row-level security applies), and our docs said the API used it. In practice the API connected as
`waypoint`, the database **owner and superuser**. A superuser ignores every GRANT, and the owner bypasses
row-level security. So the "second line of defence" was switched off.

**Now.**
- A login role `waypoint_api` (member of `waypoint_app`) is created when the database is first built
  (`db/init/10-load-waypoint.sh`); Docker's API connects with it.
- `db/migrations/006_least_privilege.sql` completes what the role needs and nothing more: the missing
  function grants, row-level **write** policies for trips and stops (dispatchers, own depot only), the
  audit trigger running as the owner (the API can cause audit rows, never edit them), and
  `clear_plan_draft()` so the engine replaces a draft plan without the API having DELETE rights.
- `demo_reset()` now checks its caller: an owner session, or a signed-in dispatcher. The API role with no
  user, or a store manager, is refused (`WP010`).
- The API logs a warning at start-up if it is connected as a superuser or the owner.
- Every transaction now sets the signed-in user, including the ones after a commit (a read after a commit
  used to run as "nobody"; harmless as the owner, but it hid rows once security applied).

**Proved by** `security_audit` Part A: UPDATE a delivery, DELETE or TRUNCATE the audit log, DELETE a trip,
edit a proof-file record, create a table, wipe the data as a store manager: all refused by the database;
with no user the API role sees zero orders; a store manager's session sees only its own outlet.

### 2. Photos and signatures · high

**Before.** Any signed-in user could attach a file to any delivery, flag or issue; the file type the browser
claimed was stored and served back (an HTML page could be stored as an "image"); the file was stored before
the record was checked, so a rejected upload left an orphan file, and on S3 re-uploading a known id
**overwrote the original proof of delivery**; any signed-in user with an id could get a link to any photo.

**Now.**
- Exactly one link, and it must be yours: your own delivery (driver), a flag you raised, an issue on your
  outlet's order. A signature only on a delivery.
- The type comes from the file's own bytes (JPEG, PNG, WebP, GIF, HEIC); anything else is refused.
- The record is checked and written first, the file stored after. An existing id can only be "re-sent" by its
  uploader with the identical file (a dropped connection); anything else is refused (409).
- A link is given only to people who may see the delivery, flag or issue.
- Files are served as images, sandboxed, with `nosniff`; anything unexpected downloads instead of rendering.

**Proved by** `security_audit` Part B (16 checks).

### 3. Clerk sign-in (deployed app) · high

- **Authorized party checked.** `CLERK_AUTHORIZED_PARTIES` was required in production but never compared
  with the token. Now a token issued to any other site on the same Clerk instance is refused.
- **Only verified emails link accounts.** A first Clerk sign-in is linked to a Waypoint account by email;
  that email must now be verified at Clerk, so an unverified sign-up with a staff member's address
  cannot take over their account.
- Token errors no longer echo the parser's message to the caller (it goes to the log).
- Tokens must carry `exp`, `iat` and `sub`; `CLERK_JWKS_URL` is required in production.

### 4. Sign-in throttle (Docker / local sign-in) · medium

Local sign-ins reach the API through the web server, so the per-address limit (10 a minute) saw one
address for everyone: weak against guessing, and one attacker could block all sign-ins. Now each account
gets 10 wrong passwords per 15 minutes, then waits (429 with `Retry-After`), whatever address or letter case
is used. Wrong email and wrong password get the same message; failed sign-ins are logged with a masked
email. Field limits: email ≤ 254, password ≤ 128 characters.

**Proved by** `security_audit` Parts C and D (16 checks): forged, unsigned (`alg: none`), expired,
expiry-less, wrong-audience, wrong-issuer and garbage tokens are refused.

### 5. Smaller hardening · low

- Changing a trip's departure: only your depot's trips that have not started loading.
- Moving an order: only an order of that plan's day.
- Length and range limits on every free-text field, quantity and list in the API.
- `Cache-Control: no-store` on data responses (orders, names, tokens never cached), `Permissions-Policy`.
- Dependencies: `certifi` and `opentelemetry-api` upgraded past published advisories; `pip-audit` clean.

---

## For the deployed app (Neon): one step the team must do

The deployed API still connects as the Neon owner until you switch it:

```bash
./db/load.sh "$NEON_OWNER_URL" --migrate
WAYPOINT_API_PASSWORD='<a long random password>' ./db/load.sh "$NEON_OWNER_URL" --api-role
```

Then set the API's `DATABASE_URL` on Vercel to the same connection string with user `waypoint_api` and that
password, and redeploy. The start-up warning disappears when it worked. Also check that
`CLERK_AUTHORIZED_PARTIES` lists the web app's exact origin (for example `https://alpha-zero-waypoint.vercel.app`):
it is now enforced.

---

## Known limits (honest list)

- The sign-in throttle lives in memory: right for the single Docker API process; a multi-instance deployment
  would keep the counts in the database or a cache. Clerk has its own brute-force protection for the
  deployed app.
- An account can be locked for 15 minutes by someone who knows its email and keeps guessing (the usual cost
  of per-account throttling).
- Local sessions last 12 hours and are not revoked at sign-out (the cookie is deleted; the token itself stays
  valid until it expires). Deactivating a user does stop them at once.
- The web app's own pages (Next.js) were not part of this pass.
