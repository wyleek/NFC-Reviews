# Branch: feature/hub-admin-tab

## Scope
Port `admin.html`'s working flow into `hub/src/components/AdminTab.jsx`
(React), inside the operator hub built on `feature/operator-hub`. Read
`docs/PLAN-hub.md` first for the overall context.

## Background
`admin.html` (repo root, vanilla JS) is a tested, working 3-step flow:
search a business → (optional) get one working link immediately (PR #8,
the "walk in the door" link) → contact info → cards + pricing → create,
which hands back a tap-card link per card plus a dashboard link for the
client (PR #7). All of this already works against `admin-api` — this
branch is a **port**, not a redesign. Preserve the behavior; change the
implementation from imperative DOM (`S` object + `render()`) to React
state.

## Work
- `AdminTab.jsx` (+ sub-components if it gets big — e.g. a `SearchStep`,
  `QuickLinkCard`, `ContactStep`, `CardsStep`, `TagsResult`) replacing the
  current placeholder at `hub/src/components/AdminTab.jsx`.
- Call the same `admin-api` actions `admin.html` already uses:
  `search_place`, `lookup_business`, `quick_link`, `create_business` —
  same request/response shapes, no backend changes needed.
- Import config from `../lib/config.js` (the shared one — `t2r_fn` /
  `t2r_token` / `t2r_dash` keys), not a new copy. Use its exported
  `dashboardUrl(businessId)` helper for the client-dashboard link, same as
  `admin.html`'s `dashboardUrl()`.
- Style with the existing classes in `hub/src/theme.css` (`.card`, `.btn`,
  `.field`, `.step`, `.link`, `.hit`, etc.) — these already match
  `admin.html`'s look, so this should mostly be a 1:1 translation of
  existing markup into JSX, not new CSS.
- Once a business is created here, it should be immediately visible in
  the CRM tab (same `businesses` table, no extra wiring needed on this
  branch — just don't do anything that would prevent that, e.g. don't
  cache business lists locally in a way that goes stale).

## Key files
- `admin.html` (repo root of any worktree) — the source of truth for the
  flow/copy/behavior being ported
- `hub/src/lib/config.js` — shared config, already built
  (`feature/operator-hub`)
- `hub/src/theme.css` — shared styles, already built
- `hub/src/components/AdminTab.jsx` — placeholder to replace
- `supabase/functions/admin-api/index.ts` — reference for exact
  request/response shapes of `search_place` / `lookup_business` /
  `quick_link` / `create_business` (no changes expected here)

## Acceptance checklist
- [x] Search → pick a result → (optional) "Get a link now" → contact →
      cards → create, all working against the real `admin-api`
- [x] Created business's cards each show their own tracked link + copy
      button
- [x] Client dashboard link shown and copyable (PR #7 behavior)
- [x] A business created here shows up in the CRM tab without a page
      reload (no local business-list caching added on this branch)
- [x] `npm run build` in `hub/` succeeds

## Notes for the reviewer
- `admin.html` in this worktree didn't yet have the quick-link (PR #8,
  `feature/quick-link-field-flow`) or dashboard-link-handoff (PR #7,
  `feature/dashboard-link-handoff`) changes — they exist as separate
  branches, not yet merged to `main`. Ported the behavior from both
  branches' `admin.html` diffs since the brief describes them as already
  shipped; `admin-api` already supports `quick_link` and returns
  everything `dashboardUrl()` needs, so no backend changes either way.
- `hub/src/lib/adminApi.js` is new — a thin `call(action, payload)`
  wrapper matching `board/src/lib/adminApi.js`'s existing convention,
  scoped to the four actions this tab uses.
- Added a handful of classes to `theme.css` that `admin.html` has but the
  shared stylesheet didn't yet (`.cardrow`, `.del`, `.tagbox`, `.warn`,
  `.checklist`/`.dot`) — additive only, no existing rule changed, so
  CRM/Clients are unaffected.
