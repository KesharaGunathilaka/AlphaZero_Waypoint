# Waypoint UX by role: why each screen is built the way it is

Each of the four roles works in a different place, on a different device, under different pressure.
This document states, for each role, **who they are, where they are, what they must get done**, the
design decisions that follow, and the evidence that the decisions work: screenshots from a full run
of the demo day (Kandy depot, Tue 6 Oct) and measurements taken in the browser.

All screenshots in [`docs/ux/`](ux/) were taken from the production build (`docker compose up`) with
the local sign-in, in one continuous run: dispatcher plans → loader loads VEH057 (one line short) →
driver delivers two stops (the second with no signal) → store managers see the result.

| Role | Device and place | Main pressure | Design answer |
|---|---|---|---|
| Dispatcher | Desktop or laptop in the depot office; phone when away | Many orders, hard rules, a deadline before 03:30 | One guided flow, one main button, every rule explained |
| Loader | Shared tablet on the loading dock, gloves, noise, poor light | Load fast, in the right order, flag what is missing | Dark high-contrast tablet UI, huge quantities, one tap per line |
| Driver | Own phone, in the cab, often no signal, not a "tech" person | Drive, find the stop, hand over, prove it | One big "next step" button, plain words, works offline |
| Store manager | Phone on the shop floor, sometimes the office PC | Order before 16:00, know what is coming, report problems | Three sections under the thumb, "Needs you" first |

---

## 1. Dispatcher

**Who and where.** Plans the next day in the depot office between the 16:00 cutoff and the first
departures at 03:30. Knows the operation well, but is not a planner by training. Needs to defend every
decision (which orders were deferred, why) to store managers and management the next day.

**What was wrong before** (feature/wire, [`before-dispatcher-plan.jpg`](ux/before-dispatcher-plan.jpg),
[`before-dispatcher-deferrals.jpg`](ux/before-dispatcher-deferrals.jpg)):
- Four tabs named by design-spec codes (D1 · Plan board, D2 · Overflow & deferrals …).
- The plan was a column of large vehicle cards (gauges, timeline, chips): about three vehicles per
  screen, so 15 vehicles meant a long scroll to answer "is everything planned?".
- Before the engine ran, all 70 orders showed "Cannot fit" (a false alarm).
- After the engine ran, the message sent the dispatcher to D2 to "confirm" deferrals that were
  already drafted (seven radio buttons per order, a Confirm button), then back to D1 to release:
  six clicks over two tabs, as the screens guided it.

**Design decisions in v2**

| Decision | Why |
|---|---|
| Plain tab names: Plan · Deferred · Live · Records, with a count badge on Deferred | Names say what is inside; the badge shows where attention is needed |
| "Today's steps" strip: Close orders → Build the plan → Check what can't go → Send to depot → Watch it run, with **one** main button that is always the next step ([`02`](ux/02-dispatcher-plan.jpg)) | A new dispatcher can run the day without training; an experienced one never hunts for the next action |
| Trips as one table row each (vehicle, brand + district, leaves–back, stops in order, load %, fuel), filter chips and search, details open on demand ([`03`](ux/03-dispatcher-trip-detail.jpg)) | About 9 trips per screen at 1024×768 instead of about 3 vehicles; answering "where is OUT083?" is one search |
| Every deferred order carries the engine's reason from the start; changing it saves at once ([`05`](ux/05-dispatcher-deferred.jpg)) | No separate confirm step; reasons are what the store is told, so they must exist before sending |
| "Try to fit" opens a dialog listing **every vehicle and why it cannot take the order**, grouped by rule ([`04`](ux/04-dispatcher-why-deferred.jpg)) | The dispatcher can prove a deferral was unavoidable: for OUT078 both VEH057 trips are full, five trucks cannot reach a van-only outlet, VEH058 is in the workshop, fifteen vehicles cannot carry chilled goods |
| Send is blocked, with the reason in words, while any rule is broken | A plan that breaks a booklet rule can never reach the depot |
| Live view uses the same vehicle IDs as the plan (VEH057, not RV-03) and sorts trips by risk ([`18`](ux/18-dispatcher-live.jpg)) | One name per vehicle across every screen and role |

**Evidence**
- Orders open → plan sent: **3 clicks on one screen, always the same button position** (Close orders
  now, Build the plan, Send plan to depot) instead of 6 clicks over 2 tabs.
- Engine plan for the demo day: 21 trips, 67 of 70 orders, 3 deferrals, 0 rule problems; all three
  deferrals proven unavoidable by `backend/tests/rules_audit.py` (112 checks).
- Works at 375 px (phone, [`19`](ux/19-dispatcher-phone.jpg)): steps stack vertically, no sideways scroll.

## 2. Loader

**Who and where.** Loads vans and trucks on the dock from about 02:30, on a shared tablet mounted or
propped near the bay, in poor light, often with gloves. Must load the **last stop first** so the
driver unloads in order, and must report shortfalls before the van leaves.

**Design decisions** (kept from the design, sharpened in v2)

| Decision | Why |
|---|---|
| Dark theme, white type, 56 px+ buttons | Readable in a dim dock at arm's length; hits with gloves |
| Stops listed in loading order (last stop first) with "Stop 1 unloads first, so it loads last" | The rule is stated where the work happens |
| v2: **quantity first, 24 px bold**, unit under it, product name after ([`07`](ux/07-loader-load-list.jpg)) | The loader counts cartons; the number is what they look for |
| v2: "All loaded in full · confirm stop 3" sits **under** the lines | Natural order: tick lines, then sign the stop off |
| Flag sheet: Missing / Short / Damaged, a ± counter and the effect in words ([`08`](ux/08-loader-flag.jpg)) | One flag never stops loading; the dispatcher gets it at once |
| Departure check: stops, lines, the shortfall in large type, final weight and volume, release signed with the loader's own sign-in ([`09`](ux/09-loader-departure-check.jpg)) | Accountability without a PIN; the driver and the store see the same shortfall |
| v2: full screen on the tablet, header wraps instead of overlapping, one column in portrait with the Departure check button stuck to the bottom ([`06`](ux/06-loader-vehicles-portrait.jpg)) | Works in portrait (768×1024) and landscape (1024×768) |

**Evidence.** Tested at 768×1024 and 1024×700: no element overflows. The shortfall flagged in the run
(2 packs of chicken for OUT079) reached the dispatcher's Live view with "Send partial / Hold vehicle"
replies ([`18`](ux/18-dispatcher-live.jpg)) and the driver's screen at that stop
([`14`](ux/14-driver-short-load-no-signal.jpg)).

## 3. Driver

**Who and where.** Drives a van or truck through Kandy and the hill districts, where mobile coverage
drops. Uses their own phone with one hand, often in a hurry, and is not comfortable with apps.

**What was wrong before** ([`before-driver-home.jpg`](ux/before-driver-home.jpg)):
- The screens sat inside a drawn phone frame, even on a real phone (wasted edges).
- The floating "Sign out" badge covered the bottom buttons.
- A hidden hamburger menu listed screens by code (R1, R2 …), including states like "Driving".
- The home card offered "Navigate" and "Open stop"; the next real step (arrive, deliver) was a screen away.
- A hydration error on every load (the run cached on the phone was read during server rendering).

**Design decisions in v2**

| Decision | Why |
|---|---|
| One giant button at the bottom (64 px) that is always **the next step**: Start trip → I'm here → Deliver ([`10`](ux/10-driver-start-trip.jpg), [`11`](ux/11-driver-im-here.jpg)) | Nothing to remember: the app says what to do next, in the thumb zone |
| The stop it is about in large type: name 26 px, **"Arrive by 07:30" at 40 px**, unload type, chilled, "store opens at 05:00, early? wait" | Readable at a glance at a traffic light |
| One row of plain secondary buttons: 🧭 Map · ⚑ Problem · ☎ Call | Every exception is one tap away, with an icon and a word |
| Outcome words a driver uses: **All delivered / Some missing / Not delivered**; "Taken by" instead of "Received by"; "Tap − for missing items" ([`12`](ux/12-driver-deliver.jpg)) | No logistics jargon |
| A labelled **Menu** button; the menu only holds My run, Report a problem, Call, Simulate no signal and Sign out | Hidden icons are easy to miss for people new to apps |
| No signal is normal: "No signal · 2 to send", "Saved on this phone. Not sent yet", then "✓ All sent" by itself when signal returns ([`13`](ux/13-driver-offline-saved.jpg)) | The driver never wonders whether work was lost |
| The loader's shortfall shows at that stop: "Loaded short: Chilled chicken (2 missing). The store knows." ([`14`](ux/14-driver-short-load-no-signal.jpg)) | The driver is not blamed for what never left the depot |
| Full screen on the phone (safe-area padding for the home bar); the framed handset is kept only on large screens for demos | Every pixel goes to the road |

**Evidence**
- Per stop: **I'm here → (name) → Save delivery → Next stop = 3 taps and one name**, buttons in the
  same place every time.
- Offline run: a delivery saved with no signal, kept on the phone, sent automatically when signal
  returned; resending is safe (each record has its own ID; tested in `backend/tests/walkthrough.py`).
- Every driver screen checked at **320 px** (the smallest common phone width): no element overflows.
- Hydration error gone (the run is read only after the page hydrates).

## 4. Store manager

**Who and where.** Runs a Fresh, Style or Tech outlet. Orders on a phone on the shop floor (sometimes
the office PC), must order before 16:00 the working day before, and checks deliveries at the door.

**What was wrong before** ([`before-store-phone.jpg`](ux/before-store-phone.jpg)): four tabs across
the top ran off a phone screen ("Confirm" cut off), "Order detail" was a tab rather than something you
open, and disabled "Change order" buttons appeared on every locked order.

**Design decisions in v2**

| Decision | Why |
|---|---|
| Three sections, **Deliveries · Order · Confirm**, in a bottom tab bar on phones (top tabs on desktop), with a red count on Confirm ([`16`](ux/16-store-needs-you.jpg)) | Under the thumb; the count says when something needs confirming |
| "Needs you" first: what arrived and must be confirmed | The one task that is time-sensitive at the door |
| A deferral arrives as "Not arriving on Tuesday · it will come on Wed 7 Oct · plan Tuesday's chilled stock without it" ([`15`](ux/15-store-deferred-notice.jpg)) | The store hears the reason and the new date in its own terms, the moment the plan is sent |
| Locked orders say "🔒 Locked at the cutoff · call dispatch to change it" instead of a grey button | No control that does nothing |
| Confirm delivery shows ordered / driver delivered / you received per line, "Matches order" or "Report issue" ([`17`](ux/17-store-confirm.jpg)) | Disputes are settled line by line, with the driver's record next to the store's |

**Evidence.** All four store screens checked at 320 px: no overflow. The deferral notice, the
"arrived at 03:11, confirm receipt" card and the confirm screen are from the same run as the
dispatcher's plan and the driver's delivery.

---

## Responsiveness matrix (checked in the browser, no element wider than the screen)

| Role | 320 px phone | 375 px phone | 768×1024 tablet | 1024×768 laptop / tablet | 1280 px+ |
|---|---|---|---|---|---|
| Dispatcher | ok (secondary) | ok | ok | ok (main) | ok |
| Loader | — (fallback) | — | ok (portrait) | ok (main, landscape) | framed tablet |
| Driver | ok | ok (main) | framed phone | framed phone | framed phone |
| Store manager | ok | ok (main) | ok | ok | ok |

## Shared rules across every screen

- Status is never colour alone: every state pairs an icon with a word (✓ ▲ ✕ ● ⊘).
- Touch targets: 44 px minimum on phones, 56 px+ on the dock tablet.
- One name per thing across roles: VEH057, OUT077, "Fresh Kandy OUT077".
- Sign-out sits in each app's own header or menu, never floating over content.
- Nothing is lost offline: the driver's phone and the loader's tablet save first and send later.

## Not verified here

- The driver's service worker (reopening `/driver` after a reload with no signal) needs a real Chrome:
  the embedded test browser refuses service-worker registration. Check in Chrome DevTools →
  Application → Service workers after opening `/driver` on the production build.
