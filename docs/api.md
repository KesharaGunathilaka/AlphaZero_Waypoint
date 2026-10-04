# Waypoint API (FastAPI) — for the frontend

Base URL: `${NEXT_PUBLIC_API_URL}/api/v1` (`lib/api/client.ts` already adds `/api/v1`).
Every call sends the Clerk session token: `apiRequest(path, { getToken })`.
Interactive docs with every schema: `http://localhost:8000/docs` (development only).

**Who is who:** the API looks the Clerk user up in `wp.app_user` (role, depot, outlet, vehicle). On a
user's first call it reads their primary email from Clerk and links it, so a Clerk user must have
the same email as a seeded account (table below). The database role is what counts, not the org role.

**Errors:** a broken rule comes back as `409 {"detail": {"code": "WP210", "message": "Van-only outlet"}}`
(permission problems are `403` with code `WP0xx`). Show `detail.message` to the user as is.

## Seeded accounts (`wp.demo_reset()`)

| Role | Email (create the same user in Clerk) | Works at |
|---|---|---|
| Dispatcher | dispatcher@example.com | Kandy depot |
| Loader | loader.kandy@example.com | Kandy depot |
| Driver | driver.veh057@example.com | VEH057 (refrigerated van, Kandy) |
| Driver | driver.veh059@example.com / driver.veh060@example.com | VEH059 / VEH060 |
| Store manager | store.out077@example.com | OUT077 (Fresh, Kandy, van-only) |
| Store manager | store.out078@example.com | OUT078 (gets the deferral notice) |
| Admin | admin@example.com | everything |

## Everyone

| Method | Path | Returns |
|---|---|---|
| GET | `/me` | name, role, depot, outlet_code, vehicle_code |

## Store manager

| Method | Path | Body / query | Notes |
|---|---|---|---|
| GET | `/store/outlet` | | outlet, brand, district, windows |
| GET | `/store/products?temp=ambient\|chilled` | | catalogue for the outlet's brand |
| GET | `/store/order-slot?temp=…` | | `delivery_date`, `cutoff_at`, `closes_in`, existing order for that day |
| POST | `/store/orders` | `{client_request_id: uuid, temp, lines: [{product_id, qty}]}` | Generate `client_request_id` once per form; a retry returns the same order. 409 `WP168` = already ordered that day |
| GET | `/store/orders` | | `store_orders` rows: status, delivery_date, `window_start/end` (after release), `moved_to` + `moved_reason` (deferral), `needs_receipt`, lines |
| GET | `/store/orders/{id}` | | + `receipt_lines` (ordered / loaded / delivered), `timeline`, `proof` (attachment ids) |
| POST | `/store/orders/{id}/receipt` | `{issues: [{line_no, type: short\|damaged\|wrong_item\|not_received, qty?, note?}]}` | empty `issues` = all OK. Returns issue reference numbers |
| GET | `/store/notices` | | order confirmed, deferred, arrival window, short loaded, delivered |
| POST | `/store/notices/{id}/read` | | |

## Dispatcher

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/dispatch/runs` | | `next_open_date` + recent runs (state, plan_id, orders) |
| POST | `/dispatch/runs/{YYYY-MM-DD}/close` | | **Close orders now** (normally 16:00). Returns `plan_id` |
| GET | `/dispatch/plans/{plan_id}` | | `summary`, `routes` (each with gauges, `trip_minutes`, `fuel_left_l`, `stops[]` with `orders[]`), `unplanned` (with `suggested_reason`, skip history), `violations`, `vehicles`, `reasons` |
| POST | `/dispatch/plans/{plan_id}/propose` | | **Run the engine** (before first release). Returns trips, deferred orders, violations |
| POST | `/dispatch/plans/{plan_id}/move` | `{order_id, vehicle_id, seq: 1\|2}` | Manual adjustment. 409 with the rule if refused |
| POST | `/dispatch/plans/{plan_id}/defer` | `{order_id, reason_code, note?}` | Drafted; applied on release. `other` needs a note |
| PATCH | `/dispatch/routes/{route_id}` | `{depart_at}` | Re-times the trip |
| POST | `/dispatch/plans/{plan_id}/release` | | Applies deferrals (stores notified) and publishes v1, v2… 409 `WP201` lists blocking problems |
| PATCH | `/dispatch/vehicles/{vehicle_id}` | `{active}` | Workshop on/off |
| GET | `/dispatch/monitor` | | `runs` progress, `fleet` (with `last_seen_at`, `no_signal`), `exceptions` (failed, flags, short loaded, no signal, late, conflicts) |
| POST | `/dispatch/flags/{flag_id}/reply` | `{type: proceed_short\|hold\|note…, text?, resolve?}` | Answer a loader/driver flag |
| GET | `/dispatch/ledger` | | every deferral and delivery |
| POST | `/demo/reset` | | Fresh demo day (wipes orders/plans/deliveries). Local sign-in and local test runs only; 404 when the API uses Clerk |

## Loader (tablet)

| Method | Path | Notes |
|---|---|---|
| GET | `/loader/routes` | released trips to load, earliest departure first (`lines_total`, `lines_confirmed`, `open_flags`) |
| GET | `/loader/routes/{route_id}` | `lines[]`: `load_order` (1 = load first = last stop), outlet, product, ordered_qty, qty_loaded, line_state, flag, dispatcher_reply |

Loading is recorded with `/sync` events (below): `load_confirm`, `flag`, `route_release`.

## Driver (phone, works offline)

| Method | Path | Notes |
|---|---|---|
| GET | `/driver/run` | `plans[].routes[]` (stops, outlet, orders, lines) — store it on the phone; `deliveries` already done; `instructions` from dispatch |

## Sync (loader and driver) — the offline queue

`POST /sync` `{device_id: uuid (fixed per browser), client_now, events: [...]}`

Every user action becomes an event with its own `event_id` (UUID made on the device) and the time it
happened (`device_time`). Keep events in IndexedDB/localStorage until `/sync` returns them; resending the
same events is safe (no duplicates). Results come back per event: `applied`, `rejected` (with
`reject_reason`), or `null` = pending (waits for an earlier event, retried by the server).

| type | route_id | stop_id | payload |
|---|---|---|---|
| `load_confirm` | ✓ | | `{lines: [{confirmation_id: uuid, order_id, line_no, qty_loaded}]}` (qty below ordered = shortfall) |
| `flag` | ✓ | optional | `{flag_id: uuid, type, order_id?, line_no?, qty?, note?}` loader types `missing\|short\|damaged`; driver `running_late\|cannot_reach\|outlet_closed\|vehicle_problem\|load_problem\|other` |
| `route_release` | ✓ | | `{release_id: uuid}` — needs every line confirmed |
| `depart` | ✓ | | `{}` |
| `arrive` | ✓ | ✓ | `{}` |
| `delivery` | ✓ | ✓ | `{delivery_id: uuid, order_id, outcome: delivered\|delivered_in_part\|not_delivered, received_by, reason_code?, note?, lines?: [{line_no, delivered_qty, reason_code}]}` |
| `heartbeat` | | | `{}` — send every minute while online; the dispatcher sees "no signal" after 20 min |
| `instruction_seen` | ✓ | | `{instruction_id}` |

## Photos and signatures

`POST /attachments` (multipart): `file`, `kind=photo|signature`, `attachment_id` (uuid, optional),
one of `delivery_id` / `flag_id` / `issue_id`, `device_time`. Upload **after** the event it belongs to has
synced. `GET /attachments/{id}` returns the image.

## Judge walkthrough (what the API test `backend/tests/walkthrough.py` does)

1. Dispatcher: **Reset demo** → service date = next open day; 70 Kandy orders seeded.
2. Store OUT077: place the dry order (the chilled one is seeded).
3. Dispatcher: **Close orders now** → **Propose** → VEH057 T1 OUT077→083→079 (1,030 kg, 76 min), T2 OUT076→082→081 (1,000 kg, 76 min); OUT078 chilled deferred (*van-only outlet and vans full*) → try moving OUT077 to a truck (refused: *Van-only outlet*) → **Release**.
4. Store OUT078: sees "Not arriving on …, moves to …".
5. Loader: VEH057 trip 1, load OUT079 → OUT083 → OUT077 (reverse order), OUT079 short 2 crates (flag) → dispatcher replies *Send partial* → release.
6. Driver VEH057: run downloaded; offline: depart, arrive, deliver OUT077 → back online: sync (resend is harmless) → photo.
7. Store OUT077: confirm receipt, 1 crate damaged.
8. Dispatcher: monitor shows *short loaded*; ledger shows the delivery and the deferral with its reason.
