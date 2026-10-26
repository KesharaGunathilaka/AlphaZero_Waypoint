# Allocation engine changes (review before merging)

Branch `frontend_v2`, **not committed**. Hold off merging into `main` until after the semi-final: the demo
day's numbers change (see [What changes for the demo](#what-changes-for-the-demo)).

We set out to fix three weak points in `backend/app/modules/dispatch/engine.py`:

1. Vehicles were ranked by kilograms carried, but Style goods fill a vehicle's volume first.
2. Nothing stopped one day from using most of a vehicle's weekly fuel quota.
3. The test that "no deferral was avoidable" only tried moving one order at a time, so it did not prove the plan was optimal.

Measuring instead of trusting the theory changed the picture. Weak point 1 turned out to matter very little.
Fixing weak point 3 properly uncovered the **real** weakness: the order of a vehicle's two trips. Fixing
that is where almost all of the improvement comes from.

---

## Results at a glance

| Measure | Before | After |
|---|---|---|
| Kandy audit day (`rules_audit` Part A) | 67 of 70 served | **69 of 70, proven optimal** |
| Kandy full-day scenario (`day_scenario`) | 70 of 73 | **72 of 73, proven optimal** |
| Peliyagoda peak days (both scripts) | 114 of 124 · 113 of 116 | same; **not proven** optimal in 120 s, no better plan found |
| S1 peak day (Datathon Task 2B data) | 76 of 85, checker PASSED | 76 of 85, checker PASSED |
| Real history, full fleet (1,318 depot-days, 92,307 orders) | 1 deferral | **0** |
| Real history, 2 reefers in the workshop | 2,038 deferrals | **1,212 (−41%)** |
| Real history, 3 reefers in the workshop | 4,840 deferrals | **3,719 (−23%)** |
| Engine runtime (peak day) | ~17 ms | ~18 ms |
| Test suites | 116 + 116 checks | **118/118 + 118/118**, walkthrough passes |

"Real history" means every order day in the Datathon training data (Jan 2024 – Feb 2026), planned one day
at a time by the engine. The S1 plan was checked with the organisers' `check_allocation.py`.

---

## Change 1 · A vehicle's new trip may go *before* its existing trip

**What.** The engine used to append a vehicle's second trip after its first. Now, if the new trip does not fit
after, it also tries putting the new trip first and re-timing the existing trip to follow it. All the rule
checks are unchanged: capacity, the Fresh 270 / day 480 minute budgets (sums, so order does not matter),
fuel, and every window is re-checked for both trips. The database re-checks everything again on write.

**Why.** On the Kandy demo day, every reefer truck ran one trip and two Badulla chilled orders (OUT111,
OUT113) were deferred as "window unmet". The exact search (change 4) found a legal plan serving both. VEH041
had been given the local Kandy run first, timed just in time for 05:00 openings (leaving 04:44, back 06:18).
Kegalle could then only start after 06:18, too late for its 07:30 windows. Running the **far trip first**
(03:30, while the morning is free) and the local trip after it fits both, which frees a second truck for
Badulla, which needs 239 of a reefer's 270 Fresh minutes per run.

**Effect.** This alone takes the 2-reefers-out history from 2,038 to 1,279 deferrals and the Kandy day from 67
to 69. That is the bulk of the improvement.

**Code.** `Planner.timeline()` (stop timing, split out of `simulate()`), `Planner.minutes()`, `Trip.moves`
and `Trip.fresh`. `Vehicle.trips` now holds `Trip` objects instead of tuples (`free_at()` removed).

## Change 2 · Vehicle ranking: load first, best fit on weight, volume *and* time

When several vehicles can take a group's top order, the engine picks the smallest key:

| Order | Original | New |
|---|---|---|
| 1 | most **kilograms** carried | most **load**, each order on its tighter dimension (weight or volume) against the depot's largest vehicle |
| 2 | don't waste a van / reefer | inside its **fuel pace** (change 3) |
| 3 | smallest vehicle by weight | don't waste a van / reefer |
| 4 | | **best fit**: the vehicle the trip fills most on its tightest resource: weight, volume or the day's time budget |

**Why "load".** A bulky Style load now counts as much as a heavy Tech one. Measured honestly, this alone barely
matters on our data (2,035 vs 2,038 deferrals). Groups are small, and most of the time every candidate
vehicle takes the same orders. It is the correct measure, though, and never worse.

**What we tried and rejected.** Ranking by *number of orders served* first sounds fairer but was **worse**
(2,105 vs 2,038): it favours trips of many small orders and leaves the big ones for later, when fewer vehicles
are left. Placing big loads first is the classic bin-packing rule.

**Why time in best fit.** With change 1, a vehicle with a short gap left in its day is the right home for a
short trip, which keeps whole vehicles free for long ones. Including time made a small further gain
(1,215 → 1,212) and was never worse than the alternatives we tried.

| Ranking variant (with change 1) | Kandy day | S1 | History 2 out | History 3 out |
|---|---|---|---|---|
| Original key | 69 | 76 | 1,279 | 3,767 |
| Load, pace, wasted, fill (weight, volume) | 69 | 76 | 1,215 | 3,719 |
| **Load, pace, wasted, fill (weight, volume, time)** · chosen | **69** | **76** | **1,212** | **3,719** |
| Load, pace, wasted, time fill, then fill | 69 | 75 | 1,215 | 3,714 |
| Load, wasted, time fill, pace, fill | 69 | 75 | 1,280 | 3,761 |
| Load, pace, wasted, vehicle already in use, fill | 69 | 75 | 1,215 | 3,719 |

## Change 3 · Weekly fuel pacing

**What.** The weekly quota stays a hard limit, checked in the engine and again in the database. On top of it,
each vehicle gets a fair share for the day:

```
fuel pace = fuel left this week / operating days left this week (today included, from the calendar)
```

`propose()` counts the operating days with `is_working_day()`, so holidays are respected. In the ranking,
pacing only decides **between vehicles that would carry the same load**. It never takes an order away
today; it steers equal choices toward vehicles with fuel to spare.

**Why there in the key.** We tested putting pacing first. That turned 1 deferral into 199 on full-fleet
Peliyagoda weeks, because it forces worse vehicles onto trips. As a tie-break it costs nothing.

**Effect** (every real week, Monday–Saturday, fuel carried over, deferred orders roll to the next day):

| Depot · reefers out | Original | New, no pacing | **New + pacing** |
|---|---|---|---|
| Peliyagoda · 0 | 1 deferral · tightest vehicle ends week with 17% fuel (worst week 6%) | 0 · 7% (worst **0%**) | **0 · 15% (worst 6%)** |
| Peliyagoda · 2 | 1,885 · 22% (2%) | 934 · 11% (0%) | **905 · 18% (1%)** |
| Peliyagoda · 3 | 6,764 · 17% (0%) | 4,956 · 12% (0%) | **4,901 · 19% (0%)** |
| Kandy · 0 | 0 · 18% (16%) | 0 · 35% (20%) | **0 · 35% (24%)** |
| Kandy · 2 | 1,894 · 30% (13%) | 1,549 · 32% (20%) | **1,549 · 32% (24%)** |
| Kandy · 3 | 6,635 · 28% (15%) | 5,733 · 30% (15%) | **5,733 · 30% (15%)** |

Pacing matters *because* of change 1: vehicles now run two trips more often, and without pacing the busiest
Peliyagoda vehicle can finish a full-fleet week with no fuel left. With pacing it keeps a reserve and there
are slightly fewer deferrals. At Kandy it makes no difference.

## Change 4 · An exact test: can *any* legal plan serve more orders?

**What.** New `backend/tests/optimality.py`, called next to the existing single-order search in
`rules_audit.py` (Parts A, B) and `day_scenario.py` (both depots):

- a mixed-integer program (HiGHS solver) over the same booklet rules, recomputed from the CSVs like the rest
  of the audit: one brand and district per trip, chilled on reefers, van-only by vans, home depot, whole
  orders, weight and volume, two trips, Fresh 270 / day 480 minutes, weekly fuel left;
- the objective puts **outlets deferred before** first (the booklet's "same outlet unserved on consecutive
  runs", as the engine does), then orders served, then fewest trips;
- time windows and trip overlap are not linear, so they are checked by replaying every trip with the
  audit's own `schedule()` and cut out lazily when broken. Cuts are valid because adding stops only makes
  arrivals later;
- to make it fast enough: the search starts from the engine's plan, capacity is linked to trips in use,
  window conflicts between pairs of orders are added up front, slot 1 is the vehicle's later trip, and a
  **chilled-on-reefers ceiling** (chilled orders can only ride on reefers, so that smaller problem bounds
  every full plan) proves the Kandy day in about 2 seconds.

**Outcomes it reports.** *Proven* (PASS); *a better plan exists* (FAIL, naming the orders it would serve and
the ones it would defer instead); or *not proven* within `WP_EXACT_SECONDS` (default 120 per plan), with
an upper bound (PASS, clearly marked "NOT proven").

**The old check** is kept but renamed to what it actually proves: "No deferred order fits on its own
(single-order search ...)".

**Why this was the right fix.** The first version of this test failed against the original engine on the
Kandy day, with a legal 69-order plan. That is how change 1 was found.

## Small fix · fuel bookkeeping check in `day_scenario.py`

The end-of-day check compared each vehicle's weekly fuel (the API rounds it to 0.1 L) with the sum of its
trips (0.01 L) using a 0.05 L tolerance. With the new plans, VEH010's trips total 59.65 L, reported as 59.7 L.
The difference is exactly half a rounding step and tipped over through floating-point error. The fuel
accounting was right; the tolerance now allows for the rounding (`0.05 + 1e-6`), and the message names any
mismatching vehicle. With the original engine the check passed only because no total happened to end in .x5.

---

## Are these the best possible?

- **The Kandy days are provably optimal**: no legal plan serves more orders.
- **The Peliyagoda peak days are not proven.** No better plan was found in 120 s, and not even in 15 minutes
  for the chilled sub-problem. The bound the solver reaches there is weak ("at most 121 of 124", engine 114).
  We believe the 10 deferrals are mostly forced (two reefers in the workshop, far districts), but we cannot
  prove it yet.
- **S1 peak day:** the exact search found a legal plan serving 77 of 85 with the same fairness rule; the
  engine serves 76. This matches the Datathon MILP (77). So on that day the engine is one order short of the
  best known plan.
- **Still a greedy engine.** It stays explainable and plans a day in ~20 ms. Closing the last gap would need
  an optimiser in production (for example the Task 2B MILP as a "suggest" step with a time limit, the greedy
  plan as fallback, and the database still checking everything). We did not do that: it is an architecture
  change, too slow for the "Build the plan" button on peak days, and too risky before the semi-final.
- **Assumptions shared with the audit:** stops in window-close order, free-flow travel, and the booklet
  trip standard (which leaves out the return leg). The exact search is optimal *under those rules*.

---

## What changes for the demo

If this is merged, the Kandy walkthrough tells a slightly different story:

| | Before | After |
|---|---|---|
| Build the plan | 21 trips, 67 orders | 22 trips, 69 orders |
| Check what can't go | 3 orders (OUT078, OUT111, OUT113) | 1 order: OUT078 (the Day 5 worked example, unchanged) |
| Stores told | 3 | 1 |

The README on this branch is updated. **Not updated:** `docs/walkthrough/waypoint-delivery-day.html` and
its screenshots, the UX screenshots, and the semi-final playbook (they show 3 deferrals). OUT078's
"Try to fit" story and the VEH057 trips are unchanged.

---

## Files

| File | Change |
|---|---|
| `backend/app/modules/dispatch/engine.py` | changes 1–3; strategy docstring rewritten |
| `backend/tests/optimality.py` | **new**: change 4 |
| `backend/tests/booklet_audit.py` | single-order check renamed to what it proves |
| `backend/tests/rules_audit.py`, `backend/tests/day_scenario.py` | call the exact search; fuel tolerance fix |
| `backend/pyproject.toml`, `backend/uv.lock` | `highspy` as a **dev-only** dependency (the Docker image installs with `--no-dev`, so production is unchanged) |
| `README.md` | walkthrough numbers, test counts, how the avoidable-deferral checks work |

No database, API or frontend changes. The engine's output (`propose()`) has the same shape.

## How to run the tests

```bash
cd backend
uv sync   # installs highspy for the tests
ENVIRONMENT=development AUTH_DEV_BYPASS=true ALLOWED_HOSTS='["testserver"]' PUBLIC_API_URL=http://testserver \
DATABASE_URL="postgresql://waypoint:waypoint@localhost:5433/waypoint?sslmode=disable" uv run python tests/rules_audit.py
```

Each audit script now takes about 6 minutes (the exact search runs up to 120 s per planned day).
`WP_EXACT_SECONDS=20` shortens it while developing. The scripts reset the demo data, so run them against a
local or throwaway database.

The benchmarks behind the numbers above (S1, real history, week simulation, ablations) used the Datathon
data, which must not be committed or shared. Their scripts are therefore not in the repository.
