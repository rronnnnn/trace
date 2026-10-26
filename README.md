# TRACE

A personal record of becoming stronger. A workout tracker built around fast set logging and a data-driven
Training Landscape.

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind CSS v4 · Supabase (Postgres, Auth, RLS) · Motion · Vitest

## Getting started

```bash
cp .env.example .env.local   # Supabase URL + publishable key
npm install --legacy-peer-deps
npm run dev
```

Scripts: `npm run dev`, `npm run build`, `npm test` (unit), `npm run typecheck`, `npm run lint`.

## Architecture

| Area | Where | Notes |
| --- | --- | --- |
| Schema, RLS, RPCs | `supabase/migrations/` | Applied to the Supabase project in order. Every user table is owner-scoped by RLS. |
| Auth | `src/proxy.ts`, `src/app/(auth)`, `src/lib/supabase/server.ts` | Email + password. The proxy refreshes the session and guards routes. |
| Active workout engine | `src/lib/workout/` | Pure reducer (`reducer.ts`, unit-tested), device persistence (`storage.ts`, `use-active-workout.ts`), offline outbox (`sync.ts`). |
| Landscape | `src/lib/landscape/` | Deterministic terrain from sessions (`terrain.ts`), marching-squares contours (`contours.ts`). No React dependency. |
| Screens | `src/app/(app)/` | Today, Train, History, Workout. |
| Design tokens | `src/app/globals.css` | Ivory / charcoal / sage. Components use tokens only. |

### Data integrity

- **History never changes when routines do.** Sessions save copies of exercise names and prescribed targets
  (`template_name`, `exercise_name`, `target_*`), so editing or deleting a template leaves completed workouts as
  they were.
- **Finishing a workout is one atomic call.** `complete_session(payload)` writes the whole session in one
  transaction. It is idempotent on a session id that the client generates, so the offline outbox can retry safely.
- **Personal records are derived, not entered.** They are computed per session against earlier history, and
  replayed in date order if a session syncs late. The first value ever logged for an exercise is flagged
  `is_baseline` and is never shown as a record. Estimated 1RM (Epley, ≤ 12 reps) is stored and labelled
  separately from measured records.
- **Sample data stays separate.** Sample history is stored with `is_sample = true`, labelled in the UI, and
  `clear_sample_history()` removes it and rebuilds records from real sessions only.

### Offline behaviour

The workout in progress is written to localStorage on every change (synchronous, so it survives an immediate
refresh) and to IndexedDB. A finished session goes into the IndexedDB outbox *before* it is sent. The sync agent
retries on load, when the connection returns, when the tab regains focus, and every minute.

Known limit: there is no service worker yet, so a full page reload while offline cannot load the app shell. Logging
sets, the rest timer and finishing a workout all work offline once the page is open.

## Training Landscape

`/landscape` maps persisted history. Each routine raises its own mountain range along a seeded, freeform spine
(diagonal, vertical, arcing), climbed session by session in time order; a session sits off the crest when its volume
differs from that routine's average. The river is the time axis, oldest at the left. Hill height
follows volume relative to your own training, and records (measured, never baselines or estimates) are landmarks.
With an exercise selected, the terrain is rebuilt from that exercise's volume alone.

Rendering (`src/lib/landscape/relief.ts`, `rest.ts`):
- **Relief.** An elevation tint (low ground darkest, summits palest) is multiplied by hillshading lit from the
  north-west. Ridged noise, scaled by how much training raised the ground, gives ranges crags and spurs. The relief is
  a client-side raster of the same field the contours are traced from, so the two always agree.
- **Water = rest.** Rest days are the days the plan leaves open with no session logged; missed training days are
  never water. A river follows the cheapest path through the valleys, and each run of rest days is a lake on it
  (single days are small pools, weekends larger lakes). Lakes are carved into the field, so contours wrap them.
- **Vegetation** tints low, gentle ground and scatters sparse tree marks clear of the water.
- **Colours** come from CSS tokens (`--terrain-*`, `--water*`, `--tree`). The relief redraws when the colour scheme
  changes, ready for dark mode.

- Filters: period (4 weeks to all time; refetches), workout, exercise. The selection lives in the URL
  (`?range=&workout=&exercise=&week=&session=`), so a view can be shared and survives a refresh.
- Interactions: click or press Enter on a landmark to inspect its recorded sets and records (estimated 1RM is
  labelled as an estimate). Select a week in the strip, or move with ←/→ and the step buttons. Esc clears.
- Empty, filtered-empty and sparse states each have their own message.
- Logic lives in `src/lib/landscape/explore.ts` (pure, unit-tested). Interactions are tested in jsdom
  (`landscape-explorer.test.tsx`).

### The world grows

The Explore landscape is one persistent world built from your **whole** history (`src/lib/landscape/world.ts`,
unit-tested in `world.test.ts`); the period only chooses which sessions show as points.
- Each routine owns a region on a seeded spine. Regions are placed in order of first appearance, so a new routine
  never moves existing ranges, and the river is routed through a layout that does not depend on how much you trained.
- A session adds bounded *effort* (1 for showing up, adjusted by its volume against that routine's median, plus a
  little per measured record, capped). Height is `ln(1 + effort)`, so early sessions show and later ones keep adding
  less. Effort only accumulates: breaks never shrink a range, and a session id is counted once.
- After a workout (`/history/<id>?completed=1` → *See how your landscape grew*, `?grew=<id>`) or on a return visit
  (last seen per user in localStorage), the terrain morphs from the earlier world into today's, the range that grew is
  lit, and one factual line says what changed. Reduced motion skips the morph.

### Explore

`/landscape/explore` is a real 3D scene (three.js, loaded only on this screen): a lit terrain mesh with soft shadows
built from the same height field, draped contours, a level water surface in a carved channel, instanced low-poly
trees, and standing pins for sessions (records in sage). The terrain fades to transparent at its borders, so it melts
into the page. Map controls: drag pans, scroll zooms, right-drag turns. On touch screens one finger pans, two fingers pinch
and pan, and turning is on buttons in a compact bottom bar; portrait phones get a turned camera that runs the map up
the screen, a bottom sheet for details, and lighter rendering (smaller grid, no shadow pass). 2D is the same scene
viewed from straight above. It renders only when something moves, at native resolution (sharp at any zoom).
Labels are HTML projected from 3D. Geometry builders are pure and unit-tested in `src/lib/landscape/mesh.ts`.

## Goals

`/goals`: a goal is an exercise and a summit, either a weight for at least N reps or, for bodyweight moves, N reps.
Progress is derived from recorded sets only (heaviest qualifying weight or most reps; never estimates) and drawn as a
side view of a mountain whose peak is the goal (`GoalMountain`). The climber is a slot (`renderClimber`) for a custom
animation. Reaching the target stamps `achieved_at` from the session that did it. Data: `goals` table, RLS, and a
reference policy for exercises.

## Appearance

System, Light or Dark (sidebar on desktop; account button on mobile). Every colour is a CSS token with a dark set;
the choice is applied before first paint.

## Testing

| Command | What it covers | Needs |
| --- | --- | --- |
| `npm test` | Workout reducer, refresh recovery (localStorage + IndexedDB), offline outbox and sync, landscape data logic and terrain determinism, Landscape interactions (jsdom) | nothing |
| `npm run test:db` | Live database: account isolation and RLS (including cross-account references), persistence, historical integrity, idempotent completion, records and baselines, validation, and the app's own start-workout queries | two QA accounts, see below |
| `npm run build`, `npm run lint`, `npm run typecheck` | production build, lint (incl. jsx-a11y), types | nothing |

`test:db` reads `.env.local` and needs `TRACE_IT_A_EMAIL`, `TRACE_IT_A_PASSWORD`, `TRACE_IT_B_EMAIL`, `TRACE_IT_B_PASSWORD`.
Account B's TRACE data is wiped at the start and end of each run, so never point it at a real user.

Not automated: visual or responsive checks in a real browser, screen-reader passes, and offline reload (no service
worker yet).

## Status

**Milestone 1 (done):** auth, onboarding, Today, Active Workout, history, sample history.

**Milestone 2 (in progress):** Training Landscape (done). Next: Exercise Progress, Weekly Reflection, routine editing.
