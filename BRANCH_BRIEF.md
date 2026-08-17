# Branch: feature/competitor-rolling-tracking

## Scope
Retrofit `competitor_snapshots` from a permanent history table to a rolling
window with live point-in-time gap + velocity computation. Depends on
`feature/console-live-data` (needs the live schema + dashboard data layer to
land on).

## Background
Per `docs/PLAN.md`'s ToS resolution: `competitor_snapshots` (in
`schema-competitors.sql`) currently stores rating/review_count with no
purge — exactly the risky pattern flagged in `lead-engine-spec.md`. The
practical stake is that a ToS flag suspends the whole Google Cloud project,
including the paying-customer-facing `redirect`/`sync-reviews` functions. The
resolved approach: competitor data stays **live-fetched** for the
point-in-time gap ("you have 37, they have 214") plus a **rolling-window
velocity** recomputed each cycle, with old observations purged — never a
permanent archive.

## Work
- Change the competitor sync job so each cycle does a live Places lookup for
  the gap display rather than reading from accumulated history.
- Add a rolling window (e.g. last N cycles) for velocity computation;
  purge observations older than the window on each run.
- Migrate/alter `competitor_snapshots` (or replace it) to enforce the
  rolling-window retention — no unbounded growth.
- Update `tap2review-dashboard.jsx`'s competitor views to consume the new
  gap + velocity shape instead of raw historical snapshots.
- Confirm no code path anywhere still writes competitor rating/review_count
  data with no purge path.

## Key files
- `schema-competitors.sql` (or wherever `competitor_snapshots` lives post
  `console-live-data`)
- `tap2review-backend.zip` — competitor sync logic
- `tap2review-dashboard.jsx` — competitor gap/velocity views

## Acceptance checklist
- [ ] Point-in-time gap is computed from a live fetch each cycle, not stored history
- [ ] Velocity is computed over a rolling window, old observations purged
- [ ] No table retains competitor rating/review_count indefinitely
- [ ] Dashboard competitor views updated to the new data shape
- [ ] Retention/purge job verified to actually run (not just defined)
