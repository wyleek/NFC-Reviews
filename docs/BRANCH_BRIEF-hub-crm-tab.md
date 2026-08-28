# Branch: feature/hub-crm-tab

## Scope
Port the existing CRM board (`board/`, branch `feature/crm-pipeline-board`)
into `hub/src/components/CrmTab.jsx`, inside the operator hub built on
`feature/operator-hub`. Read `docs/PLAN-hub.md` first for the overall
context.

## Background
`board/` is a complete, working React app — 9 components, ~977 lines
(`KanbanBoard`, `BusinessDrawer`, `CallList`, `NewLeadsList`,
`OutcomeButtons`, `VoiceNote`, `PreCallLogForm`, `StageColumn`,
`BusinessCard`). This branch should **not** rebuild any of this — it's a
port + re-theme, not new development. Functionally the CRM tab should
behave identically to the standalone board today.

## Work
- Copy `board/src/components/*` into `hub/src/components/` (or a `crm/`
  subfolder to keep them grouped — your call). Keep the internal
  component structure as-is.
- Re-point data access at the hub's shared modules instead of `board/`'s
  own copies:
  - `board/src/lib/supabaseClient.js` → keep the same anon-key
    direct-read pattern, but check whether `hub/` needs its own
    `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` env vars set up (they
    won't exist yet in `hub/` — `board/.env.example` shows what's
    needed).
  - `board/src/lib/adminApi.js` → same `admin-api` POST pattern, but read
    the URL/token from `hub/src/lib/config.js` (the shared `t2r_fn` /
    `t2r_token`) instead of `board/src/lib/config.js`'s
    `t2r_admin_fn`/`t2r_admin_token`. **This is the actual point of this
    merge** — don't bring the old keys forward, or configuring Admin
    won't configure this tab.
  - `board/src/lib/stages.js`, `geo.js` — pure logic, port as-is.
- Re-theme from `board/src/index.css` (dark, CSS custom properties) to
  `hub/src/theme.css` (light — see `docs/PLAN-hub.md` for why light was
  chosen). This is the real work on this branch: same component
  structure and behavior, new classes/colors matching the rest of the
  hub. `theme.css` doesn't have kanban/drawer-specific classes yet —
  add what you need there (or a `crm.css` imported alongside it) rather
  than reintroducing `board/`'s dark variables.
- Wire `CrmTab.jsx` in place of the current placeholder.
- The "New leads" tab inside the CRM view depends on `v_call_list`
  (from `feature/lead-scoring`'s migrations, already applied to the live
  NFC Database project per `board/`'s own `BRANCH_BRIEF.md`) — this
  should keep working unchanged, just confirm it still resolves once
  re-pointed at the shared config.

## Key files
- `board/src/App.jsx`, `board/src/components/*.jsx`, `board/src/lib/*.js`
  — everything being ported
- `board/src/index.css` — source styles to translate, not copy verbatim
- `hub/src/lib/config.js`, `hub/src/theme.css` — shared modules to build
  on (already built, `feature/operator-hub`)
- `hub/src/components/CrmTab.jsx` — placeholder to replace

## Acceptance checklist
- [ ] Kanban board, call list, and new-leads views all render and behave
      as they do in the standalone `board/` app
- [ ] Business detail drawer opens, shows contacts/deals/activity timeline
- [ ] Configuring the hub once (Admin tab's settings) is enough — this
      tab does not prompt for its own separate token
- [ ] `npm run build` in `hub/` succeeds
