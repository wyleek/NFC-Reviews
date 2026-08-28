# Operator hub — plan & branch breakdown

Companion to `docs/PLAN.md` (the original CRM/console plan) — same idea,
scoped to a later piece of work: merging the separate operator-facing
surfaces into one app. Written before the three Phase 2 branches below
started, so each can be picked up independently with full context, same
reasoning as the original plan.

## What this is

Today, running Tap2Review day-to-day means three separate web pages, each
with its own "enter the admin token" step:

- `admin.html` — onboard a business, generate tap cards
- `linkmaker.html` — one quick demo link before a sale closes
- the CRM board (`board/`, branch `feature/crm-pipeline-board`) — pipeline
  kanban, business detail, call list

Goal: one app, bottom tab navigation, configure once. Per a follow-up
clarification from wylee, **Link Maker isn't a separate tab** — its one
job (a working link before contact info exists) is already folded into
Admin's own flow (shipped as `feature/quick-link-field-flow`, PR #8, on
`admin.html` directly — the "Get a link now" button right after picking a
business). So the hub ends up with **three tabs**: Admin, CRM, Clients.

The client-facing `dashboard-app` (deployed:
https://dashboard-app-omega-beige.vercel.app, PR #6) stays **separate** —
clients must never see the operator's tab bar or other clients' data. The
Clients tab links out to it per-business rather than reimplementing it.

## Key decisions made building the foundation

- **New app**: `hub/` at repo root, React 19 + Vite — same stack as
  `board/`, no new tooling to learn.
- **Theme**: light, extending `admin.html`'s existing design (already
  built, tested, screenshotted). `hub/src/theme.css` is the ported,
  shared version — every tab builds on it instead of carrying its own
  stylesheet. `board/`'s dark theme does **not** carry forward; its
  components get re-themed when ported in on `feature/hub-crm-tab`.
- **Config unification**: `hub/src/lib/config.js` uses `admin.html`'s
  original localStorage keys (`t2r_fn` / `t2r_token` / `t2r_dash`), not
  `board/`'s (`t2r_admin_fn` / `t2r_admin_token`) — those two disagreed,
  which is exactly the "configure once" problem this merge exists to
  fix. Every ported component should import this shared config, not
  bring its own copy of `board/src/lib/config.js` forward.
- **Tab shell**: `hub/src/App.jsx` is a hand-rolled `useState(tab)`
  switcher (no router library) — the same shape `board/src/App.jsx`
  already used for its top nav, just moved to a fixed bottom bar
  (`.tabbar` in `theme.css`) with three tabs instead of a header row of
  buttons.
- **PWA**: `hub/public/manifest.json` + `hub/public/icon.svg` +
  `apple-mobile-web-app-*` meta tags in `hub/index.html`. No service
  worker — the app always needs live data, so offline caching isn't a
  goal; this is purely so "Add to Home Screen" behaves like an app icon
  instead of a bookmark.
- **No backend/schema changes** in the foundation — pure frontend
  scaffold. Each Phase 2 branch may need small backend touches of its own
  (see each brief).

## Branches

| Branch | Scope | Depends on |
|---|---|---|
| `feature/operator-hub` | This foundation: app shell, shared config, shared theme, PWA manifest, three placeholder tabs | — (done) |
| `feature/hub-admin-tab` | Port `admin.html`'s flow (search → quick-link → contact → cards, PRs #7/#8) into `hub/src/components/AdminTab.jsx` | `operator-hub` |
| `feature/hub-crm-tab` | Port `board/`'s 9 components into the hub, re-themed to `theme.css`, re-pointed at the shared config | `operator-hub` |
| `feature/hub-clients-tab` | New: every customer, reviews-gained snapshot, red/yellow/green health flag | `operator-hub` |

The three Phase 2 branches don't touch each other's files (each owns its
own tab component) so they're safe to build in parallel, each in its own
worktree — see the matching `docs/BRANCH_BRIEF-*.md` for the branch you're
on. All three merge into `feature/operator-hub`; that branch goes to
`main` as one reviewed unit once all three tabs are in.

## Recommended build order

Same "one branch, one session" reasoning as `docs/PLAN.md`: pick your
`docs/BRANCH_BRIEF-*.md`, work only in your own worktree, don't touch
`App.jsx`/`theme.css`/`lib/config.js` unless your brief specifically calls
for it (they're shared — a change there affects the other two branches
too, so coordinate with wylee before touching them).
