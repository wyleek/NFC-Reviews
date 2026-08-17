# Branch: feature/crm-pipeline-board

## Scope
The pipeline UI: kanban board, business detail drawer, one-tap outcome
buttons, voice-note field, pre-call call-list UI. Depends on
`feature/crm-data-model` — this is built directly on top of the schema that
branch defines (`businesses.stage`, unified `contacts`, `activities`,
`deals`, `scheduled_messages`).

## Background
`crm-spec.md` defines the pipeline layer: stage enum, kanban board,
one-tap outcome logging, SMS consent/A2P 10DLC notes. `lead-engine-spec.md`
defines the scoring/tiering model and the "pre-call block" workflow this
board's call-list UI needs to surface. Do not start this branch until
`feature/crm-data-model` has landed — merge order in `docs/PLAN.md` is
explicit that the board is built on top of the schema it defines.

## Work
- Kanban board driven by `businesses.stage`, matching the stage enum from
  `crm-spec.md`.
- Business detail drawer: activity timeline, deal info, contact info from
  the unified `contacts` schema.
- One-tap outcome logging buttons wired to `activities`.
- Voice-note field on the detail drawer (capture + attach to the business
  record).
- Pre-call call-list UI implementing the "pre-call block" workflow from
  `lead-engine-spec.md`, using the scoring/tiering model to prioritize.
- Respect SMS consent / A2P 10DLC constraints from `crm-spec.md` anywhere
  `scheduled_messages` is surfaced or triggered from the board.

## Key files
- `crm-spec.md`
- `lead-engine-spec.md`
- Schema landed by `feature/crm-data-model` (`businesses.stage`, `contacts`,
  `activities`, `deals`, `scheduled_messages`)
- `admin.html` — likely host surface, or a new page alongside it

## Acceptance checklist
- [ ] Kanban board renders businesses grouped by `stage`, drag/tap to change stage
- [ ] Business detail drawer shows activity timeline, deal, and contact info
- [ ] One-tap outcome buttons write to `activities`
- [ ] Voice-note field captures and attaches to the business record
- [ ] Pre-call call-list UI reflects lead-engine scoring/tiering
- [ ] SMS consent/A2P 10DLC constraints enforced wherever `scheduled_messages` surfaces
